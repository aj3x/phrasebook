# Open Questions

Running list. Not blocking M1 unless flagged **[BLOCKS M1]**. Feedback whenever — no rush.

## Blocking M1

None right now. Everything I need is decided (stack, mode, first slice).

## Nice-to-decide before M1 ships

- **Product/repo name.** Working with `phrasebook` (matches repo). If you'd rather the product be called something else, say now so I don't have to grep-replace later. Package scope becomes `@<name>/*`.
- **CLI binary name.** Spec uses `tms` as the working name. I've assumed `phrasebook` with a `pb` alias. Fine to change.
- **Missing-key SDK behavior.** Options: (a) return source text (my current pick — most permissive), (b) return the key name, (c) return a visible marker like `[home.hero.title]` in dev, (d) throw. Or a combination gated by env.
- **License headers in source files.** D15 is Apache-2.0 SDKs + AGPL server. Do you want a header in every file from day 1 (annoying but tidy), or a `LICENSE` per package (my default)?

## Resolved for M2 (2026-07-14)

- **Auth strategy for local users: better-auth.** Confirmed over Lucia (maintenance-mode) and a hand-roll on `oslo`.
- **Editor table library: TanStack Table.** Confirmed over AG Grid Community and Handsontable (AGPL-host licensing complexity).
- **Sessions vs JWT: cookie sessions.** Confirmed over stateless JWT. API tokens (separate mechanism, F3) cover CI/programmatic access.

## To decide by M3

- **Config file format for `phrasebook.config.ts`.** TypeScript (types + comments, needs build) vs JSON (no types) vs TOML. I lean TS for the type hints; happy to be talked out of it.
- **Extraction strategy.** Regex is fast to ship, AST-based (babel/swc/tree-sitter) is more correct. M3 probably starts regex + upgrades. Confirm okay to phase.

## To decide before M4

- **Queue library on Bun.** graphile-worker and pg-boss both use `pg`. Need a compat check before committing. If both fight Bun, we hand-roll a small SKIP LOCKED runner — it's a couple hundred lines. Blocking risk is low.
- **First MT provider.** DeepL (paid, best quality) vs LibreTranslate (self-hosted, air-gap default). Air-gapped mode (§F4) suggests LibreTranslate should be the first *self-hostable* option; DeepL should be the first *quality* option. Might be worth building both.
- **Redis for the optional queue backend adapter.** Assumed opt-in via env; the code path exists but isn't required. Confirm that matches your intent.

## Spec ambiguities I hit while planning

Flagging so you can either clarify or defer:

- **§4 "authoring-layer inheritance"** for regional variants in full mode: the spec says "full mode stores deltas relationally." M1 schema is single-locale-per-translation-row; the relational delta model needs schema thought before M4. Not urgent.
- **§6.2 write-ack levels** (`accepted` / `committed` / `pushed`) are exposed by the store interface. In full mode all three collapse to "committed on write." Do we still expose the tri-state to the SDK for uniformity, or only surface it when the git driver arrives? I lean "add it now, always return `committed` for Postgres" so the wire type is stable.
- **§F6 rename event** is called out as first-class. M1 has no editing so it doesn't matter, but by M3 (CLI has `rename`) we need to decide: is it a row in a `rename_events` table, or a first-class action logged to `audit_log` and interpreted from there? I lean dedicated table for query ergonomics; audit records it too.
- **§11 sidecar shape.** Only matters at M6; parking here.
- **Fallback-chain resolution rule for `zh-Hant`, `pt-BR` etc.** Region-only or script+region? Default BCP-47 traversal handles most cases but Chinese script (`zh-Hant → zh` shouldn't fall through to `zh-Hans`) needs a rule. Punt to M4 with a note.

## Things I've quietly decided but want to name so you can veto

Not asking; just being transparent. Any of these can be changed.

- **`@formatjs/intl-messageformat` version pinned to whatever's current when I start.** CLDR data comes with it. Bump = deliberate migration, not `npm update`.
- **Package scope `@phrasebook`.** Rename with the product-name decision above.
- **Kysely over Drizzle.** Called out in `01-repo-topology.md`; my reasoning is store-interface fit.
- **Hono over Fastify/Elysia.** Bun-native + Web Fetch shape.
- **Biome over ESLint+Prettier.** One tool.
- **`docker compose up` runs migrations and seed on first boot.** Convenient in dev; opt-out with `PB_SKIP_SEED=1` for real deploys.
- **Server binds `127.0.0.1` by default in dev.** Explicit `BIND_ADDR=0.0.0.0` to expose. Avoids surprising anyone.
- **No CI on M1's first commit.** GitHub Actions comes in when M1's structure is stable — no point rebuilding it three times during setup.
