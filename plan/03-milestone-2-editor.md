# Milestone 2 — Editor + Auth

## Resolved before kickoff (2026-07-14)

Per `04-open-questions.md`: **TanStack Table** for the grid, **better-auth** for local auth, **cookie sessions** (API tokens are a separate mechanism for CI/programmatic access, not in scope until they're actually needed by something — see step 9).

## Definition of done

You log in as a seeded admin user, create a project with locales, add keys (seeded or hand-entered), and:

1. A key list shows status/locale/namespace filters and renders correctly for a project with real data.
2. Clicking a cell opens inline editing; typing a translation and saving moves an `untranslated` key to `approved` (auto-approve on, the default) or `needs_review` (auto-approve off, a per-project toggle).
3. A plural/ICU key's editor shows one slot per CLDR-required branch for the target locale (e.g. Arabic shows all six even though the English source only has `one`/`other`); a missing branch is visually distinct and known to fall back to `other` at render time, not silently treated as filled.
4. With auto-approve off: a translator's save produces `needs_review`; a reviewer can claim it (`in_review`), then either approve (`approved`) or send it back with a **required** comment (`in_review` → `needs_review`).
5. Editing an already-`approved` translation resets its status back into the review flow (or straight back to `approved` under auto-approve) — never silently stays `approved` with stale content.
6. Two browser sessions editing the same key: the second save compares its original-text snapshot against the current stored value at save time (D22) — unchanged-since-load saves cleanly, changed-since-load surfaces the conflict instead of silently overwriting.
7. Logging out invalidates the session; the editor is unreachable without logging back in. RBAC is enforced server-side, not just hidden in the UI — a Viewer-role session hitting a write endpoint gets rejected regardless of what the UI shows.
8. `pnpm test` (or `bun test`/`vitest run`) passes on every touched package, same bar as M1.
9. `docker compose up` still brings up the full stack (Postgres + server); `apps/editor` runs as a separate dev-machine Vite server, same pattern M1 established for `apps/demo-web`.

That's it. Search, glossary, DNT, TM, inline QA, MT, notifications beyond in-app, webhooks, API tokens, and the CLI are all **explicitly out of scope** — see Non-goals below. M2 is "can a human do the whole translate → review → approve loop," not the full F11 workspace.

## The vertical slice, in order

Same discipline as M1: each numbered item is roughly one commit, built TDD, verified before moving on. If an item balloons, split it.

### 1. `packages/db` — auth + RBAC schema ✅

- [x] Tables for better-auth's adapter requirements (`user`, `session`, `account`, `verification`). The plan text said "check their adapter docs before hand-designing this" — the docs pages turned out to be genuinely incomplete (fetched three of them; none showed the actual field list or custom-Kysely-instance config shape). Installed `better-auth` + `@better-auth/kysely-adapter` locally and read `@better-auth/core`'s actual `getAuthTables()` source instead of guessing — got the exact, version-1.6.23-accurate field list, plus two things the docs didn't mention at all: (1) `kyselyAdapter(db, config)` accepts *any* pre-built `Kysely<any>` instance directly, so `apps/server` can hand it the exact same connection `createDb()` already makes — no second connection pool; (2) better-auth generates its own 32-char random alphanumeric IDs (`@better-auth/core`'s `generateId`), **not UUIDs** — these four tables use `text` primary keys, not this schema's usual `uuid`, because a `uuid` column would reject better-auth's own IDs.
- [x] `roles` (id, name, is_custom) seeded with the five built-ins: Admin, Developer, Translator, Reviewer, Viewer — inserted directly in the migration (fixed UUIDs, exported as `BUILT_IN_ROLE_IDS`), not `seed.ts`: these are required system rows in every environment, not demo data.
- [x] `role_assignments` (user_id, role_id, project_id nullable, locale_code nullable) — nullable scope columns are how a role becomes locale/project-scoped (§F3) instead of instance-wide; NULL means "all."
- [x] No custom-role *creation* UI yet — schema doesn't preclude it (`is_custom` column already there).

**Design note not in the original plan text:** the four better-auth tables keep better-auth's own camelCase column naming (`emailVerified`, `createdAt`, etc.) instead of remapping to this schema's snake_case convention. better-auth's Kysely adapter supports a `fields: {...}` remap per model, so snake_case was possible — deliberately skipped it. These tables are better-auth's, not ours; using its defaults means schema drift across future better-auth version bumps is much less likely, at the cost of one naming-convention seam in the DB. Worth revisiting if it ever actually causes confusion in practice.

**Outcome:** ✅ migrations `0008_better_auth.ts` and `0009_rbac.ts`, tested the same way M1's schema was — real constraint-rejection tests against `pg-mem` (orphan session/account FKs, duplicate session tokens, orphan role assignments, the five seeded roles, both instance-wide and project+locale-scoped assignments). `bun test` passes (12 tests, 30 assertions) in `packages/db`; every other package's test suite (schemas, icu, core, server, react, demo-web) re-run clean too since `Database`'s shape changed. `pnpm typecheck`/`pnpm lint` exit 0 from repo root.

### 2. `apps/server` — better-auth wiring + session middleware

- [ ] better-auth mounted on the Hono app behind `/api/auth/*` (or whatever its Hono adapter expects) — email+password only, no OIDC/SAML yet (F3 lists it, M2's rough shape defers it).
- [ ] A Hono middleware that resolves the session cookie into `{ userId, roles }` on `c.set(...)`, used by every subsequent editor-facing route.
- [ ] Seed script (extending M1's `seed.ts`) creates one admin user with a known dev password, documented in `CONTRIBUTING.md`/README, never committed as a real secret.
- [ ] `BIND_ADDR`/CORS story from M1 still holds — editor origin gets the same treatment `demo-web`'s did.

**Outcome:** `curl -c cookies.txt -X POST /api/auth/sign-in ...` then a follow-up authenticated request with that cookie succeeds; without the cookie, the same request is rejected.

### 3. `apps/server` — RBAC enforcement

- [ ] A small `requireRole(...)` / `requirePermission(...)` middleware factory, checked against the resolved session's `role_assignments`, scoped by the request's `project`/`locale` path params where applicable.
- [ ] Additive-only (§D4) — union every matching role assignment's permissions, no deny rules. A "locked" flag on the user row is the only revoke-everything mechanism, checked first and short-circuits to reject.
- [ ] Applied to every existing + new write endpoint. Read endpoints (the M1 runtime delivery endpoint) stay public/unauthenticated — RBAC is for the editor's API, not the client-pull runtime contract M1 already shipped.

**Outcome:** a Viewer-scoped session gets a 403 from a translation-write endpoint even if it somehow reached the request (defense at the API layer, not just hidden buttons).

### 4. `apps/server` — status machine

- [ ] Server-side implementation of all 8 states and the transitions listed in §5, as one module (not scattered across route handlers) so the state machine has one source of truth.
- [ ] Endpoints: save translation (drives `untranslated`/`machine_translated`/`approved`→`needs_review` transitions depending on who's saving and the auto-approve setting), claim for review, approve, send-back (rejects without a comment body).
- [ ] Per-project `auto_approve` boolean (new column on `projects`), read by the save-translation transition logic.
- [ ] Editing an already-approved/published translation resets status per §5's explicit rule — this is a transition, not a special case bolted on after.

**Outcome:** every transition in §5's "Transitions of note" list has a passing test exercising it directly against the module (not just through HTTP), the same TDD bar M1 held for the `Store` interface.

### 5. `apps/server` — save-time conflict detection (D22)

- [ ] Save request carries the translator's original-text snapshot (what they started editing from) alongside the new value.
- [ ] Server compares that snapshot against the current stored `target_text`: unchanged → save + advance status normally; changed-but-identical-to-new-value → fine, no-op merge; changed-and-different → reject with enough information (current stored value) for the client to show the diff, per the plan's stated UX ("keep their draft in the field, let them submit-over or cancel").
- [ ] This is intentionally **not** a hard lock (§F6: "rely on the DB status for now, not a hard lock") — it's a save-time check, not a live-editing lock.

**Outcome:** two concurrent "sessions" (two `PostgresStore`-level calls in a test, no UI needed yet) editing the same translation — first save wins cleanly, second save with a stale snapshot is rejected with the right payload to let a client resolve it.

### 6. `apps/editor` — scaffold + auth-gated shell

- [ ] Vite + React app, same shape as `demo-web` (step 10 of M1) but with TanStack Query wired for server state.
- [ ] Login screen using better-auth's client SDK; authenticated shell redirects unauthenticated visitors back to it.
- [ ] Project picker (a logged-in admin/dev can see projects their role assignments grant access to).

**Outcome:** `pnpm --filter @phrasebook/editor dev`, log in with the seeded admin, land on a project picker.

### 7. `apps/editor` — key list (TanStack Table)

- [ ] Table of keys for the selected project + locale, columns: key name, source text, target text, status (visually distinct `machine_translated` per spec, even though M2 has no MT yet — the visual treatment is worth building against the status enum now).
- [ ] Filters: status, locale, namespace. No search yet (F11 lists full-text search, but that's explicitly M5 per `03-later-milestones.md` — the M2 "rough shape" doesn't include it and this plan isn't expanding scope beyond what's already agreed).
- [ ] Keyboard nav: arrow keys move the active cell, matching "keyboard-first" from the M2 outcome — this is the actual reason TanStack Table (headless) won the earlier decision over a grid with baked-in mouse-first UX.

**Outcome:** a project with 50+ seeded keys renders, filters narrow the list correctly, arrow keys move focus without a mouse.

### 8. `apps/editor` — inline translation editing + save

- [ ] Click/keyboard-activate a cell → inline editable field → save on blur/Enter, calls the step 4 save endpoint.
- [ ] Wires the step 5 conflict payload: on a rejected save, show the stored value next to the draft, let the user submit-over or cancel (no raw error dialog).
- [ ] Status updates optimistically in the table, reconciled against the server response.

**Outcome:** M2 DoD items 2 and 6 above, actually clicked through, not just unit-tested.

### 9. `apps/editor` — ICU per-branch editing

- [ ] For a key whose source is ICU plural/select, render one editable slot per CLDR-required branch for the **target** locale (via `@phrasebook/icu`'s canonicalize/parse, extended if needed to enumerate branches — check what's already exposed before adding new API surface).
- [ ] Missing branches shown distinctly (not silently absent) with the "falls back to `other` at render time" behavior explained inline, matching §5's plural representation rule.
- [ ] Saving reassembles the branches back into one ICU MessageFormat string server-side (or client-side before the save call — pick one, keep the reassembly logic in `packages/icu` either way so it's tested once, not duplicated).

**Outcome:** editing `cart.items` for Arabic shows all six plural categories even though the English source only defines two, matching the exact CLDR-completeness guarantee `packages/icu`'s step-3 tests already proved for formatting — this is the same guarantee, now on the write path.

### 10. `apps/editor` — reviewer workflow (claim / approve / send-back)

- [ ] `needs_review` items show a "claim" action (→ `in_review`); claimed items show approve/send-back actions.
- [ ] Send-back requires a non-empty comment (enforced server-side per step 4, UI just can't submit without one).
- [ ] Auto-approve toggle surfaced as a project setting somewhere reachable (doesn't need its own settings page yet — a single toggle on the project picker/header is enough for M2).

**Outcome:** M2 DoD items 4 and 5, clicked through end-to-end with the auto-approve toggle flipped both ways.

### 11. Comments/threads

- [ ] Minimal schema: comments on a key or a specific translation (locale-scoped), author, body, timestamp.
- [ ] Required for send-back (step 10); also just visible as a thread on the key/translation in the editor.
- [ ] This **is** the "TMS notes" entity per §4's metadata-authority note — no separate notes field.

**Outcome:** a send-back comment shows up in the thread; the thread persists and is visible to anyone with read access to that key.

## Explicit non-goals for M2 (repeat, for emphasis)

- No OIDC/SAML — local auth only, deferred per F3/rough-shape.
- No custom-role *creation* UI — schema allows it, no UI yet.
- No search (full-text or fuzzy) — M5 per `03-later-milestones.md`.
- No glossary, DNT, TM, or inline QA — M5.
- No MT — M4. The `machine_translated` status and its visual treatment are built now (step 7) because the enum needs to exist and be handled correctly, but nothing produces that status yet in M2.
- No notifications beyond nothing (not even in-app yet) — M4.
- No API tokens for CI — nothing consumes them yet; adding the mechanism before a consumer exists is exactly the kind of premature infrastructure the M1 working agreement warned against.
- No assignment/workload view, due dates/SLA — mentioned in the M2 rough-shape outline but cut here to keep this milestone's DoD achievable; promoted to a note in `04-open-questions.md` for M2.5 or folded into M4 alongside notifications, whichever turns out to make more sense once M2 ships.
- No webhooks, plugins, CLI, git driver — unchanged from M1's non-goals, still not relevant.

## Definition of feedback we want after M2

- Was cutting assignment/workload view from M2's scope (see non-goals) the right call, or does it need to come back in?
- Does the save-time conflict UX (step 5/8) feel right, or is it too disruptive for how rarely concurrent edits on the same key actually happen at small-team scale?
- ICU per-branch editing (step 9): does reassembly belong in `packages/icu` (shared, testable once) or is it editor-specific enough to live in `apps/editor`? Flagged as a real design fork, not just an implementation detail.
- Anything about the auth/RBAC shape that felt like it'll fight the OIDC/custom-roles work later — better to hear now than after M3/M4 build on top of it.

More live-updating questions get parked in `04-open-questions.md` as they come up, same as M1.
