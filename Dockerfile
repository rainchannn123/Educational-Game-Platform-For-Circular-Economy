# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS base

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/game-content/package.json packages/game-content/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/test-fixtures/package.json packages/test-fixtures/package.json

RUN --mount=type=cache,id=clash-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS build

COPY . .

ARG APP
ARG NEXT_PUBLIC_API_URL
ENV APP=$APP
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN pnpm build

FROM build AS runtime

ARG APP
ENV APP=$APP
ENV NODE_ENV=production

CMD ["sh", "-c", "pnpm --filter @circular-city/$APP start"]
