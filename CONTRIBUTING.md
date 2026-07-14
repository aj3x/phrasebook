# Setup
1. cp .env.example .env
2. cd docker && docker compose up -d
3. pnpm install && pnpm --filter @phrasebook/demo-web dev
4. Open http://localhost:5173, try the fr-CA locale specifically to see the fallback chain in action.

## Dev admin login (M2+)

`pnpm --filter @phrasebook/server seed` (also run automatically by `docker compose up`) creates a
dev-only admin account:

- Email: `admin@phrasebook.local`
- Password: `phrasebook-dev-admin`

Local/demo credentials only, intentionally committed here and in `apps/server/src/seed.ts` — never
reuse this password for a real deployment.

## Claude Code

Using [claude-auto-retry](https://github.com/cheapestinference/claude-auto-retry).
If you switch Node versions (nvm), re-run: `claude-auto-retry install`.