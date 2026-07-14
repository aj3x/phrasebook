# Phrasebook

Open-source, self-hostable, stack-agnostic Translation Management System.

**Status:** pre-alpha. See [`plan/`](plan/README.md) for the current build plan and milestones.

Foundational spec: [`tms-foundations.md`](tms-foundations.md).
Stack decision: [`tms-stack-options.md`](tms-stack-options.md) · [`tms-stack-options-reasoning.md`](tms-stack-options-reasoning.md).

## Try it

Prerequisites: [Docker](https://docs.docker.com/get-docker/) (with Compose), [Bun](https://bun.sh), and [pnpm](https://pnpm.io).

```sh
cp .env.example .env

cd docker && docker compose up -d && cd ..

pnpm install
pnpm --filter @phrasebook/demo-web dev
```

Open `http://localhost:5173`. `docker compose up` builds and starts the API server (`http://127.0.0.1:3000`) and Postgres, runs migrations, and seeds a demo project on start; the demo app is a separate dev-machine Vite server (kept out of Docker so `docker compose up` stays fast). You should see a translated headline, a translated paragraph with a working ICU plural, and a locale switcher — try `fr-CA`, which has no translation for the plural key on purpose, to see the fallback chain render `fr` instead of a blank string or the raw key name.

## What's in M1 and what isn't

This is [Milestone 1](plan/02-milestone-1-rendering-slice.md) — a rendering slice, not a product. It proves the load-bearing pieces (the store interface, real ICU/CLDR pluralization, locale fallback, and the runtime delivery contract) before anything is built on top of them. Explicitly **not** in M1: auth, an editor UI, the CLI, MT/LLM/plugins, the git ("lite mode") driver, search/glossary/QA, real-time (SSE), and CDN-push delivery. The server binds `127.0.0.1` and has no auth by design at this stage — see [`plan/00-overview.md`](plan/00-overview.md) for the full milestone map and the reasoning behind what's deferred.
