# Test Matrix

- Engine: integer rounding, CO2 multiplier, recovery/residue, claim eligibility, trade fair value, health outcomes, ranking tie-breakers, grade-aware locks, and locked-cash checks.
- API/integration: `apps/api/test/integration/game-safety.test.ts` starts a Mongo replica set and verifies concurrent idempotency serialization, team-chat snapshot privacy, active-game routing lookup, and a real Municipality collection command.
- Worker: `apps/worker/test/scheduler.test.ts` verifies deterministic opening-project selection, no repeat before deck exhaustion, and chronological catch-up for missed waste and health-mission slots.
- E2E: `apps/web/e2e/live-game.spec.ts` verifies role routing, viewport reflow, keyboard access, and multiplayer workstation visibility against a seeded live stack. Set `E2E_BASE_URL`, `E2E_GAME_ID`, `E2E_MUNICIPALITY_TOKEN`, and `E2E_MRF_TOKEN` to enable it.
- Accessibility: browser coverage verifies accessible match status, named commands, keyboard focus, responsive reflow, and reduced-motion handling. The global stylesheet disables both animations and transitions for reduced-motion users.
- Load: use `infra/load-test/project-claim-race.js` for 30 claim attempts and assert one winner.
