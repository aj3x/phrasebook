# Later Milestones (Outlines)

These are sketches, not commitments. Each expands into its own detailed file when its turn comes — after you've run M1 and told me what to prioritize.

## M2 — Editor + Auth

Expanded into its own detailed file: [`03-milestone-2-editor.md`](03-milestone-2-editor.md). Table lib (TanStack Table), auth library (better-auth), and session model (cookie sessions) are resolved — see that file's header and `04-open-questions.md`.

## M3 — Permissions, Owner Role & Onboarding

Expanded into its own detailed file: [`03-milestone-3-onboarding.md`](03-milestone-3-onboarding.md). Took the slot the CLI originally held (which moved to M4): a fresh instance had no way in — org, project, and privileged user existed only via `seed.ts` — and the Owner role + `"resource:action"` permissions table it needs sits underneath everything after it.

## M4 — CLI + JSON Adapter + Extraction

**Outcome:** `phrasebook init/push/pull/status/rename/diff` against a demo repo. JSON (i18next-shaped) adapter. Key extraction from source using regex/AST.

Rough shape:

- `apps/cli` — Bun single-file compile via `bun build --compile` (validates the single-binary story).
- API token auth. (The M2 outline assumed tokens would be created in the editor at M2; they weren't — nothing consumed them yet. The CLI is the first real consumer, so the mechanism lands here. Token scopes should reuse M3's permission grammar rather than inventing a second one.)
- `packages/adapters/json-i18next` — first format adapter, implements the `FormatAdapter` interface (§F8 pattern, but registered in-process only at this stage).
- Extraction: regex-based key extraction for a `t('foo.bar')` pattern; upgrade to AST later.
- `phrasebook rename A B` as first-class (§F6); walks translations, records the rename event.
- CI-friendly `phrasebook status` exit codes.

Open questions:
- Push behavior when local + server both changed a key: 3-way merge or force flag? (D7 says 3-way — implement it here.)
- Where the `phrasebook.config.ts` lives and its schema.

## M5 — Review workflow + MT + Notifications + Audit

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

## M6 — Plugins (in-process), TM/Glossary/DNT, QA, CI Action

**Outcome:** the rest of the §10 MVP list. Official plugin system (in-process), Translation Memory, Glossary + DNT flag (D19), inline QA checks, GitHub Action for PR-based string review.

Rough shape:

- Plugin manifest + lifecycle (§F8) — in-process only, no sandboxing yet.
- TM/Glossary schemas; fuzzy-match hooks in the editor; DNT highlighting.
- Inline QA runnable in both editor and CI (F6 + F11): placeholder consistency, HTML tag matching, max-length, glossary/DNT, missing translations.
- GitHub Action wrapping the CLI's `status`/`diff`/`lint`.

## M7 — Workspace Management

**Outcome:** workspaces stop being implicit. M3 creates exactly one automatically and never surfaces the concept; this is where multiple workspaces per org, and moving projects between them, become real.

Rough shape:

- Workspace CRUD + a picker in the editor; projects gain a "move to workspace" action.
- Workspace-level settings in the global → org → workspace → project → user hierarchy.
- Revisit the `workspace:view`/`update` vs `create`/`delete` split (M3 left Owner holding `workspace:*` and Admin holding only `workspace:view`) — if the carve-out chafes once workspaces are real, split the resource per M3's design rule.

**Already done in M3, so not repeated here:** `workspace_id` exists as a third scope dimension on `role_assignments` (nullable, NULL = all), and `workspace:create` is already an Owner-only permission. This milestone is therefore a UI/feature build, not a migration of live grant data — which was the point of carrying the column early.

## M8 — Git/Lite Driver

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

## M9+ — Phase 2/3 Surface

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

Each of M4–M8 gets a detailed file (M2's and M3's have landed: [`03-milestone-2-editor.md`](03-milestone-2-editor.md), [`03-milestone-3-onboarding.md`](03-milestone-3-onboarding.md)) once its turn comes and you've told me:

1. Whether the current shape (SDK, endpoints, DB schema, monorepo layout) needs to change before we build on it.
2. Which of the remaining outlines to attack first (they don't have to be in numeric order — M3 is the precedent).
3. Any spec item you want promoted earlier than shown here.
