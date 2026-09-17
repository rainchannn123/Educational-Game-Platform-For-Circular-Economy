# Local Operations Runbook

## Start A Local Stack

1. Copy `.env.example` to `.env` and provide a unique 32+ character `JWT_SECRET`.
2. Start MongoDB and Redis:

   ```powershell
   docker compose -f infra/docker/compose.yml up -d
   ```

3. Install and validate dependencies:

   ```powershell
   pnpm install
   pnpm validate:env
   ```

4. Start the web app, API, and worker:

   ```powershell
   pnpm dev
   ```

5. Optionally create a local facilitator account by setting `SEED_FACILITATOR_PASSWORD` and running `pnpm seed`.

## Full Local Container Stack

The Compose file at `infra/docker/compose.yml` can run the complete platform in containers:

```text
web      -> http://localhost:3000
api      -> http://localhost:4000
worker   -> no public port; schedules and publishes game events
mongo    -> localhost:27017
redis    -> localhost:6379
```

Start Docker Desktop first, then run from the repository root:

```powershell
docker compose -f infra/docker/compose.yml up --build
```

The first build downloads Node dependencies and builds the workspace. Later builds reuse Docker cache unless dependency manifests change.

Useful commands:

```powershell
# Start all services in the background
docker compose -f infra/docker/compose.yml up --build -d

# Inspect service state
docker compose -f infra/docker/compose.yml ps

# Follow one service log
docker compose -f infra/docker/compose.yml logs -f api
docker compose -f infra/docker/compose.yml logs -f worker

# Stop containers but retain MongoDB/Redis data
docker compose -f infra/docker/compose.yml down

# Stop and remove local database/cache volumes too
docker compose -f infra/docker/compose.yml down -v
```

The API and worker use Docker network hostnames internally:

```text
MONGODB_URI=mongodb://mongo:27017/clash-of-cities?replicaSet=rs0
REDIS_URL=redis://redis:6379
```

The browser still uses `http://localhost:4000` through the web build’s `NEXT_PUBLIC_API_URL` value.

Use `pnpm dev` for ordinary code editing. Use the full Compose stack when testing production-style process separation, networking, worker behavior, or a local deployment rehearsal.

## Required Runtime Services

| Service | Default endpoint | Why it is required |
| --- | --- | --- |
| MongoDB | configured by `MONGODB_URI` | Canonical game state, transactions, audits, leases, outbox |
| Redis | `redis://localhost:6379` | Socket.IO Redis adapter and worker event emitter |
| Web | `http://localhost:3000` | Player and facilitator interface |
| API | configured API port, normally `4000` | Commands, snapshots, authentication, Socket.IO |

## Redis Connection Retries

Messages such as `Redis publisher unavailable; retrying`, `Redis subscriber unavailable; retrying`, or `Redis emitter unavailable; retrying` mean the process cannot reach `REDIS_URL`. They usually indicate that the Redis container is stopped or port `6379` is occupied/unreachable, not a faulty computer.

Start only Redis when needed:

```powershell
docker compose -f infra/docker/compose.yml up -d redis
Test-NetConnection -ComputerName localhost -Port 6379 -InformationLevel Quiet
```

The port check should return `True`. API and worker clients retry automatically. MongoDB remains canonical, but immediate Socket.IO updates are delayed until Redis reconnects.

## Worker Responsibilities

The worker must run during a real session. It handles:

- per-city 10–30 second waste scheduling and source expiry;
- Municipality transport arrival at MRF;
- MRF recycling job settlement and inventory credit;
- material-transfer arrival;
- project timing and announcements;
- health-mission expiry and zero-health recovery;
- trade expiry/delivery and role-lock release;
- durable outbox publication.

Restarting the worker is safe. Due timestamps, leases, and state transitions are persisted in MongoDB; the worker resumes due work after restart.

## Operational Checks

- Monitor teams at or near zero health, unprocessed outbox records, expired worker leases, and repeated worker failures.
- Treat an apparent client state gap as a snapshot-recovery issue. Do not replay a command manually until the client has refreshed its authoritative snapshot.
- If a health overlay reaches `00:00`, the UI dismisses it locally while snapshot polling continues until the worker records the authoritative health restoration.

## Classroom Capacity: Up To 70 Students

One session supports up to 30 city teams, which is sufficient for 70 students across approximately 24 three-player cities. Use a production build for a live class; `next dev` intentionally adds development checks, rebuild work, and React diagnostics that are not appropriate for a full classroom session.

1. Start MongoDB and Redis before students join.
2. Build once:

   ```powershell
   pnpm build
   ```

3. Start the services in separate terminals:

   ```powershell
   pnpm start:web
   pnpm start:api
   pnpm start:worker
   ```

4. Confirm Redis is reachable before opening the room.
5. Have students sign in and form teams before the live start when practical; a synchronized first-time login wave is CPU-intensive because password verification is deliberately expensive.

Current load controls include visibility-aware lobby fallback polling, Socket.IO updates for team-room changes, 30-second full-snapshot fallback polling for connected live clients, a lightweight leaderboard endpoint for global rank events, client-side refresh coalescing, targeted MongoDB indexes, and a single-flight worker tick.

For a production deployment, monitor API latency, MongoDB CPU/connections, Redis availability, worker tick duration, and outbox backlog. A Redis outage delays immediate live events but does not corrupt canonical MongoDB state; clients recover from their next snapshot.
