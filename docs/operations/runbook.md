# Local Operations Runbook

1. Copy `.env.example` to `.env` and set `JWT_SECRET` to a unique 32+ character value.
2. Run `docker compose -f infra/docker/compose.yml up -d`.
3. Run `pnpm install` then `pnpm validate:env`.
4. Start `pnpm dev` to run web, API, and scheduler worker.
5. Run `pnpm seed` to create the facilitator account.

The worker must be running during a real session. It handles game phase transitions, scheduled project cards, waste arrivals/expiry, processing completion, hold fallback, health mission expiry, trade expiry/delivery, and outbox delivery. Restarting it is safe: due records and leases are persisted in Mongo.

Operational alerts: `health < 10`, unprocessed outbox events, expired scheduler lease, and failed worker ticks. Treat a client state gap as a snapshot recovery event, not a reason to replay client commands.
