# Developer README: How Clash of the Cities- Mission Net Zero Works

This guide is for a developer joining the project who needs to understand the current codebase quickly and make safe changes. Read it together with the root [README](../README.md) and the [current gameplay rules](product/detailed-rules-and-action-spec.md).

## 1. The Short Version

Clash of the Cities- Mission Net Zero is a real-time game with three roles: Municipality, MRF, and Broker. The browser shows the city and sends commands. The API validates and commits those commands. The worker completes work that takes time. MongoDB is the source of truth. Redis helps deliver real-time Socket.IO messages but is not required to decide game outcomes.

Use this mental model:

```text
React UI -> REST command -> API validation/transaction -> MongoDB + Outbox
                                                   -> worker settles due work
Outbox -> Socket.IO -> React invalidates snapshot -> React renders Mongo state
```

Never add game-settling logic only in React. If an outcome changes wallet, inventory, health, CO2, a transport, a job, or a project winner, it belongs in the API, worker, or game engine.

## 2. Repository Map

```text
apps/
  web/                         Next.js player interface and Three.js city
    app/                        Routes such as /games/[gameId]/[role]
    components/GameScreen.tsx   Main live-game React shell and role panels
    components/city/            Three.js scene, render adapter, snapshot types
  api/                          Express API and Socket.IO server
    src/app.ts                  REST routes and snapshot projection
    src/game-service.ts         Authoritative game commands
    src/models.ts               Mongoose schemas/models
    src/database.ts             MongoDB connection
    src/server.ts               HTTP + Socket.IO startup and room authorization
  worker/                       Persisted timer scheduler and outbox publisher
    src/worker.ts               Due work: waste, transport, jobs, health, trades
    src/scheduler.ts            Pure schedule helper functions

packages/
  contracts/                    Shared Zod command schemas and rule errors
  game-content/                 Scenario, projects, processing methods, missions
  game-engine/                  Pure deterministic calculations and state helpers
  test-fixtures/                Reusable test setup

infra/docker/compose.yml        Local MongoDB and Redis containers
docs/                           Product, architecture, testing, and developer docs
```

## 3. Application Startup

### Web

`apps/web` is a Next.js App Router application. The live route renders `GameScreen`, which owns local UI state such as open panels, selected tabs, transient visual effects, and client-side display timers.

### API and MongoDB

`apps/api/src/server.ts` reads environment values, connects to MongoDB, creates the Express app, and starts Socket.IO:

```ts
const env = readEnv();
await connectMongo(env);
const app = createApp(env);
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: env.WEB_ORIGIN },
  connectionStateRecovery: { maxDisconnectionDuration: 120_000 },
});
```

MongoDB connection is intentionally centralized in `apps/api/src/database.ts`:

```ts
export async function connectMongo(env: Env): Promise<void> {
  dns.setServers(env.DNS_SERVERS);
  await mongoose.connect(env.MONGODB_URI);
}
```

`MONGODB_URI` is the canonical database connection string. Do not put credentials in source code or documentation. The `DNS_SERVERS` configuration is used because Atlas SRV records need Node's DNS resolver.

### Worker

`apps/worker/src/worker.ts` uses the same environment, MongoDB connection, models, engine functions, and content definitions as the API. It is a separate process because scheduled work must continue even when no browser is open.

```ts
const env = readEnv();
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const emitter = new Emitter(redis);
const instanceId = `worker_${randomUUID()}`;
```

The worker retries Redis connections automatically. A Redis retry message means Socket.IO event publication is unavailable; it does not mean MongoDB game state is lost.

## 4. MongoDB Model Overview

All Mongoose models are in `apps/api/src/models.ts`. The most important records are:

| Model | What it stores |
| --- | --- |
| `Game` | Match phase, seed, timing, worker lease, global revision, participating teams |
| `GameTeamState` | Wallet, health, CO2, shared inventory, role allocations, metrics, current revision, per-city waste schedule |
| `WasteSource` | Raw batch or decomposed material stream; composition, contamination, status, parent relationship |
| `Transport` | Municipality raw-waste route and arrival time |
| `ProcessJob` | One MRF recycle/disposal job, its immutable calculated result, due time, and status |
| `MaterialTransfer` | Role-to-role recovered-material transport and arrival state |
| `GameProject` | Public project requirements, timing, winner, and receipt |
| `TradeOffer` | Broker trade proposal, locks, and delivery state |
| `HealthMission` | Role quiz/mission state and deadline |
| `OutboxEvent` | Durable event waiting to be emitted to Socket.IO after commit |
| `ActivityEvent` | Audit trail for player and worker actions |

### Shared inventory versus role inventory

`GameTeamState` stores both `inventory` and `roleInventories`:

```ts
inventory,
roleInventories: { type: Schema.Types.Mixed, default: () => ({}) },
```

This is a deliberate design.

- `inventory` is the **shared total** for the team and is what projects require.
- `roleInventories` says who is currently holding each recoverable material allocation.
- MRF recovery increases both the shared total and MRF allocation.
- MRF/Broker transfers change allocations only, because the material stays in the same team.
- A project claim deducts shared material and reconciles allocations so the same kilograms cannot be used twice.

## 5. Frontend Data Flow

### Snapshot first

The web app treats the game snapshot as canonical. `GameScreen.tsx` reads the snapshot, derives visible state, and renders role workspaces. Do not modify wallet, inventory, health, or project state locally after a successful command.

### Socket.IO triggers a snapshot refresh

`GameScreen` connects with the authenticated token, joins the game room, deduplicates events, optionally starts a short visual effect, and invalidates the snapshot query:

```ts
socket.on("connect", () => {
  setConnected(true);
  socket.emit("socket.join-game", { gameId });
});

realtimeEvents.forEach((eventName) => {
  socket.on(eventName, (envelope: RealtimeEnvelope) => {
    if (!markEventSeen(envelope?.eventId)) return;
    applyRealtimeVisual(eventName, envelope ?? {});
    void queryClient.invalidateQueries({ queryKey: ["snapshot", gameId] });
  });
});
```

The important idea is that an event is normally a hint to refresh, not a complete source of state. Chat, announcements, transport arrival, completed material transfer, and completed MRF processing use complete event payloads to patch the React Query cache immediately. If an event is missed, polling and reconnect snapshot recovery still return the current game.

### UI state versus game state

Safe local UI state includes:

- the open role panel;
- selected MRF tab;
- selected transport option before submission;
- chat input text;
- local avatar movement and short visual effects;
- countdown display derived from a server timestamp.

Unsafe local state includes:

- decrementing wallet after a button click;
- moving material into inventory before server confirmation;
- declaring a transport arrived;
- changing health or project winner;
- granting a project reward.

## 6. Game Flow: One Waste Batch End To End

This is the most useful flow to understand before editing the game.

### Step A: The worker schedules raw waste

The worker uses `GameTeamState.nextWasteAt` and `wasteSpawnSequence` to create per-city 10–30 second intervals. The pure helper lives in `apps/worker/src/scheduler.ts`:

```ts
export function wasteSpawnIntervalMs(
  seed: number,
  citySlot: number,
  sequence: number,
  minimumMs: number,
  maximumMs: number,
): number {
  return minimumMs +
    (seeded(seed, citySlot * 509 + sequence * 313) %
      (maximumMs - minimumMs + 1));
}
```

The worker persists the next due time. It schedules the next attempt from the current time after each attempt, so a delayed worker creates at most one missed batch rather than a burst.

### Step B: Municipality dispatches a raw source

The Municipality panel sends a command with the selected source and route. The API route calls `GameService.dispatchCollection()`.

The service begins with authorization and state checks:

```ts
const { state, role } = await this.member(gameId, userId);
this.assertRole(role, "municipality");
if (state.revision !== expectedRevision)
  throw new RuleError("STALE_TEAM_REVISION");
```

It then uses a MongoDB transaction to charge the route, move the source from `available` to `in_transit`, create the `Transport`, write audit data, and enqueue a durable event. The browser receives an arrival countdown based on the persisted `arrivesAt` time.

Municipality cannot use `/material-transfers`. That endpoint rejects the Municipality role even if someone tries to call it outside the UI.

### Step C: Worker delivers the source to MRF

When `Transport.arrivesAt` is due, the worker transaction changes:

```text
Transport: in_transit -> arrived
WasteSource: in_transit -> at_mrf
Outbox: municipality.transport.updated
```

The source disappears from Municipality work and appears in the MRF Decompose tab after the next snapshot update.

### Step D: MRF decomposes the mixed batch

The MRF calls:

```text
POST /v1/games/:gameId/mrf/decompositions
```

`GameService.decomposeWaste()` accepts only an `at_mrf` source. It marks the original source as `decomposed` and creates one child `WasteSource` for each material with a positive quantity.

Conceptually:

```text
raw source: 600 kg paper + 400 kg plastic
  -> parent status: decomposed
  -> child source: 600 kg paper, status held
  -> child source: 400 kg plastic, status held
```

No inventory changes during decomposition. These children are work-in-progress material streams, not recovered stock.

### Step E: MRF recycles one stream

The MRF calls:

```text
POST /v1/games/:gameId/mrf/processes
```

The command only accepts a `held` single-material source. It calculates a receipt on the server, stores the job with `dueAt`, and sets the stream to `processing`. The worker later settles the job in one transaction.

The worker adds recovered output to both ledgers with the engine helper:

```ts
addMaterial(team.inventory, material, result.grade, result.outputKg[material]);
addMaterial(
  team.roleInventories.mrf,
  material,
  result.grade,
  result.outputKg[material],
);
```

The child stream becomes `processed` or `landfilled`. When the final child reaches a terminal state, the parent batch becomes terminal too.

### Step F: MRF or Broker transfers recovered material

The generic transfer command creates a `MaterialTransfer` with a route and arrival time. The sender allocation is debited at departure. At arrival, the worker credits the recipient allocation transactionally.

The shared inventory does not change during this step because the team still owns the same material.

### Step G: Municipality claims a project

Only Municipality can call the project claim command. The engine checks shared inventory first, then consumes matching unlocked material from allocations:

```ts
consumeProjectMaterials(team.inventory, project.requirementsKg);
next.roleInventories = consumeProjectRoleInventories(
  next.roleInventories,
  project.requirementsKg,
);
```

This allows a project to use enough shared material even if it is currently allocated across MRF and Broker, while preventing it from remaining available for a later transfer.

## 7. API Command Pattern

New state-changing commands should follow this checklist:

1. Add or update a Zod schema in `packages/contracts/src/index.ts`.
2. Add the HTTP route in `apps/api/src/app.ts`.
3. Implement the authoritative service method in `apps/api/src/game-service.ts`.
4. Check authenticated membership, role, game phase, expected revision, health lock, and input state.
5. Use a transaction whenever multiple records must change together.
6. Write an `ActivityEvent` and an `OutboxEvent` in the same transaction.
7. Return a receipt; do not trust client-provided calculations.
8. Add integration coverage in `apps/api/test/integration/game-safety.test.ts`.
9. Add the event name to the client `realtimeEvents` list if the UI should refresh immediately.

## 8. Worker Pattern

Use the worker for anything that happens after a persisted due time. Examples include transport arrival, MRF processing, project expiry, trade delivery, health-mission expiry, and health recovery.

When adding a due workflow:

1. Persist `dueAt` or `arrivesAt` on a MongoDB record.
2. Query only records whose due time has passed and whose status is still expected.
3. Claim/settle them with conditional updates inside a transaction.
4. Update every related record, then write one durable outbox event in that transaction.
5. Make the operation safe if the worker runs again after a crash.

Avoid `setTimeout` for authoritative outcomes. Browser or Node memory timers do not survive restart and can settle duplicate work.

## 9. Socket.IO Rooms

`apps/api/src/server.ts` verifies the JWT before a socket can join. After `socket.join-game`, the server verifies game membership and joins the client to:

```text
game:<gameId>              public game updates, such as leaderboard refreshes
team:<gameId>:<teamId>     private team state and role work updates
trade:<gameId>:<tradeId>   trade participants only
```

The worker publishes durable outbox events to those targets. Never emit sensitive team/trade content to the public game room.

## 10. Where To Change Common Features

| Change needed | Start here |
| --- | --- |
| Change material colors, cards, or role UI | `apps/web/components/GameScreen.tsx`, `GameScreen.module.css` |
| Change city visuals or transit effects | `apps/web/components/city/CityScene.tsx`, `cityRenderModel.ts` |
| Add a player command | `packages/contracts`, `apps/api/src/app.ts`, `game-service.ts` |
| Change deterministic cost/output/health math | `packages/game-engine/src/index.ts` |
| Change routes, projects, processing methods, missions, timings | `packages/game-content/src/index.ts` |
| Change a timed transition | `apps/worker/src/worker.ts` and `scheduler.ts` |
| Change snapshot fields | API snapshot route in `app.ts`, then `apps/web/components/city/types.ts` |
| Add database records/fields | `apps/api/src/models.ts`, then migration/compatibility handling and tests |

## 11. Safe Development Workflow

1. Start with a failing or missing test that describes the intended behavior.
2. Put deterministic rules in `packages/game-engine`, not React.
3. Keep `packages/game-content` for authored configuration rather than scattering values through API or worker code.
4. Add role and status guards to the API even if the UI hides a button.
5. Prefer minimal changes that preserve existing persisted data and event contracts.
6. Run:

   ```powershell
   pnpm typecheck
   pnpm test
   pnpm build
   ```

7. Check a role UI manually with Municipality, MRF, and Broker routes. A UI restriction is not a substitute for API authorization.

## 12. Common Problems

### Redis retry logs

Start Redis through `docker compose -f infra/docker/compose.yml up -d redis`. The API and worker retry automatically. Redis is used for real-time event fan-out; MongoDB remains authoritative.

### A UI does not refresh

Check these in order:

1. Did the API command return success?
2. Did the transaction write expected MongoDB state?
3. Did it create an outbox event?
4. Is the worker publishing outbox records?
5. Is Redis available for Socket.IO?
6. Does the client list the event in `realtimeEvents`?
7. Does a direct snapshot request contain the expected canonical state?

### A timed item never completes

Confirm the worker is running, the item has a due timestamp in the past, the status matches the worker query, and MongoDB is reachable. Do not attempt to settle the item from the browser.

## 13. Final Rule

If a change can alter the outcome of the game, make it server-authoritative, durable, testable, auditable, and recoverable from a snapshot. If it only changes the experience of seeing the game, keep it in the web client and never let it become the source of truth.
