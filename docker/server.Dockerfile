# Multi-stage build for @phrasebook/server. Bun runs TypeScript directly --
# no bundling/transpilation step -- so "build" here means "install deps and
# run the workspace typecheck as a build-time gate," not produce build
# artifacts. Node.js is used for the install/build stages because pnpm v11
# requires node:sqlite, which Bun does not support on all platforms. The
# runtime stage uses Bun (lean image, no Node) since Bun executes TypeScript
# directly without a transpilation step.
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11 --activate && pnpm --version
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm typecheck

FROM oven/bun:1-alpine AS runtime
WORKDIR /app
COPY --from=build /app /app
RUN chmod +x /app/docker/server-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/app/docker/server-entrypoint.sh"]
