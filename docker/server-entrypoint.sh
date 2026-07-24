#!/bin/sh
set -e

echo "Running migrations..."
(cd /app/packages/db && bun run db:migrate)

# Self-gating on SEED_DEMO_DATA / SEED_DEV_ADMIN (see resolveSeedFlags):
# a real-deployment posture (NODE_ENV=production, flags unset) makes this a
# no-op so the first-run setup wizard owns bootstrap.
echo "Running seed (gated by SEED_* flags)..."
(cd /app/apps/server && bun run seed)

echo "Starting server..."
cd /app/apps/server
exec bun run src/index.ts
