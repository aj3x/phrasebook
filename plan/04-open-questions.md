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

## Resolved for M3 (2026-07-19)

M3 became onboarding + permissions rather than the CLI (see `03-milestone-3-onboarding.md`).

- **Owner is a distinct role**, not "the first Admin." Full access; Owner-*only* powers are the container structure — creating workspaces, org-level actions, and defining roles.
- **Admins are full operators within a workspace** — they create projects and assign roles there.
- **Permissions table**, `"<resource>:<action>"` with `*` wildcards in either position (`project:view`, `project:*`, `*:*`). Additive-only, no deny rules (§D4).
- **Design rule: split resources rather than withhold actions.** Since there are no denies, the only way to withhold is to not grant — so a role needing most-but-not-all of a resource gets the resource split instead of a stale hand-maintained action list. Hence `role_assignment` (assign to people; Admin) vs `role` (define roles; Owner).
- **Viewers get concrete grants**, not `*:view` — least privilege, and `*:view` would expose users/invites/settings.
- **`workspace_id` joins project/locale as a scope dimension on `role_assignments` in M3**, though only one implicit workspace exists — D1's "carrying it is nearly free, retrofitting is brutal" precedent. Its purpose in M3 is to *exercise the scope matcher*, not to be a feature; refining the workspace structure is M7's job.

## Flagged for the permissions build-out (not deciding now)

- **Permissions may need to exist at project level *and* workspace level.** M3 keeps the axes separate — roles carry permissions, assignments carry scope — which already covers a lot ("Admin on workspace A" ≠ "Admin on project X"). The open part is whether the catalog should declare which level a permission applies at (cheap, additive), and, the real fork, whether *grants themselves* should carry scope so one role could hold different permissions at different levels (expensive to retrofit). **Hedge in the meantime:** the catalog stays the authoritative description of a permission, and no route handler hard-codes its own assumption about what scope a permission implies. See `03-milestone-3-onboarding.md` for the full note.
- **Invites: copy-link only**; `invite:create` is itself a permission, so granting it more widely later is a grant change, not a code change.
- **Bootstrap atomicity:** owner + org + default workspace atomic; project and survey optional follow-ons.
- **Workspaces stay implicit** until their own milestone (now M7).
- **Breaking changes acceptable** while in alpha — "drop and recreate the database" is a documented upgrade path.

## To decide by M4 (the CLI milestone)

Both were previously filed under M3; they belong with the CLI, which moved to M4. Not overdue.

- **Config file format for `phrasebook.config.ts`.** TypeScript (types + comments, needs build) vs JSON (no types) vs TOML. I lean TS for the type hints; happy to be talked out of it.
- **Extraction strategy.** Regex is fast to ship, AST-based (babel/swc/tree-sitter) is more correct. Probably starts regex + upgrades. Confirm okay to phase.
- **API token scopes.** The CLI is the first real consumer of API tokens. Tokens should carry M3's permission grammar rather than a second, parallel scope language — confirm.

## To decide before M5

- **Queue library on Bun.** graphile-worker and pg-boss both use `pg`. Need a compat check before committing. If both fight Bun, we hand-roll a small SKIP LOCKED runner — it's a couple hundred lines. Blocking risk is low.
- **First MT provider.** DeepL (paid, best quality) vs LibreTranslate (self-hosted, air-gap default). Air-gapped mode (§F4) suggests LibreTranslate should be the first *self-hostable* option; DeepL should be the first *quality* option. Might be worth building both.
- **Redis for the optional queue backend adapter.** Assumed opt-in via env; the code path exists but isn't required. Confirm that matches your intent.

## Spec ambiguities I hit while planning

Flagging so you can either clarify or defer:

- **§4 "authoring-layer inheritance"** for regional variants in full mode: the spec says "full mode stores deltas relationally." M1 schema is single-locale-per-translation-row; the relational delta model needs schema thought before M5 (register + regional variants). Not urgent.
- **§6.2 write-ack levels** (`accepted` / `committed` / `pushed`) are exposed by the store interface. In full mode all three collapse to "committed on write." Do we still expose the tri-state to the SDK for uniformity, or only surface it when the git driver arrives? I lean "add it now, always return `committed` for Postgres" so the wire type is stable.
- **§F6 rename event** is called out as first-class. M1 has no editing so it doesn't matter, but by M4 (CLI has `rename`) we need to decide: is it a row in a `rename_events` table, or a first-class action logged to `audit_log` and interpreted from there? I lean dedicated table for query ergonomics; audit records it too.
- **§11 sidecar shape.** Only matters at M6; parking here.
- **Fallback-chain resolution rule for `zh-Hant`, `pt-BR` etc.** Region-only or script+region? Default BCP-47 traversal handles most cases but Chinese script (`zh-Hant → zh` shouldn't fall through to `zh-Hans`) needs a rule. Punt to M5 with a note.

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
