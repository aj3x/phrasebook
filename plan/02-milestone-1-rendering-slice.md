# Milestone 1 — Rendering Slice

The first thing you'll run.

## Definition of done

You clone the repo, run `docker compose up`, run the demo app, and:

1. `http://localhost:5173` shows a page with a translated headline, a translated paragraph with an ICU plural (`"You have {count, plural, =0 {no items} one {1 item} other {# items}}"`), and a locale switcher.
2. Changing the locale switcher between `en`, `fr`, `fr-CA`, and `es` re-renders correctly.
3. Setting locale to `fr-CA` when only `fr` has a translation demonstrates the fallback chain rendering `fr` — no fallback string, no key-name-as-fallback (unless there's no chain match at all).
4. Changing an item count on the page produces the correct plural form per locale (English `one/other`, French `one/other`, Spanish `one/other`).
5. A page reload uses HTTP cache (server returns `304 Not Modified` on ETag match, verified in devtools).
6. Killing the server and reloading uses the SDK's in-memory cache (page still renders; no error UI).
7. `pnpm test` (or `bun test`) passes on server + core + icu packages.
8. `docker compose up` from a clean clone produces the above with no extra manual steps beyond a one-time `.env` copy.

That's it. That's the milestone. Everything below is how we get there.

## The vertical slice, in order

Each numbered item is roughly one commit. If any item balloons, we split it — don't let it become "and then I finished M1 in one huge PR."

### 1. Repo skeleton ✅

- [x] Delete the leftover `create-react-app` scaffolding at the repo root (done in a prior commit).
- [x] Create the directory layout from `01-repo-topology.md` (`apps/`, `packages/`, `docker/` shells with `.gitkeep`).
- [x] `pnpm-workspace.yaml`, root `package.json` with workspaces, `tsconfig.base.json` with `"strict": true` + `noUncheckedIndexedAccess`.
- [x] `biome.json` with sane defaults.
- [x] `.gitignore` (Bun, Node, Vite, editor, OS, Claude local settings).
- [x] `README.md` at root — tiny, links to `plan/`.

**Outcome:** ✅ `pnpm install` clean, `pnpm typecheck` exits 0, `pnpm lint` exits 0.

### 2. `packages/schemas` ✅

- [x] Zod schemas for the M1 wire types: `LocaleCode`, `NamespaceName`, `TranslationBundle` (`{ locale, namespace, version, keys: Record<string, string> }`).
- [x] Export inferred TS types.

**Outcome:** ✅ `@phrasebook/schemas` exports `LocaleCode`, `NamespaceName`, `TranslationBundle` (schema + inferred type) from `src/index.ts`. `bun test` passes (31 tests), `pnpm typecheck` and `pnpm lint` exit 0.

### 3. `packages/icu` ✅

- [x] Wrap `intl-messageformat` (the FormatJS runtime package; the plan's `@formatjs/intl-messageformat` name doesn't exist on npm) behind two exports: `format(source, locale, values)` and `canonicalize(source)`.
- [x] Pin exact versions (`intl-messageformat@11.2.10`, `@formatjs/icu-messageformat-parser@3.5.13`). `CLDR_VERSION.md` records that plural rules actually come from Bun's bundled ICU (Bun 1.3.14 → ICU 75.1 → CLDR 45), not from these npm packages — `intl-messageformat` defers to the runtime's native `Intl.PluralRules`.
- [x] Tests: format an English plural, a French plural, an Arabic plural (all six plural categories — proves CLDR is real), and canonicalize two whitespace-different-but-equivalent ICU strings to the same output.

**Outcome:** ✅ ICU works and is tested. `bun test` passes (16 tests, 3 files) in `packages/icu`. `pnpm typecheck` and `pnpm lint` exit 0 from repo root.

### 4. `packages/db` — minimal schema ✅

Migrations create *only* what M1 uses:

- [x] `organizations` (id, name)
- [x] `workspaces` (id, org_id, name)  — carried from day 1 per D1
- [x] `projects` (id, workspace_id, name, source_locale)
- [x] `locales` (id, project_id, code)  — one row per (project, locale), unique(project_id, code)
- [x] `namespaces` (id, project_id, name, authority)  — authority in `('code','platform')` via a DB-level `CHECK`
- [x] `keys` (id, namespace_id, name, source_text, source_hash)  — unique(namespace_id, name)
- [x] `translations` (id, key_id, locale_id, target_text, status, updated_at, version)  — unique(key_id, locale_id)
- [x] Kysely codegen from the schema; check into `packages/db/src/generated.ts`.

Deliberately absent from M1: `register`, `assignments`, `comments`, `audit_log`, `content_links`, `snapshots`. Add when their milestone lands. Schema is easier to *extend* than to speculate.

Also added `docker/docker-compose.yml` (Postgres 16, ahead of full step 11 — needed now so `packages/db` has something real to migrate against) and `.env.example` at repo root.

**Outcome:** ✅ with one caveat. `bun test` passes (4 tests, 14 assertions) — each migration's `up()` runs for real against `pg-mem` (an in-memory Postgres-wire-compatible engine), proving the SQL is valid Postgres and that every FK/unique/CHECK constraint actually rejects bad data (orphan FK, duplicate locale code, invalid authority, duplicate key name, duplicate translation). `pnpm typecheck`/`pnpm lint` exit 0.

**Not verified in this environment:** this sandbox has neither Docker nor a real Postgres, so `pnpm db:migrate` (the real `Migrator` + `kysely-postgres-js` + `postgres.js` path) has only been typechecked, not executed. Kysely's `Migrator` itself also can't run against pg-mem — its bookkeeping-table existence check issues a `!~` regex query pg-mem's catalog emulation can't execute — so the tests call each migration's `up()` directly instead. Before trusting this fully, run `docker compose -f docker/docker-compose.yml up -d` then `pnpm --filter @phrasebook/db db:migrate` against it once, and ideally regenerate `src/generated.ts` with `kysely-codegen` to confirm the hand-authored types diff clean against the real introspected schema.

### 5. `apps/server` — Store interface + Postgres driver

- [ ] `Store` interface in `apps/server/src/store/store.ts` — the minimal §6 subset M1 needs: `getBundle(project, locale, namespace) → { keys, version, etag }`, `putTranslation(...)` (used only by the seed for now).
- [ ] `PostgresStore` implementation in `apps/server/src/store/postgres.ts`.
- [ ] No git driver, no capability flags yet — but the interface is real and the file layout has room for `git.ts` alongside `postgres.ts`.

**Outcome:** the store abstraction lives from day 1. Adding lite mode later is an implementation swap, not a refactor.

### 6. `apps/server` — Hono app + runtime endpoint

- [ ] Hono app with one route: `GET /v1/runtime/:project/:locale/:namespace` → returns the bundle JSON.
- [ ] `ETag: "<version>"` header. Respect `If-None-Match` → `304`.
- [ ] `Cache-Control: public, max-age=60, must-revalidate`.
- [ ] CORS enabled for `http://localhost:5173`.
- [ ] Bind `127.0.0.1` by default. Config via env: `DATABASE_URL`, `PORT`, `BIND_ADDR`.
- [ ] Health endpoint: `GET /health` → `200 OK`.

**Outcome:** `curl http://127.0.0.1:3000/v1/runtime/demo/en/common` returns real JSON.

### 7. Seed script

- [ ] `apps/server/src/seed.ts`: creates a `demo` project with locales `en`, `fr`, `fr-CA`, `es`; namespace `common`; keys `home.hero.title`, `home.hero.subtitle`, `cart.items` (the ICU plural).
- [ ] Populates translations. `fr-CA` intentionally missing the plural to prove the fallback chain.
- [ ] Idempotent: re-run leaves the DB in the same state.
- [ ] Bun script exposed as `bun run seed`.

**Outcome:** `docker compose up` + one command = testable data.

### 8. `packages/core` — the framework-agnostic SDK

- [ ] `createClient({ endpoint, project, namespaces, defaultLocale, fallbackChain? })`.
- [ ] Bundle fetching with ETag revalidation and in-memory cache keyed by `(locale, namespace, version)`.
- [ ] Locale-fallback resolution when a key is missing in the requested locale: walk the fallback chain (F10). Default chain derived from BCP-47: `fr-CA → fr → en (source)`. Overridable.
- [ ] `t(key, values?)` — resolves ICU via `@phrasebook/icu`. Returns the source text if no translation and no chain match (better than exploding in the UI). Logs a warning in dev mode.
- [ ] Tests: mock the endpoint, verify fallback, verify ICU output, verify ETag revalidation caches.

**Outcome:** SDK works standalone. Any JS project could use it, not just React.

### 9. `packages/react` — React bindings

- [ ] `<PhrasebookProvider client={} locale={} onLocaleChange={}>` — provides the core client + current locale via context.
- [ ] `useT()` → returns the `t` function bound to the current locale.
- [ ] `useLocale()` → `[locale, setLocale]`.
- [ ] Suspense-friendly: initial load throws a promise; components using `useT` suspend until the first bundle is ready. (Alternatively: `isLoading` on the hook. Pick one — I lean Suspense; push back if you'd rather a hook flag.)
- [ ] Tests: render a component, verify plural + fallback.

**Outcome:** `<h1>{t('home.hero.title')}</h1>` works.

### 10. `apps/demo-web` — the consumer app

- [ ] Vite + React app.
- [ ] `<PhrasebookProvider>` wired to `http://localhost:3000`.
- [ ] Page renders the three keys.
- [ ] Locale switcher (`select` element) — `en / fr / fr-CA / es`.
- [ ] Item count input (`number` input) — feeds the plural `count`.
- [ ] Visible in the UI: current locale, resolved locale (after fallback), request URL. Helps debugging without needing devtools.

**Outcome:** the M1 experience. You open the app and see it working.

### 11. Docker compose

- [ ] `docker/docker-compose.yml`: `postgres:16`, `server` (built from `server.Dockerfile`).
- [ ] Volume for Postgres data.
- [ ] `docker/server.Dockerfile` from `oven/bun:1-alpine`; multi-stage: install → build → run.
- [ ] Compose runs migrations + seed on first start (via an entrypoint script).
- [ ] `.env.example` at repo root: `DATABASE_URL`, `PORT`, `BIND_ADDR`, `NODE_ENV`.
- [ ] Demo app is *not* in docker (it's a dev-machine Vite server) — keeps `docker compose up` fast.

**Outcome:** the 5-minute path works from a clean clone.

### 12. Documentation for M1

- [ ] Root `README.md` gets a "Try it" section: prerequisites, `cp .env.example .env`, `docker compose up`, `pnpm dev` in `apps/demo-web`, open `http://localhost:5173`.
- [ ] Short section: "What's in M1 and what isn't." Links to `plan/00-overview.md`.

**Outcome:** anyone (including future-you) can run this without asking.

## Explicit non-goals for M1 (repeat, for emphasis)

- No auth. No API tokens. Server binds localhost.
- No editor UI.
- No CLI, no adapters, no extraction.
- No MT, LLM, plugins.
- No `needs_update` cascade (there's no editing yet — status is seed-set to `published`).
- No git driver, no sidecar.
- No search, glossary, DNT, QA.
- No SSE. The M1 demo does not need real-time.
- No CDN-push. Client-pull only.

## Definition of feedback we want after M1

When you've run M1, some questions I'd like your take on before I start M2:

- Does the SDK's `t()` return-source-on-missing behavior feel right, or would you rather see a visible marker (like `[home.hero.title]`)?
- Is the ETag+in-memory cache combo enough, or do you want a persistent SDK cache (localStorage, IndexedDB) for offline?
- Editor priorities: keyboard-first spreadsheet-style vs form-per-key vs both?
- Auth at M2: local username/password only, or OIDC from day 1?
- Anything in M1 that felt wrong to touch — schema shape, package names, endpoint URL?

More live-updating questions get parked in `04-open-questions.md` as I hit them.
