# Multi-stage build for @phrasebook/server. Bun runs TypeScript directly --
# no bundling/transpilation step -- so "build" here means "install deps and
# run the workspace typecheck as a build-time gate," not produce build
# artifacts. The runtime stage still gets its own layer so the pnpm global
# install (base) and the source+typecheck (build) don't pollute its history.
FROM oven/bun:1-alpine AS base
# No Node/corepack in this image -- install pnpm via Bun itself. The base
# image sets BUN_INSTALL_BIN=/usr/local/bin (already on PATH) specifically
# so `bun install -g` works; the version check below fails the build fast
# if that ever stops being true instead of failing obscurely later.
RUN bun install -g pnpm@11 && pnpm --version
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm typecheck

FROM base AS runtime
COPY --from=build /app /app
RUN chmod +x /app/docker/server-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/app/docker/server-entrypoint.sh"]
