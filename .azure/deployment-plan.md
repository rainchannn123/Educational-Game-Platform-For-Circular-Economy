# Azure App Service Deployment Plan

**Status:** Planning

## Scope

- Prepare guidance for deploying the web UI, Express API, and scheduler worker as separate Azure App Services.
- Use Azure AI Foundry only for the chatbot model endpoint.
- Defer MongoDB provisioning and final `MONGODB_URI` configuration until a transaction-capable MongoDB service is selected.

## Proposed Services

| Component | Azure service | Public ingress | Notes |
| --- | --- | --- |
| Web | Linux App Service | Yes | Next.js production server |
| API | Linux App Service | Yes | Express, Socket.IO, WebSockets enabled |
| Worker | Linux App Service | No public use | Always On background scheduler, one instance |
| Redis | Azure Managed Redis | Private/managed | Required for Socket.IO adapter/emitter |
| MongoDB | Deferred | N/A | Must support multi-collection MongoDB transactions |
| Chatbot model | Azure AI Foundry | API-only | API App Service holds Foundry secret values |

## Deployment Choice

- Publish the three application components as container images built from the repository Dockerfile.
- Use Azure Container Registry as image storage.
- Deploy separate image tags to the three App Services.
- Use GitHub Actions for build, test, push, and rolling deployment after initial manual validation.

## Required Application Settings

- Shared API/worker: `MONGODB_URI`, `REDIS_URL`, `JWT_SECRET`, `WEB_ORIGIN`, chatbot settings.
- Web build setting: `NEXT_PUBLIC_API_URL`.
- API: WebSockets enabled; CORS origin set to web App Service hostname.
- Worker: Always On enabled; instance count fixed at one.

## Deferred Decisions

- Azure region and subscription.
- App Service plan SKU.
- MongoDB provider and connection string.
- Azure Managed Redis SKU/network configuration.
- Azure Container Registry name.

## Next

Review the App Service portal setup guide before provisioning resources. Azure resource creation, secret entry, and deployment execution require explicit approval and Azure subscription/region selection.
