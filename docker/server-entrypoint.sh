#!/bin/sh
set -e

echo "Running migrations..."
(cd /app/packages/db && bun run db:migrate)

echo "Seeding demo data..."
(cd /app/apps/server && bun run seed)

echo "Starting server..."
cd /app/apps/server
exec bun run src/index.ts
