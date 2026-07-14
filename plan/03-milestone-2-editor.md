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

### 5. `apps/server` — save-time conflict detection (D22) ✅

- [x] Save request carries the translator's original-text snapshot (what they started editing from) alongside the new value — `SaveTranslationInput.originalText`, optional (omitting it skips the check entirely, so `putTranslation` and any snapshot-less caller are unaffected).
- [x] Server compares that snapshot against the current stored `target_text`: unchanged → save + advance status normally; changed-but-identical-to-new-value → fine, no-op merge (falls through to the normal save path rather than a special-cased skip, since there's nothing left to reconcile); changed-and-different → reject with the current stored value (`SaveConflictError.currentText`) for the client to show the diff, per the plan's stated UX.
- [x] Intentionally **not** a hard lock (§F6) — just a comparison at the moment of `saveTranslation`'s upsert, no lock table, no live-editing session concept.

**Design notes not in the original plan text:**
- Split into two commits: 5a (`SaveConflictError` + the comparison logic in `PostgresStore.saveTranslation`, tested directly against the store) and 5b (HTTP wiring — the save endpoint accepts `originalText` in the body and maps `SaveConflictError` to a 409 with `{ error: 'conflict', currentText }`, distinct from the 409 `InvalidTransitionError` already used by claim/approve/send-back — both are "well-formed request, conflicts with current state," just two different kinds of conflict).
- When no translation row exists yet, "the current stored value" is treated as `''` (matching `untranslated`'s "no target content") rather than throwing — so a first-ever save with a snapshot still gets a coherent comparison instead of a special-cased error path.

**Outcome:** ✅ verified at both layers per the plan's stated bar: `PostgresStore.saveTranslation` (4 new tests covering unchanged/no-op-merge/conflict/no-snapshot-provided, `apps/server/test/store/postgres.test.ts`) and through HTTP with real RBAC (1 new test, `apps/server/test/translations.test.ts`) — two concurrent "sessions" editing the same translation: first save wins cleanly, a second save with a stale snapshot is rejected with `{ error: 'conflict', currentText }`. Full workspace re-run: 133 tests across all 7 packages, 0 failures. `pnpm typecheck`/`pnpm lint` exit 0 from repo root.

### 6. `apps/editor` — scaffold + auth-gated shell ✅

- [x] Vite + React app, same shape as `demo-web` (step 10 of M1) but with TanStack Query wired for server state.
- [x] Login screen using better-auth's client SDK (`better-auth/react`'s `createAuthClient`); the auth-gated shell (`App.tsx`) renders `LoginScreen` or `ProjectPicker` based on `authClient.useSession()` — no router yet, session state alone gates the two screens.
- [x] Project picker (a logged-in user sees projects their role assignments grant access to) — backed by a new server endpoint, `GET /v1/projects` (M2 step 6a, its own commit), scoped by `AuthContext.roles` the same way `requireRole` already reads them.

**Design notes not in the original plan text:**
- Split into two commits: 6a (`GET /v1/projects` + `Store.listAccessibleProjects`, backend-only, tested the same three-layer way as step 4/5) and 6b (the actual `apps/editor` scaffold).
- `AuthClient` in `apps/editor/src/auth-client.ts` is a narrow hand-written interface covering only what `App`/`LoginScreen` actually call, not better-auth's full inferred `ReactAuthClient<Option>` type. `createAuthClient(...)`'s return value satisfies it structurally, but the narrow type is what makes the component tests possible: `test/fake-auth-client.ts` implements the same interface with a `useSyncExternalStore`-backed fake session (no real HTTP, no mocking the `better-auth` module), reacting to sign-in/sign-out exactly like the real client's internal store does.
- `ProjectPicker`/`fetchAccessibleProjects` take an optional `fetchImpl` (same pattern `@phrasebook/core`'s `createClient` already established in M1), so tests substitute a fake fetch instead of hitting real HTTP.
- No router added — M2's scope only needs two screens (login, project picker) for now; adding one now would be exactly the kind of premature infrastructure the working agreement warns against. Revisit once step 7+ needs URL-addressable project/key views.
- `EDITOR_DEV_ORIGIN` in `apps/server/src/app.ts` no longer says "placeholder" now that `apps/editor/vite.config.ts` actually pins port 5174.

**Outcome:** ✅ `pnpm --filter @phrasebook/editor dev` serves the app on port 5174; logging in with the seeded admin (`admin@phrasebook.local` / `phrasebook-dev-admin`) lands on a project picker showing every project (an instance-wide Admin grant). Verified via component tests (9 tests, Testing Library/vitest — login error/success paths, project list/empty-state/error-state, sign-out returning to login) and a `vite build` production build; this sandbox has no browser, so as an additional check beyond unit tests, ran a real end-to-end smoke test (real sign-up, real role assignment, real session cookie, real `GET /v1/projects` call against an in-process pg-mem-backed server) confirming the actual HTTP/CORS/cookie wiring the browser would exercise. Full workspace re-run: 142 tests across all 8 packages, 0 failures. `pnpm typecheck`/`pnpm lint` exit 0 from repo root.

### 7. `apps/editor` — key list (TanStack Table) ✅

- [x] Table of keys for the selected project + locale (`ProjectView` + `KeyTable`), columns: key name, source text, target text, status (visually distinct `machine_translated` per spec via `STATUS_STYLES`, even though M2 has no MT yet — the visual treatment is worth building against the status enum now).
- [x] Filters: status, locale, namespace — namespace/locale select *which* key list is fetched (`GET /v1/projects/:project/keys?namespace=&locale=`), status narrows it further via the same endpoint's optional `status` query param.
- [x] Keyboard nav: arrow keys move the active cell (`KeyTable`'s active-cell state + roving `tabIndex` + focus-on-change) — this is the actual reason TanStack Table (headless) won the earlier decision over a grid with baked-in mouse-first UX.

**Design notes not in the original plan text:**
- Split into three commits: 7a (`Store.findProjectId`/`getProjectDetail`/`listKeys`, backend-only), 7b (the two HTTP endpoints), 7c (the editor UI). A fourth small commit added a 55-row `KeyTable` test to directly cover the outcome's literal "50+ seeded keys" claim, since inflating the real dev seed data with 47 throwaway keys would have been unrelated scope creep — the synthetic-fixture route (already the established pattern for `demo-web`/`packages/react` component tests) proves the same thing.
- `GET /v1/projects/:project` and `.../keys` are the **first routes to use `hasScopedRole`** (built in M2 step 3, sitting unused until now, exactly as that step's design notes anticipated): each resolves the project name to an id via `findProjectId`, then checks the caller's role assignments actually cover that project (instance-wide or project-scoped) before returning anything. Noted as a design point worth flagging: the existing save/claim/approve/send-back endpoints (steps 4-5) still only check role name via `requireRole`, not project scope -- a real gap, but not one this step's scope covers fixing (the M2 DoD only requires role-based rejection there); worth a hardening pass later.
- `listKeys` does a `LEFT JOIN` from `keys` to `translations` (not the `INNER JOIN` `getBundle` correctly uses for runtime delivery) — the whole point of the editor's key list is surfacing untranslated keys too, not just ones with existing translations. Missing rows coalesce to `status: 'untranslated'` and `targetText: ''`.
- No search box (F11 lists full-text search, but that's M5 per `03-later-milestones.md`) and no pagination — both explicitly out of scope for M2's "rough shape."

**Outcome:** ✅ verified via component tests (Testing Library/vitest — 25 tests total across `KeyTable`/`ProjectView`/updated `ProjectPicker`/`App`) including a 55-row `KeyTable` render+keyboard-nav test satisfying the "50+ seeded keys" claim directly, plus the corresponding backend tests (Store + HTTP, `hasScopedRole` enforcement). Filters narrow the list correctly (status via query param, locale/namespace via re-fetch on selector change) and arrow keys move the active cell without a mouse, including at row 55 and clamped at the grid's edges. Full workspace re-run: 207 tests across all 8 packages, 0 failures. `pnpm typecheck`/`pnpm lint` exit 0 from repo root; `vite build` production build succeeds.

### 8. `apps/editor` — inline translation editing + save ✅

- [x] Click (double-click) or keyboard-activate (Enter on a focused target-text cell) → inline editable field → save on blur/Enter, calls the step 4 save endpoint (`api.ts`'s `saveTranslation`, `PUT .../translations/...`).
- [x] Wires the step 5 conflict payload: a 409 keeps the cell in edit mode showing both the draft and the currently-stored value, with "submit anyway" (retries using the stored value as the new snapshot -- guaranteed to succeed since it now matches) and "cancel" (discards the draft) -- no raw error dialog.
- [x] Status updates optimistically (an internal per-key override map in `KeyTable`, since it doesn't own the row data source of truth) — shows a transient "saving…" the instant a save is committed, then reconciled to the real status once the response arrives.

**Design notes not in the original plan text:**
- `saveTranslation` (api.ts) never throws -- it returns a `SaveOutcome` discriminated union (`success` / `conflict` / `error`), since a save-time conflict is an expected, routine outcome the caller needs to react to, not an exceptional one worth a try/catch.
- `ProjectView` passes `key={`${namespace}-${locale}-${status}`}` to `KeyTable` so switching namespace/locale/status fully remounts it, resetting its internal editing/override state via React's own unmount/remount rather than requiring bespoke reset logic -- otherwise a stale optimistic override could leak into an unrelated key list.
- Only one cell is editable at a time (the target-text column); key/source/status cells stay read-only and display-only.
- Found and fixed a test-authoring pitfall while writing this step's tests, worth noting for future component tests here: calling the raw DOM `.focus()` method directly (not wrapped in `act()`) doesn't reliably flush the resulting React state update before the next synchronous line runs, unlike `fireEvent.focus(...)` which does. The existing arrow-key-navigation tests happened not to depend on this timing (their first active cell already matched the default state), but a new Enter-to-edit test exposed it.

**Outcome:** ✅ M2 DoD items 2 and 6, verified via component tests (16 new — 30 total in `apps/editor`) exercising the full edit → save → reconcile flow and the conflict → submit-anyway/cancel flow, plus a `vite build` production build. This sandbox has no browser, so — consistent with steps 6/7 — this is Testing Library-level verification of the actual behavior (real state transitions, real fetch calls asserted by request body/URL), not a manual click-through.

### 9. `apps/editor` — ICU per-branch editing ✅

- [x] For a key whose source is ICU plural/select, renders one editable slot per CLDR-required branch for the **target** locale. New API surface was needed (`extractPluralBranches`/`assemblePluralMessage`/`requiredPluralCategories`/`pluralBranchSlots` in `packages/icu`) since canonicalize/format didn't expose branch enumeration — checked what existed first, per the plan's own instruction, before adding it.
- [x] Missing branches shown distinctly: a category absent from the **target** (not the source — an untranslated key needs every CLDR-required slot, including ones the source itself already fills) gets a "falls back to the other branch at render time" note, except `other` itself.
- [x] Saving reassembles the branches back into one ICU string **client-side** (`apps/editor`'s `reassemblePluralEdit`, wrapping `packages/icu`'s `assemblePluralMessage`) before calling the existing save endpoint unchanged — no server changes needed. Per the plan's own resolution of the reassembly-location fork: the logic itself lives in `packages/icu` regardless of call site, so this was a "which side calls it" choice, not a re-opening of the design question.

**Design notes not in the original plan text:**
- Split into three commits: 9a (`packages/icu`'s branch extraction/reassembly + CLDR-category resolution via `Intl.PluralRules`, the same source of truth `format.ts` already relies on), a bug-fix commit (see below), 9b (`apps/editor`'s `computePluralEditState`/`reassemblePluralEdit`, deciding plurality from the **source** but slot fill/fallback from the **target**), 9c (wiring into `KeyTable`'s inline editor).
- **Found and fixed a real correctness bug** while writing 9a's tests: the first implementation of `assemblePluralMessage` parsed each branch's text in isolation (`parse(text)` per category) before reassembling a synthetic AST node. `#` (the plural pound placeholder) only tokenizes as such *within* a plural branch context — parsed standalone it becomes an ordinary literal character, which the printer then defensively re-escapes to `'#'` when placed back inside a plural context, silently turning a live "# items" placeholder into a dead literal that would render as the character `#` instead of substituting the count. The bug passed its own first round-trip test (extraction re-printed with `isInPlural=false`, which doesn't re-escape, masking the corruption at the text level) — only actually formatting the reassembled message with `packages/icu`'s own `format()` caught it. Fixed by building the full message text and parsing it once (`canonicalize`), the same way a translator manually editing raw ICU would naturally get it right.
- Found and fixed a UX bug while writing 9c's tests: blurring one branch input to focus a sibling branch input in the same per-branch editor was triggering a premature save on every field, since a plain `onBlur` can't distinguish "moved within this editor" from "actually left the cell." Fixed via `e.relatedTarget` containment-checked against the editor's own wrapping DOM node.

**Outcome:** ✅ editing `cart.items` for Arabic shows all six plural categories even though the English source only defines two, matching the exact CLDR-completeness guarantee `packages/icu`'s `format()` tests already proved for rendering — this is the same guarantee, now on the write path, verified by a dedicated regression test that actually formats the reassembled message rather than just re-extracting its text. 239 tests pass across the workspace (16 new: 13 in `packages/icu`, plus `apps/editor`'s `icuEditing`/`KeyTable` additions), `pnpm typecheck`/`pnpm lint` exit 0, `vite build` production build succeeds.

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
- ICU per-branch editing (step 9): went with `packages/icu` for the reassembly logic itself (`assemblePluralMessage`), called client-side from `apps/editor` before hitting the existing save endpoint unchanged — no server changes. Does that split feel right, or should the *decision* of which branches to keep/drop (currently `apps/editor`'s `computePluralEditState`, e.g. "which categories are required for this locale," "fall back to source vs. target structure") also move into `packages/icu` as a single higher-level function, rather than being split across the two packages?
- Anything about the auth/RBAC shape that felt like it'll fight the OIDC/custom-roles work later — better to hear now than after M3/M4 build on top of it.

More live-updating questions get parked in `04-open-questions.md` as they come up, same as M1.
