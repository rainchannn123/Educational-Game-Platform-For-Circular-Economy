# Documentation Index

This directory describes the implemented Clash of the Cities- Mission Net Zero platform. The source code and automated tests are the final authority when a document and implementation differ.

## Start Here

- [Current gameplay rules](product/detailed-rules-and-action-spec.md): role responsibilities, material lifecycle, health recovery, projects, scoring, and real-time behavior.
- [Developer README](DEVELOPER_README.md): codebase structure, frontend/API/worker communication, MongoDB models, and the end-to-end material flow.
- [AI advisor configuration](CHATBOT_CONFIGURATION.md): Azure Foundry environment variables, RAG flow, safety boundaries, and disabled development mode.
- [Architecture overview](architecture/overview.md): applications, state ownership, data model, API/worker responsibilities, and real-time recovery.
- [Local operations runbook](operations/runbook.md): environment setup, Redis/Mongo troubleshooting, and operational checks.
- [Test matrix](testing/test-matrix.md): validation layers and the behaviors each protects.

## Design And History

- [Three.js city stage status](product/threejs-circular-city-migration-plan.md): implemented full-window stage and remaining visual polish work.
- [Implementation plan](product/implementation-plan.md): historical product/design decisions. It is useful context, but the current gameplay rules override superseded readiness and direct-processing proposals.
- [ADR 0001](architecture/adr/0001-authoritative-state.md): why settlement belongs to server-side state and a durable outbox.

## Documentation Conventions

- **Implemented** means behavior exists in the current codebase and is suitable for test coverage.
- **Planned** means a future enhancement, not a current promise.
- Browser rendering and animations are never authoritative; REST commands, MongoDB state, worker settlement, and durable outbox events determine outcomes.
