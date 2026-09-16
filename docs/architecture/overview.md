# Architecture Overview

Clash of the Cities- Mission Net Zero is a pnpm workspace modular monolith with a browser client, a command/query API, and a scheduler worker. The architecture deliberately separates **what players see** from **what settles the game**.

## Applications

| Application | Responsibility |
| --- | --- |
| `apps/web` | Next.js App Router interface, TanStack Query snapshots, fixed Three.js city, CSS Modules, local-only UI state and visual effects |
| `apps/api` | Express REST commands and queries, authentication, role checks, Zod validation, idempotency, transactions, audit records, Socket.IO room access |
| `apps/worker` | Mongo lease-based game scheduler, per-city waste scheduling, transport arrival, MRF job settlement, health recovery, trade expiry/delivery, outbox publication |

## Authority Boundary

The browser may render timers optimistically from server timestamps, but it never settles wallet balance, inventory, health, CO2, project winners, transport arrival, recycling output, or trade outcomes.

1. A client sends an authenticated REST command with an idempotency key.
2. The API validates the command, role, game phase, expected revision, and inventory/health rules.
3. The API commits authoritative state and an audit/outbox event together.
4. The worker settles timed work from persisted due timestamps.
5. The outbox publisher emits committed semantic events to Socket.IO rooms.
6. Chat additionally uses an API fast path: after its durable outbox event is persisted, the API immediately publishes the same event envelope to the room. The later worker publication is deduplicated by event ID.
7. Clients selectively patch complete event payloads or refetch the canonical snapshot and render it.

## Canonical Data

MongoDB holds the canonical records for games, teams, game-team state, waste sources, transports, process jobs, material transfers, projects, trades, health missions, announcements, chat, audits, and outbox events.

`GameTeamState` contains shared metrics and the shared team inventory. Role allocations are stored alongside it as `roleInventories`:

- Shared inventory is the team-wide amount eligible for project requirements.
- MRF/Broker/Municipality role inventories identify who currently holds transferable material.
- MRF and Broker transfers move only the role allocation; they do not change the shared total.
- A Municipality project claim consumes shared inventory and reconciles the unlocked role allocations in the same authoritative operation.

## Material Lifecycle

```text
available raw batch
  -> Municipality transport
  -> at_mrf raw batch
  -> MRF decomposition
  -> held single-material streams
  -> MRF recycling/disposal job
  -> recovered shared + MRF inventory
  -> MRF/Broker teammate transfer
  -> shared-inventory Municipality project claim
```

The raw parent batch remains associated with its separated child streams so material processing is traceable. A recycling job may only target one held material stream; it cannot consume a mixed raw batch.

## Real-Time And Recovery

Redis supports the Socket.IO Redis adapter and the worker emitter. It improves immediate cross-process event delivery, but Redis is not a game-state database. If Redis is temporarily unavailable, the API/worker reconnect loops log retries; canonical MongoDB state remains intact and clients can recover using `GET /v1/games/:gameId/snapshot`.

All timed records use persisted due timestamps. The worker can restart safely because it obtains leases and re-evaluates due work from MongoDB rather than relying on browser timers or in-memory queues.
