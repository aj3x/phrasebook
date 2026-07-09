# Later Milestones (Outlines)

These are sketches, not commitments. Each expands into its own detailed file when its turn comes — after you've run M1 and told me what to prioritize.

## M2 — Editor + Auth

**Outcome:** log in, create a project + locales, add keys, edit translations in a keyboard-first workspace. Status transitions visible.

Rough shape:

- `apps/editor` (React + Vite + TanStack Query + a keyboard-first table lib).
- Auth: local username/password + session cookie. API tokens for CI (F3). OIDC deferred to M2.5 or later.
- Full status machine (§5) implemented server-side; UI shows status transitions.
- ICU editor: per-branch slot editing (§5 plural/ICU representation, D17). CLDR drives target plural forms.
- Assignment + workload view (uses `needs_review` queued vs `in_review` claimed).
- Comments/threads on keys and translations (also serves as the "TMS notes" per §4).
- Save-time original-vs-current comparison for the string-lock semantics (D22).
- Per-project auto-approve toggle; editing an approved translation resets status (D21).

Not in M2: MT, CLI, git driver, plugins, webhooks, notifications beyond in-app.

Open questions that block M2 kickoff:
- Which keyboard-first table lib? (TanStack Table + custom keybindings vs. AG Grid Community vs. Handsontable license-check.)
- Local auth: Lucia, better-auth, or hand-roll on `oslo`?

## M3 — CLI + JSON Adapter + Extraction

**Outcome:** `phrasebook init/push/pull/status/rename/diff` against a demo repo. JSON (i18next-shaped) adapter. Key extraction from source using regex/AST.

Rough shape:

- `apps/cli` — Bun single-file compile via `bun build --compile` (validates the single-binary story).
- API token auth (created in editor at M2).
- `packages/adapters/json-i18next` — first format adapter, implements the `FormatAdapter` interface (§F8 pattern, but registered in-process only at this stage).
- Extraction: regex-based key extraction for a `t('foo.bar')` pattern; upgrade to AST later.
- `phrasebook rename A B` as first-class (§F6); walks translations, records the rename event.
- CI-friendly `phrasebook status` exit codes.

Open questions:
- Push behavior when local + server both changed a key: 3-way merge or force flag? (D7 says 3-way — implement it here.)
- Where the `phrasebook.config.ts` lives and its schema.

## M4 — Review workflow + MT + Notifications + Audit

**Outcome:** MT batch (one provider, DeepL default), review send-back, needs_update cascade, in-app notifications, hash-chained audit turned on.

Rough shape:

- `QueuedRunner` implementation (Postgres queue via `SELECT … FOR UPDATE SKIP LOCKED`, worker process). Validate graphile-worker or pg-boss on Bun; fall back to a hand-rolled runner if either fights us.
- MT provider interface + one implementation (DeepL). BYO-LLM comes with plugin work (M5).
- Source-change cascade module (§F6): one module, one traversal — hash diff + variant chain walk.
- In-app notification center (F7). SSE endpoint. Webhooks deferred to M5.
- Hash-chain audit (D10) — schema was added in M1; enforcement lands here. Signed checkpoints exportable.
- Register + regional variants schema (§4).

Open questions:
- Do we ship MT in M4 or split it into M4a? MT alone is a milestone-sized surface.
- Which MT provider first? DeepL (best quality) vs. LibreTranslate (self-hostable, air-gap-friendly).

## M5 — Plugins (in-process), TM/Glossary/DNT, QA, CI Action

**Outcome:** the rest of the §10 MVP list. Official plugin system (in-process), Translation Memory, Glossary + DNT flag (D19), inline QA checks, GitHub Action for PR-based string review.

Rough shape:

- Plugin manifest + lifecycle (§F8) — in-process only, no sandboxing yet.
- TM/Glossary schemas; fuzzy-match hooks in the editor; DNT highlighting.
- Inline QA runnable in both editor and CI (F6 + F11): placeholder consistency, HTML tag matching, max-length, glossary/DNT, missing translations.
- GitHub Action wrapping the CLI's `status`/`diff`/`lint`.

## M6 — Git/Lite Driver

**Outcome:** deploy the same server against a git repo instead of Postgres. §11 in the spec.

Rough shape:

- `GitStore` driver behind the store interface (partial + sparse clone, worktrees, per-work-unit branches).
- SQLite index (`bun:sqlite`), rebuild-from-repo on sync.
- Git-provider adapter (GitHub first).
- Sidecar for workflow metadata (`.tms/status/…`, `.tms/glossary.csv`).
- Explicit-parent variant files for register/regional (delta-only, per OPEN-A resolution).
- `InlineRunner` becomes real (M1 used it as a stub); most work runs inline in the triggering request.
- Rename recorded to sidecar (spec §F6 caveat: git can't detect JSON key rename).
- Conflict UI: per-string 3-way merge, never raw `<<<<<<<` markers.

This is a big milestone. Might get further split.

## M7+ — Phase 2/3 Surface

Ordered by likely business value, not spec order:

- CDN-push delivery + content-hashed bundle publish (D11 opt-in).
- Webhooks with HMAC + retries (F7 full-mode).
- Figma import (F5).
- BYO LLM providers + prompt templates (F4 — the LLM half of MT).
- Custom roles + locale-scoped roles (F3).
- Community plugins: out-of-process, capability-based RPC broker, WASM for pure functions (D9 Phase 2).
- External search engine plugin (Meilisearch/Typesense/OpenSearch).
- Bidirectional Figma (Phase 3).
- Multi-tenant SaaS mode (Phase 3).
- GraphQL (Phase 3 — only if real demand appears, per D12).
- MySQL (Phase 3, D13).

## What each later milestone still needs

Each of M2–M7 gets a detailed file (`plan/03-milestone-2-editor.md` etc.) *after* M1 lands and you've told me:

1. Whether M1's shape (SDK, endpoint, DB schema, monorepo layout) needs to change before we build on it.
2. Which of the M2–M6 outlines to attack first (they don't have to be in numeric order).
3. Any spec item you want promoted earlier than shown here.
