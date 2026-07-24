# Repo Topology

## Directory layout

```
phrasebook/
├── apps/
│   ├── server/                  # Bun + Hono; the REST API + runtime delivery endpoint
│   └── demo-web/                # React + Vite; the M1 consumer app (uses @phrasebook/react)
├── packages/
│   ├── core/                    # @phrasebook/core   — framework-agnostic SDK (fetch, cache, ICU eval, fallback)
│   ├── react/                   # @phrasebook/react  — <Provider>, useT, thin wrapper over core
│   ├── db/                      # @phrasebook/db     — Kysely schema, migrations, generated types
│   ├── schemas/                 # @phrasebook/schemas — Zod schemas + inferred TS types shared server↔client
│   └── icu/                     # @phrasebook/icu    — thin wrapper around @formatjs; canonicalization + pinned CLDR
├── plan/                        # (this directory)
├── docker/
│   ├── docker-compose.yml
│   └── server.Dockerfile
├── .env.example
├── package.json                 # workspaces root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json                   # or eslint+prettier — see decision below
└── README.md
```

Grows over time. `apps/editor/` arrives at M2, `apps/cli/` at M4, `packages/adapters/*` at M4.

## Package boundaries — why each exists

- **`apps/server`** — the only long-running process. Owns the REST API, runtime delivery, migrations runner, and the JobRunner (M1: `InlineRunner`). Does *not* own domain logic other packages might want to share; that lives in `packages/*`.
- **`packages/core`** — framework-agnostic SDK. Named `@phrasebook/core`. Fetches from a runtime endpoint, caches by (project, locale, namespace) with ETag revalidation, evaluates ICU MessageFormat with plural fallback, and implements the F10 fallback chain (`fr-CA → fr → en`). No React deps. Consumable from any JS environment.
- **`packages/react`** — React bindings. `<PhrasebookProvider>`, `useT`, `useLocale`. Depends on `@phrasebook/core`. Thin — most logic is in core.
- **`packages/db`** — Kysely schema definitions, migrations, generated types. Owned separately so the CLI and workers (later) can share query builders with the server.
- **`packages/schemas`** — Zod schemas for API DTOs. The server imports these to validate requests; the SDK imports the inferred types. Single source of truth for wire formats.
- **`packages/icu`** — a thin wrapper around `@formatjs/intl-messageformat` for two reasons: (1) pin the CLDR data version in exactly one place; (2) expose the *canonicalization* function that §F6 wants (normalized content hash includes ICU AST canonicalization). Both `packages/core` (runtime) and `apps/server` (change detection) use this. Keeping it in one package prevents drift.

## Tooling decisions

### Server framework: **Hono**
Bun-native (Web Fetch APIs), tiny, TypeScript-forward. Fastify runs on Bun but is Node-shaped and heavier for what M1 needs. Elysia is Bun-native too but younger and TypeBox-first — Hono + Zod is a more portable pattern.

### DB access: **Kysely + `postgres.js`**
Kysely is a type-safe query builder (not an ORM) — a very clean fit for §6's "store is an interface, not a database" mandate. `postgres.js` is fast, Bun-friendly, and unpretentious. Drizzle is fine too; Kysely wins on ergonomics for hand-shaped queries and on migrator flexibility. Later, `bun:sqlite` gets a matching Kysely adapter for the lite-mode index.

### Migrations: **`kysely` built-in migrator**
Filesystem `packages/db/migrations/*.ts`. Run automatically on server boot in dev; explicit `pnpm db:migrate` in prod.

### Validation: **Zod**
Standard, wide adoption, works everywhere. `packages/schemas` owns the schemas; server + SDK + CLI import from there.

### ICU: **`@formatjs/intl-messageformat` + `@formatjs/intl`**
Reference implementation. Pin CLDR by pinning the FormatJS versions in `packages/icu` and never widening the range without a migration note (per §7).

### Editor bundler (M2+): **Vite + React + TanStack Query**
Vite = HMR + code splitting. TanStack Query = the server-state cache the editor needs. No meta-framework, per the reasoning doc.

### Lint/format: **Biome**
Single tool (no ESLint + Prettier split), fast, works with Bun, no plugin ecosystem to babysit at this scale. Push back if you prefer the ESLint route.

### Testing: **Bun test** for server + core; **Vitest + Testing Library** for React.
Bun's built-in runner is fast and requires zero config. Vitest for the browser-shaped code where JSDOM/Testing Library integration is best.

### Package manager: **pnpm**
Bun install can do workspaces but pnpm is the pragmatic pick for now — CI caching, hoisted-vs-isolated node_modules, Vite plugin compatibility all just work. Bun runtime for execution, pnpm for install. Revisit once Bun install matures further.

### Docker base image: `oven/bun:1-alpine`
Small (~90MB), official, matches the runtime.

## Naming

- **Product name in code:** `phrasebook`. Matches the repo. Package scope `@phrasebook/*`. Rename later if we pick a different product name — string is grep-replaceable.
- **CLI binary (M4):** `phrasebook` with `pb` alias. (`tms` in the spec is the working name — swappable.)

## Node compat notes (Bun caveats to watch)

- **`postgres.js`** — Bun-native, works. `pg` also works but slower on Bun.
- **`@formatjs/intl-messageformat`** — pure JS, works.
- **Kysely migrator** — pure JS, works.
- **Vite** — works on Bun, but node runtime for the dev server is more battle-tested. Use Bun for the app, but don't be shocked if Vite dev-server on Bun surfaces a bug we route around temporarily.
- **`better-sqlite3`** (future) — not needed; `bun:sqlite` replaces it.
- **`graphile-worker` / `pg-boss`** (future queue) — both use `pg`, should work on Bun; validate at M4 before committing.
