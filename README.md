# Circular City Rush

Circular City Rush is a server-authoritative real-time learning game for teams of three: Municipality, MRF, and Broker. It is a standalone replacement platform; it has no runtime dependency on the legacy Besse applications.

## Local development

1. Install Node.js 20+ and pnpm 10 (`corepack enable; corepack prepare pnpm@10.18.0 --activate`).
2. Copy `.env.example` to `.env` and set a development `JWT_SECRET`.
3. Start MongoDB and Redis: `docker compose -f infra/docker/compose.yml up -d`.
4. Install packages: `pnpm install`.
5. Start apps: `pnpm dev`.
6. Open `http://localhost:3000` and register a student profile. To create a
   local facilitator account, set `SEED_FACILITATOR_PASSWORD` and run
   `pnpm seed`.

## Quality checks

`pnpm validate:env`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, and `pnpm test:e2e`.

See `docs/architecture/overview.md`, `docs/operations/runbook.md`, and `docs/testing/test-matrix.md`.
