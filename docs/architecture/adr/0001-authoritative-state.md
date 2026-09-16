# ADR 0001: Persisted Authoritative State And Durable Outbox

## Decision

The browser never settles money, material inventory, CO2, health, transport arrival, recycling output, project winners, or trades. MongoDB is the canonical state store. Socket.IO is a notification transport only.

Mutable team state is represented by one `GameTeamState` per game/team. Global project cards, waste sources, transport records, process jobs, material transfers, trades, health missions, activity records, and outbox events are persisted separately. Operations that touch more than one record use MongoDB transactions and conditional status/revision guards.

Each committed state transition writes a semantic outbox record in the same transaction. The worker publishes only unprocessed outbox records after commit. Clients use events to refresh or invalidate snapshot data, then reconcile with `GET /v1/games/:gameId/snapshot`.

## Consequences

- Repeated commands cannot award duplicate outcomes when protected by idempotency keys and conditional updates.
- Timed work survives browser reloads, server restarts, and temporary Socket.IO/Redis outages.
- The visual city can animate routes and countdowns without becoming a second simulation.
- A client that misses events can recover from the canonical snapshot.
- Redis can be restarted independently; it is never used to calculate or store a game result.
