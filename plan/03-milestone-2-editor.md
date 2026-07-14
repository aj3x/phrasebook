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

### 2. `apps/server` — better-auth wiring + session middleware ✅

- [x] better-auth mounted on the Hono app behind `/api/auth/*` — email+password only, no OIDC/SAML yet (F3 lists it, M2's rough shape defers it). Real endpoint paths (confirmed from source, not docs): `POST /sign-up/email`, `POST /sign-in/email`, `GET /get-session`.
- [x] A Hono middleware (`createSessionMiddleware`) that resolves the session cookie into `{ userId, roles }` on `c.set("authContext", ...)`. Built and fully tested as a standalone unit, but **not yet mounted globally in `createApp`** — deliberately deferred to step 3, since there's no consumer for it yet and mounting it globally would run it against M1's public runtime-delivery endpoint too, which the plan explicitly wants to stay unauthenticated.
- [x] Seed script (extending M1's `seed.ts`) creates one admin user (`admin@phrasebook.local` / `phrasebook-dev-admin`) with the Admin role, through better-auth's real `signUpEmail` API (not a raw insert — hand-rolling its password hash would be both wrong and a second implementation to keep in sync). Documented in `CONTRIBUTING.md`. Idempotent, same discipline as M1's `seed()`.
- [x] `BIND_ADDR`/CORS story from M1 still holds — `/api/auth/*` gets its own CORS middleware, `credentials: true`, scoped to a placeholder editor dev origin (`http://localhost:5174`) until `apps/editor` exists in step 6 and its real port is known.

**Design notes not in the original plan text:**
- `docker-compose.yml`'s `server` service needed two new env vars (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`) — added with the same dev-only-secret posture as the existing Postgres password.
- Hit the identical `NODE_ENV=production`-leaks-from-the-sandbox-shell class of bug found in M1 step 9, this time via better-auth: it disables rate limiting unless `NODE_ENV === "production"` by default, and this sandbox's shell exports `NODE_ENV=production` globally. Running the full test suite (not a single file) tripped a shared rate-limit bucket across unrelated test files, since better-auth falls back to one shared bucket when it can't determine a per-request client IP (expected in tests). Fixed the same way: `NODE_ENV=test` baked into `apps/server`'s `package.json` `test` script rather than relying on the invoking shell. (The Docker service's own `NODE_ENV=production` is correct and unrelated — rate limiting *should* be on for a real deployment; this fix only touches the test script.)
- Found a third distinct `pg-mem` wire-protocol limitation this session (after the M1 UTF-8 truncation bug and the Migrator's regex-operator gap): `seedAdminUser()` — proven correct and fast (105ms) against `pg-mem`'s in-process Kysely adapter, the same technique this package's 25 passing tests use — hangs indefinitely with no error when routed through `pg-mem`'s `bindServer()` TCP path via the real `postgres.js` driver, the technique M1 steps 6–7 used for subprocess-level smoke tests. Confirmed this is `pg-mem`, not our code, by running the identical function both ways. Whatever SQL pattern better-auth's Kysely adapter issues (transactions and/or prepared statements are the likely suspects) isn't one `pg-mem`'s TCP server handles. Consequence: this step's verification leans entirely on the real (in-process) unit test suite rather than a subprocess-level smoke test — still real SQL execution against real constraints, just not over an actual TCP socket this time.

**Outcome:** ✅ verified via `bun test` (25 tests, 46 assertions across 6 files, all real: real password hashing, real cookies, real session lookups, real role-assignment joins) rather than the `curl -c cookies.txt` smoke test the plan originally envisioned — the pg-mem TCP limitation above made that specific verification path a dead end in this sandbox. The behavior itself (sign up → cookie → authenticated request succeeds; no cookie → session resolves to `null`) is the same either way; only the transport differs. `pnpm typecheck`/`pnpm lint` exit 0 from repo root.

### 3. `apps/server` — RBAC enforcement ✅

- [x] `requireRole(db, roleNames)` middleware factory (`apps/server/src/middleware/require-role.ts`), checked against the resolved session's `role_assignments` (via the step-2 session middleware's `authContext`).
- [x] Additive-only (§D4) — passes if the user has *any* role assignment matching any of `roleNames`, no deny rules. A `locked` boolean on the `user` table (migration `0010_user_locked.ts`) is the only revoke-everything mechanism, checked first and short-circuits to a 403 regardless of role.
- [x] `createSessionMiddleware` (built in step 2 but deliberately not mounted yet) is now mounted globally in `createApp` (`app.use('*', ...)`) — it only resolves `authContext` (never rejects by itself), so the M1 runtime endpoint stays public/unauthenticated exactly as before; `requireRole` is what actually gates a route, and nothing mounts it on `/v1/*` yet.

**Design notes not in the original plan text:**
- Split scope matching (project/locale) out of `requireRole` into a separate pure function, `hasScopedRole(authContext, roleNames, scope)` (`apps/server/src/middleware/scope.ts`). `requireRole` only checks *is any role present*; `hasScopedRole` is the one that respects §F3's "NULL means all" wildcarding per dimension, and dimensions not requested in `scope` are simply not checked. Kept it middleware-agnostic (plain function, not a `MiddlewareHandler`) since routes needing project/locale-scoped checks don't exist yet (that starts in step 6+) — no route wires it up yet, it's just tested standalone.
- Mounting the session middleware globally required threading `db` through as a third argument to `createApp(store, auth, db)` — every caller (`src/index.ts`, and all four test files) updated accordingly. This is pure plumbing, not a behavior change: `db` was already being constructed by every caller to build `auth` in the first place.
- The `locked` check lives in `requireRole` (queries the `user` table directly by `authContext.userId`) rather than being folded into `createSessionMiddleware`'s `authContext`, so an already-issued session's `authContext` doesn't need to be invalidated/recomputed the instant an admin flips the flag — the lock is enforced at the point of every gated request, not just at session-resolution time.

**Outcome:** ✅ verified via `bun test` (5 tests for `requireRole` covering 401/403/200/additive-match/locked-user, 7 tests for `hasScopedRole`'s scope-matching rules, plus the existing suites updated for the `createApp` signature change and the `locked` column) — 37 tests total in `apps/server`, all passing. Full workspace re-run after the fix: 117 tests across all 7 packages, 0 failures. `pnpm typecheck`/`pnpm lint` exit 0 from repo root. A Viewer-scoped session would get a 403 from any route wrapped in `requireRole(db, [...])` even if it somehow reached the request; no route needs this yet since step 3 is infrastructure for steps 4+ (RBAC-gated write endpoints) and step 6+ (the editor's own project/locale-scoped checks via `hasScopedRole`).

### 4. `apps/server` — status machine ✅

- [x] Server-side implementation of all 8 states and the transitions listed in §5, as one module (`apps/server/src/status.ts`), not scattered across route handlers: `statusAfterSave`, `claimForReview`, `approve`, `sendBack`, `markNeedsUpdate`, `deprecate`, `restore`, each throwing a shared `InvalidTransitionError` when called from a status that can't legally reach the requested one.
- [x] Endpoints: `PUT /v1/projects/:project/translations/:namespace/:locale/:key` (save — drives straight to `approved`/`needs_review` depending on who's saving and the auto-approve setting), `POST .../claim`, `POST .../approve`, `POST .../send-back` (rejects without a comment body).
- [x] Per-project `auto_approve` boolean (migration `0011_project_auto_approve.ts`, defaults `true`), read by `PostgresStore.saveTranslation` via a `resolveRefIds` lookup shared with `putTranslation`.
- [x] Editing an already-approved/published translation resets status per §5's explicit rule — `statusAfterSave` is called unconditionally on every save regardless of the translation's current status, so this falls out of the design rather than being a special case bolted on after (see step 4c's test: "editing an already-approved translation resets it back into review, not silently staying approved").

**Design notes not in the original plan text:**
- Split this step into four commits (4a status module, 4b `auto_approve` column, 4c `Store`/`PostgresStore` wiring, 4d HTTP endpoints) since it ballooned past "roughly one commit" — each commit left the codebase green, matching the plan's own stated fallback ("if an item balloons, split it").
- `requireRole` from step 3 gates these endpoints with two role sets: `Admin`/`Developer`/`Translator`/`Reviewer` can save (any of them writing a translation), but only `Admin`/`Developer`/`Reviewer` can claim/approve/send-back — a translator's own auto-approve path already reaches `approved` directly through the save endpoint (per §5: "translators *may* approve their own work only while auto-approve is on"), so there's deliberately no separate self-approve action for translators to call.
- HTTP error mapping distinguishes three cases: 400 for a structurally missing `targetText`/`comment` field, 404 for an unknown project/namespace/locale/key/translation (`resolveRefIds`/`findTranslation` failing to find a row), and 409 for a well-formed request that conflicts with the translation's current state (`InvalidTransitionError` — e.g. approving something that was never claimed, or a send-back with an empty comment). This is the first place in the codebase 409 shows up; picked it over reusing 403/400 because the request is authorized and structurally valid, it just doesn't apply to the resource's current state.
- Send-back's comment is validated (non-empty, per §5) by the status module but **not yet persisted anywhere** — there's no comments table yet. That's step 11's job; deliberately not building comment storage ahead of its own step, per the M1/M2 working agreement against premature infrastructure. The endpoint signature already takes the comment now so step 11 doesn't have to touch this call site again.
- Refactored `PostgresStore.putTranslation` to share `resolveRefIds`/`upsertTranslation` with the new `saveTranslation`, removing what would otherwise have been duplicated project/namespace/locale/key resolution logic between the two write paths.

**Outcome:** ✅ every transition in §5's "Transitions of note" list has a passing test exercising it directly against the module (19 tests, `apps/server/test/status.test.ts`), again against `PostgresStore` (real pg-mem SQL, `apps/server/test/store/postgres.test.ts`), and again through HTTP with real RBAC/auth (11 tests, `apps/server/test/translations.test.ts`) — the same three-layer TDD bar M1 held for the `Store` interface. Full workspace re-run: 128 tests across all 7 packages, 0 failures. `pnpm typecheck`/`pnpm lint` exit 0 from repo root.

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
