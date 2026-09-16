# Clash of the Cities- Mission Net Zero

Clash of the Cities- Mission Net Zero is a real-time, team-based learning game about the circular economy. Three players operate one city together:

- **Municipality** receives raw waste, selects a transport route, and is the only role allowed to complete civic projects.
- **MRF** (materials recovery facility) separates mixed waste into material streams, recycles each stream, and distributes recovered stock to teammates.
- **Broker** manages independently held stock, external purchases, and trade/procurement decisions.

The game is designed to make the consequences of collection speed, contamination, recovery quality, transport cost, emissions, inventory allocation, and teamwork visible. It is not a browser simulation: the server and worker decide every meaningful outcome.

## What Players Do

### 1. Collect raw waste

During an active game, each city receives raw mixed-waste batches at independently scheduled, deterministic pseudo-random intervals between **10 and 30 seconds**. A batch lists its mass, contamination, expiration time, and paper, plastic, metal, glass, and wood composition.

Only the Municipality can dispatch a raw batch. It chooses one of three transport modes:

| Route | Arrival | Cost | CO2 | Purpose |
| --- | --- | --- | --- | --- |
| Express | Fastest | Highest | Highest | Prioritize speed |
| Standard | Balanced | Medium | Medium | Default operational choice |
| Consolidated | Slowest | Lowest | Lowest | Prioritize cost and emissions |

The batch remains visible with a server-timed arrival countdown until the worker delivers it to the MRF.

### 2. Decompose and recycle at the MRF

The MRF workflow is intentionally two-stage.

1. **Decompose**: an MRF player receives an arrived raw batch and chooses `Decompose Waste`.
2. **Recycle**: decomposition creates one separate material stream for every non-zero component. Each stream can then use only a compatible recycling or disposal method.
3. **Inventory**: recovered, grade-assigned material is credited to both the shared team inventory and the MRF role allocation.

This separation is important: recycling one material stream never erases the other materials from the original batch. A mixed paper/plastic batch becomes a paper stream and a plastic stream; each remains available until it is processed.

### 3. Move recovered materials between roles

The team has two related inventory views:

- **Shared inventory** is the authoritative total recovered or procured material available to the city.
- **Role inventory** shows which role currently holds transferable material.

MRF and Broker may send their held material to either teammate. Transport moves the role allocation when it arrives, while the shared total remains unchanged. Municipality can view inventory but cannot use the generic material-transfer command; its physical logistics responsibility is raw-waste collection.

### 4. Complete civic projects

Project cards appear in the rail at the top of the game screen. Their reward is affected by the team’s relative CO2 performance through a server-calculated multiplier.

Only Municipality can submit `Complete Project`. MRF and Broker see a disabled `Waiting Muni's action` control. The project requirement is checked against the **shared team inventory**, not a single role’s pocket. When a project succeeds, the server deducts the required materials from shared stock and reconciles the corresponding role allocations, so consumed material cannot later be transferred or traded.

### 5. Protect city health

Each role receives a knowledge pop quiz 30 seconds into the match and then every minute. The role-specific question remains open for 30 seconds and uses the supplied 30-question Municipality, MRF, and Broker banks. Correct, wrong, and missed answers use the game’s existing City Health feedback and consequence logic.

Missed work, disposal choices, and health-mission outcomes can affect City Health. When health reaches zero, the team enters a server-authoritative 30-second recovery lock. Actions are rejected during recovery, the UI presents a countdown, and the worker restores health to 20 when the deadline is reached.

## Real-Time City Interface

The active game is a fixed full-window Three.js city with accessible React controls layered over it. The city includes Municipality, MRF, Broker, warehouse, and project-site facilities. The HUD provides wallet, City Health, CO2, reward multiplier, role, game countdown, project rail, inventory, City Signal chat, and a wallet-ranked city leaderboard.

The Three.js scene is presentation only. Keyboard movement, avatars, vehicles, and transfer effects never settle money, inventory, health, or project outcomes. The client always reconciles against the API snapshot.

## Architecture At A Glance

| Component | Responsibility |
| --- | --- |
| `apps/web` | Next.js interface, Three.js city, query-backed snapshot rendering, accessible controls |
| `apps/api` | Authenticated REST commands, query endpoints, validation, role checks, transactions, audit records |
| `apps/worker` | Persisted timers, waste scheduling, transport delivery, MRF settlement, health recovery, outbox publishing |
| MongoDB | Canonical game, team, project, inventory, transport, processing, trade, audit, and outbox state |
| Redis | Socket.IO adapter/emitter transport only; never the source of game truth |

Every mutation is validated, authorized, and processed on the server. Commands use idempotency keys and expected team revisions where applicable. Cross-document outcomes use MongoDB transactions. Durable outbox events are written with the corresponding state change and published only after commit.

## Local Development

### Prerequisites

- Node.js 20 or later
- Corepack and pnpm 10
- Docker Desktop or another Docker-compatible runtime
- MongoDB and Redis, normally started through the provided Compose file

### Start the stack

1. Enable pnpm through Corepack:

   ```powershell
   corepack enable
   corepack prepare pnpm@10.18.0 --activate
   ```

2. Copy `.env.example` to `.env` and configure local values. At minimum, provide a development `JWT_SECRET` with 32 or more characters.

3. Start local infrastructure:

   ```powershell
   docker compose -f infra/docker/compose.yml up -d
   ```

4. Install dependencies and validate configuration:

   ```powershell
   pnpm install
   pnpm validate:env
   ```

5. Start the web app, API, and scheduler worker:

   ```powershell
   pnpm dev
   ```

6. Open `http://localhost:3000` and register a student profile. To seed a local facilitator account, set `SEED_FACILITATOR_PASSWORD` and run:

   ```powershell
   pnpm seed
   ```

### Redis retry messages

If development output reports `Redis publisher/subscriber/emitter unavailable; retrying`, Redis is not reachable at `REDIS_URL`, normally `redis://localhost:6379`.

Start Redis only with:

```powershell
docker compose -f infra/docker/compose.yml up -d redis
```

Then verify its port:

```powershell
Test-NetConnection -ComputerName localhost -Port 6379 -InformationLevel Quiet
```

The expected result is `True`. Redis unavailability interrupts immediate Socket.IO delivery but does not replace MongoDB as canonical state; clients can recover through snapshots once infrastructure is healthy.

## Quality Checks

Run these commands before publishing changes:

```powershell
pnpm validate:env
pnpm typecheck
pnpm test
pnpm build
```

Additional commands may be available through package scripts, including lint, integration, and end-to-end checks.

The current automated coverage includes server idempotency, authorization, Municipality dispatch, MRF decomposition, separated-stream recovery, material transfers, shared-inventory project claims, health recovery guards, live leaderboard ordering, worker scheduling, and UI render-model behavior.

## Documentation Map

- [Documentation index](docs/README.md)
- [Current gameplay rules](docs/product/detailed-rules-and-action-spec.md)
- [Architecture overview](docs/architecture/overview.md)
- [Authoritative-state decision](docs/architecture/adr/0001-authoritative-state.md)
- [Local operations runbook](docs/operations/runbook.md)
- [Test matrix](docs/testing/test-matrix.md)
- [Three.js stage implementation status](docs/product/threejs-circular-city-migration-plan.md)
- [Historical implementation plan and decisions](docs/product/implementation-plan.md)
