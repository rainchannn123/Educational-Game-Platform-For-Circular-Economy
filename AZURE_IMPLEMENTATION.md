
docker compose -f infra/docker/compose.yml up --build



Yes, this is very likely the main local Redis problem.

The error:

```text
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified
```

means the Docker CLI cannot connect to the Docker Desktop Linux engine.

It usually means one of these:

- Docker Desktop is not installed.
- Docker Desktop is installed but not running.
- Docker Desktop is still starting.
- Docker Desktop is configured incorrectly or its Linux container engine is stopped.
- Windows virtualization/WSL2 integration is unavailable.

It does **not** yet prove that Redis was never started. It proves Docker cannot currently inspect or start the Redis container at all.

## Local Fix

1. Open **Docker Desktop** from the Windows Start menu.
2. Wait until it reports:

```text
Docker Desktop is running
```

3. Ensure it is using Linux containers.
4. Run:

```powershell
docker version
```

You should see both:

```text
Client
Server
```

If only Client appears, Docker Desktop is still not running.

5. Then start Redis:

```powershell
docker compose -f infra/docker/compose.yml up -d redis
```

6. Verify:

```powershell
docker compose -f infra/docker/compose.yml ps
```

7. Test Redis:

```powershell
docker compose -f infra/docker/compose.yml exec redis redis-cli ping
```

Expected:

```text
PONG
```

8. Restart API and worker after Redis is live:

```powershell
pnpm dev:api
pnpm dev:worker
```

## Is Docker Required?

**Docker is not required. Redis is required for reliable real-time multi-process updates.**

Docker is only the easiest local-development method to run:

```text
MongoDB
Redis
```

You could instead use:

- a locally installed Redis-compatible service;
- Redis through WSL;
- a remote managed Redis service;
- MongoDB Atlas plus managed Redis.

For Windows development, Docker Desktop is usually the simplest and most consistent option.

## Azure App Service With GitHub Repository Linkage

GitHub linkage is fine for deploying code, but it does **not** automatically provide Redis or MongoDB.

A complete Azure deployment needs at least:

```text
Web application
API application
Worker application
MongoDB-compatible database
Managed Redis-compatible service
```

For this project, the recommended Azure shape is:

```text
Next.js Web App
-> Azure App Service or Container App

Express API
-> Separate Azure App Service or Container App

Scheduler Worker
-> Separate always-on Azure App Service, WebJob, Container App, or worker container

MongoDB
-> MongoDB Atlas, Azure Cosmos DB MongoDB API, or another compatible MongoDB service

Redis
-> Azure Managed Redis / Azure Cache for Redis
```

## Important App Service Notes

If deploying with Azure App Service:

- Enable **WebSockets** for the API App Service.
- Keep the worker as a separate always-on process.
- Do not run the worker only inside the web application process.
- Configure **Always On** for API and worker plans where available.
- Use the same values across API and worker:

```dotenv
MONGODB_URI=...
REDIS_URL=...
JWT_SECRET=...
```

- Configure web with the API URL:

```dotenv
NEXT_PUBLIC_API_URL=https://your-api-host
```

For managed Redis on Azure, the URL will normally use TLS:

```dotenv
REDIS_URL=rediss://...
```

## Bottom Line

Your current Redis warnings are likely caused by Docker Desktop not running, not by weak hardware or bad Wi-Fi.

For local development:

```text
Start Docker Desktop
-> start Redis container
-> restart API and worker
```

For Azure deployment:

```text
GitHub deployment is fine,
but you must separately provision/configure MongoDB, Redis, and the worker service.
```