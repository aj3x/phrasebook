# Setup
1. cp .env.example .env
2. cd docker && docker compose up -d
3. pnpm install && pnpm --filter @phrasebook/demo-web dev
4. Open http://localhost:5173, try the fr-CA locale specifically to see the fallback chain in action.

## Editor (M2+)

`pnpm --filter @phrasebook/editor dev`, then open http://localhost:5174 and log in with the
seeded admin account below to land on the project picker.

## Dev admin login (M2+)

`pnpm --filter @phrasebook/server seed` (also run automatically by `docker compose up`) creates a
dev-only admin account:

- Email: `admin@phrasebook.local`
- Password: `phrasebook-dev-admin`

Local/demo credentials only, intentionally committed here and in `apps/server/src/seed.ts` — never
reuse this password for a real deployment.

## Seeding vs. the first-run wizard (M3+)

What the seed does is gated by two env flags (`resolveSeedFlags` in
`apps/server/src/seed.ts`):

- `SEED_DEMO_DATA` — the demo project + locales (the fr-CA fallback above depends on it).
- `SEED_DEV_ADMIN` — the convenience admin account above.

Both **default to on outside production** (so local dev and the demo `docker compose up` posture
just work) and **off under `NODE_ENV=production` with the flags unset**. In that real-deployment
posture the seed is a no-op, the instance boots to `needsSetup: true`, and the **first-run setup
wizard** owns bootstrap — you enter an email + password, name your org, and create your first
project, with no seed script and no shell access.

To exercise that wizard locally, start against a fresh database with the flags off, e.g.
`SEED_DEMO_DATA=false SEED_DEV_ADMIN=false`, then open the editor — it shows the setup wizard
instead of the login screen.

## Claude Code

Using [claude-auto-retry](https://github.com/cheapestinference/claude-auto-retry).
If you switch Node versions (nvm), re-run: `claude-auto-retry install`.