# Setup
1. cp .env.example .env
2. cd docker && docker compose up -d
3. pnpm install && pnpm --filter @phrasebook/demo-web dev
4. Open http://localhost:5173, try the fr-CA locale specifically to see the fallback chain in action.

## Claude Code

Using [claude-auto-retry](https://github.com/cheapestinference/claude-auto-retry).
If you switch Node versions (nvm), re-run: `claude-auto-retry install`.