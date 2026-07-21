# Build Plan — Phrasebook (TMS)

Feedback-driven build plan. **Milestone 1 is deliberately small and end-to-end** so you can run it, poke it, and steer everything after that. Every later milestone is outlined, not exhaustively speced — we'll flesh each one out from M1's feedback.

## Files

| File | Purpose |
|---|---|
| [`00-overview.md`](00-overview.md) | Principles, milestone map at a glance, working-agreement. |
| [`01-repo-topology.md`](01-repo-topology.md) | Monorepo layout, package boundaries, tooling picks (Bun, Hono, Kysely, etc.). |
| [`02-milestone-1-rendering-slice.md`](02-milestone-1-rendering-slice.md) | The first thing you'll run. Step-by-step. Definition of done. **Done.** |
| [`03-milestone-2-editor.md`](03-milestone-2-editor.md) | Editor + auth. Step-by-step, expanded from the outline below now that M1's shape is confirmed. |
| [`03-milestone-3-onboarding.md`](03-milestone-3-onboarding.md) | Owner role + `resource:action` permissions, then first-run onboarding. Step-by-step. **In progress** — Phase A steps 1-3 done. |
| [`03-later-milestones.md`](03-later-milestones.md) | M4 (CLI/adapters) → M5 (workflow/MT) → beyond. Outlines only. |
| [`04-open-questions.md`](04-open-questions.md) | Running list of things I want your input on as we go. |

## How to use these

1. Skim `00-overview.md` and push back on anything that sounds wrong.
2. Read `02-milestone-1-rendering-slice.md`. That's what I'll start building. Approve or redirect before I write code.
3. `04-open-questions.md` is where I park questions between check-ins — read when you've got a minute.

## Source of truth

`tms-foundations.md` (v2) is the spec — the plan implements it, doesn't override it. `tms-stack-options.md` and `tms-stack-options-reasoning.md` are the stack decision record.

## Stack, confirmed

- **Runtime:** Bun (server + CLI). Node compat where needed.
- **Server framework:** Hono (Bun-native, Web Fetch–shaped).
- **DB access:** Kysely + `postgres.js` (Postgres), `bun:sqlite` (later, lite mode).
- **Editor:** React + Vite + TanStack Query + TanStack Table + TanStack Router (M2). Local auth via better-auth, cookie sessions.
- **Validation:** Zod for API DTOs + shared schemas.
- **ICU/CLDR:** `@formatjs/intl-messageformat` + `@formatjs/intl` (pinned CLDR version).
- **Monorepo:** pnpm workspaces (Bun install compatibility flag on).
- **Testing:** Bun's built-in test runner (server, core), Vitest + Testing Library (React).
- **Deploy:** `docker compose up` with Postgres + server container.

## Deployment mode for v0

Full mode only. Git/lite driver deferred to a later milestone (§11 in the spec). The store interface (§6) is real from day 1 so the git driver can be added without refactoring.
