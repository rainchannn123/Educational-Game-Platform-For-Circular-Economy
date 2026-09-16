# Test Matrix

## Required Commands

```powershell
pnpm typecheck
pnpm test
pnpm build
```

Run `pnpm validate:env` before starting a local deployment. Integration and end-to-end scripts may require a configured local stack.

## Coverage By Layer

| Layer | Location | Important coverage |
| --- | --- | --- |
| Game engine | `packages/game-engine/test/engine.test.ts` | integer rounding, CO2 multiplier, processing output/residue, health lock, shared-inventory claims, role-allocation reconciliation |
| API integration | `apps/api/test/integration/game-safety.test.ts` | idempotency, chat privacy, Municipality raw collection, Municipality transfer rejection, MRF decomposition, separated-stream processing, project authorization, shared claims, leaderboard, health command guard |
| Worker scheduler | `apps/worker/test/scheduler.test.ts` | deterministic project selection, due-slot behavior, announcements, bounded deterministic 10–30 second waste intervals |
| Web render model | `apps/web/components/city/cityRenderModel.test.ts` | canonical snapshot adaptation to city transit visuals |
| Web E2E | `apps/web/e2e/live-game.spec.ts` | seeded live role routes, viewport behavior, keyboard access, multiplayer workstation visibility when E2E environment variables are supplied |

## Material Baseline Acceptance Cases

1. A raw waste source is created for a city on its persisted 10–30 second schedule.
2. Municipality can dispatch only raw waste through the collection endpoint.
3. Due raw transport changes source state to `at_mrf` exactly once.
4. MRF cannot process an `at_mrf` mixed batch directly.
5. MRF decomposition creates one held stream per non-zero material component and no recovered inventory.
6. A recycle job consumes only one compatible held stream; sibling streams remain processable.
7. MRF recovery credits shared inventory and MRF allocation once.
8. MRF/Broker material transfer changes only role allocations when it arrives; shared total is conserved.
9. Municipality cannot invoke the generic material-transfer endpoint.
10. Only Municipality can claim a project.
11. A project can claim stock distributed across MRF and Broker allocations when shared inventory is sufficient.
12. A claim removes both shared and role-allocated stock, preventing later reuse.

## Resilience Acceptance Cases

- Repeating a command with the same idempotency key yields one outcome.
- Stale team revisions are rejected without partial mutation.
- A due worker item is guarded by its current status and cannot settle twice.
- Redis outage does not create a second source of truth; snapshot recovery remains possible.
- Zero-health teams reject actions until worker recovery completes.
- Expired Broker trades release locks from shared and Broker allocations.
