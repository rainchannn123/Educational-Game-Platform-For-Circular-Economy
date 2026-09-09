# Architecture Overview

Circular City Rush is a pnpm/Turborepo modular monolith with three deployable applications:

- `apps/web`: Next.js App Router user interface. TanStack Query owns server snapshots; Zustand is reserved for ephemeral UI state when introduced. CSS Modules and custom properties are the sole styling system.
- `apps/api`: Express REST command/query boundary plus authenticated Socket.IO rooms. Core mutations use REST, idempotency headers, role checks, Zod validation, transactions, audit records, and durable outbox writes.
- `apps/worker`: Mongo lease-based scheduler and outbox publisher. Timers are persisted via due timestamps, never browser state.

The normalized authoritative Mongo aggregates are `games`, `game_team_states`, `game_projects`, `project_work`, `trade_offers`, `health_missions`, timed entity records, activity events, and outbox events. The API writes semantic outbox events in the same transaction as authoritative state. The worker emits only unpublished outbox rows after commit.

Redis is used by Socket.IO's Redis adapter and emitter, and is the intended shared presence/rate-limit backing store. It is never the source of game settlement truth.
