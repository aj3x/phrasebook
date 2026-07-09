# Translation Management System — Foundational Specification (v2)

> Working name: **TMS** (rename later). This document defines *what the system is and how it must function*, at a level meant to be decomposed downstream: each **Pillar (F#)** maps to a Feature/epic, bullets seed Stories, edge-case items seed tickets.
>
> Marker legend:
> - **[ADDED]** — requirement beyond the original brief that the system realistically needs.
> - **[DECIDED: D#]** — a settled decision; see the Decisions Register (§13) for rationale.
> - **[ADDED]** items and the four **OPEN** items are now all resolved; §15 records where each resolution lives. There are no open questions remaining before generation.

---

## 1. Purpose & Vision

An open-source, self-hostable, stack-agnostic translation management system focused on **frontend localization**, so that:

- Developers wire it in fast and translate both **static UI strings** and **dynamic database values**.
- Translators, reviewers, and admins collaborate through a clear, role-based, human-in-the-loop workflow.
- It extends through plugins (official, then community) and integrates with design (Figma) and CI.
- Machine/LLM translation accelerates work but is never silently treated as human-approved.

Deployable by a solo developer with `docker compose up`; scales to a team without re-architecture.

## 2. Design Tenets (govern every feature)

1. **Agnostic by default** — no hard dependency on a framework, database, auth provider, storage, or LLM. Concretes sit behind adapters.
2. **Self-host first** — works fully offline/air-gapped. Telemetry off by default; no required SaaS dependency.
3. **Developer ergonomics** — "install" → "first translated string rendering" in minutes.
4. **Frontend-first** — runtime delivery, caching, fallback, and bundle size are first-class.
5. **Human-in-the-loop integrity** — machine output is always statusly and visually distinct from approved human work until reviewed.
6. **Everything toggleable** — major subsystems (audit, MT, notifications, plugins) turn on/off cleanly without breaking core.
7. **API-first** — the UI is one client; every action is programmatic.
8. **Safe extensibility** — community plugins cannot compromise the host or exfiltrate data without explicit grants.

## 3. Non-Goals & v1 Scope Cuts

Not a general CMS, not a CAT desktop tool, not hosted-only SaaS (multi-tenant is an optional mode). Does not ship its own LLM.

Explicitly **cut/deferred from v1** (each is a large surface that doesn't earn its keep in release one):

- **GraphQL** → deferred [DECIDED: D12].
- **Multi-DB** → Postgres + SQLite only at v1 [DECIDED: D13].
- **Bidirectional Figma** → import-only at v1 [DECIDED: D6].
- **Community / sandboxed plugins** → official, in-process plugins only at v1; isolation deferred to Phase 2 [DECIDED: D9].

---

## 4. Core Domain Model (shared vocabulary)

- **Organization / Workspace** — tenant boundary. Ship single-tenant, but every top-level entity carries `org_id`/`workspace_id` from day one [DECIDED: D1].
- **Project** — a translatable surface; owns locales and settings.
- **Namespace / Component** — logical grouping of keys; the unit of lazy-loading, ownership, **and translation-store authority** (§6).
- **Locale** — language + optional region + script (`en`, `pt-BR`, `zh-Hant`). One **source locale**, N **target locales**, with **authoring-layer inheritance** (below). Plural categories, RTL flags, and display names come from **CLDR** (§7); ships a built-in CLDR-derived language list, with custom plural forms and custom languages allowed.
- **Key** — stable identifier (`home.hero.title`) with metadata: description, context, screenshots, max length, tags.
- **Metadata authority** **[ADDED]** — resolved by **field ownership**, not one global rule (the D3 principle applied to metadata):
  - *Descriptive/technical fields* (source string, placeholders, developer description/context, **max-length — dev-owned as a hard UI constraint**) follow the namespace's content authority: in code mode incoming changes overwrite; in platform mode they're editable in the TMS.
  - *Process fields* (translator notes, review comments/threads, translator-facing screenshots, assignment, status, register, SLA) are **always platform-owned**; code never touches them. The "TMS notes" is not a new field — it **is** the Comment/Thread entity. Because no field is co-owned, metadata conflicts are impossible by construction.
- **Source string / Message** — canonical text in the source locale; format type (plain, ICU MessageFormat, HTML-bearing). Identified for change detection by a **normalized content hash** (§F6), not raw text.
- **Placeholder / variable (canonical model)** **[ADDED — load-bearing]** — the format-independent internal representation of interpolated values is **single curly braces `{name}`**. Every format adapter normalizes its own syntax (`%s`, `{{count}}`, `$1`, ICU args) into `{name}` on import and denormalizes on export. This one model is what content-hashing, QA, MT, and DNT all read. Placeholders are **do-not-translate by construction** (see DNT below).
- **Translation** — target text for a **(key, locale, register)** tuple, with a status (§5). Note the register dimension in the cardinality.
- **Register / Variant** **[ADDED]** — formal vs informal address (German *Sie/du*, French *vous/tu*, Japanese *keigo*). Modeled as an **explicit dimension** on the translation in full mode; in lite mode it's a **delta-only variant file with an explicitly-declared parent** (`de-formal → de`), resolved via chained fallback (§11).
- **Rename event** **[ADDED]** — a first-class record that `A` became `B`, carrying translations across. Rename is **not** delete+add (that silently drops all translations). See §F6.
- **Regional inheritance/override** **[ADDED]** — at the *authoring layer*, `es-MX` inherits `es` and stores only deltas; empty = inherit. Distinct from runtime fallback (F10), which only affects rendering. Full mode stores deltas relationally; lite mode uses delta-only variant files with declared parents (§11).
- **Content link** **[ADDED]** — for DB-value translation: a binding of (entity type, record id, field) to translatable units. TMS stores the link + last-seen source hash + translations + an optional cached source copy; it does **not** own the source [DECIDED: D3].
- **Glossary / Terminology** — approved term translations, suggested/enforced during translation and MT.
- **Do-not-translate (DNT) protection** **[ADDED — resolved]** — two mechanisms, no inline-span machinery at v1: (1) **placeholders are DNT by construction** (the `{name}` model above); (2) for literal in-text tokens that aren't variables — brand/product names, designated terms, code literals — a **"do not translate" flag on glossary terms**. Flagged terms are highlighted in the editor and QA-enforced, matching globally so "Acme" is protected everywhere at once. Inline one-off DNT spans are deferred unless a real need appears.
- **Translation Memory (TM)** — prior translations for reuse and fuzzy matching.
- **Comment / Thread** — discussion on a key or translation; required on review send-backs (§5).
- **Assignment** — a translator/reviewer scoped to (locale, namespace/project).
- **Due date / Review SLA** **[ADDED]** — a real domain entity owned here, not an implicit attribute; drives deadline notifications and workload views.
- **Context binding** **[ADDED]** — attached context/screenshots are bound to a **source version**; when source moves past that version, context is flagged **"may be stale."**
- **Versioning** — mode-dependent, to avoid two competing branching concepts [DECIDED: D-Branch, see §6]:
  - *Git authority mode*: **git is the versioning.** No internal VCS layered on top.
  - *DB authority mode*: lightweight **named snapshots**, not a full internal merge engine.

---

## 5. Translation Status Model (the workflow spine)

One state machine per **(key, locale, register)**. Cleaned to remove the earlier `machine_translated`/`needs_review` overlap:

- `untranslated` — no target content.
- `machine_translated` — MT output, **untouched by any human**. Visually distinct everywhere. Sitting in a review queue is *not* a separate status — it's just `machine_translated` awaiting a reviewer.
- `needs_review` — **human-authored content, queued, unclaimed.** The moment a human edits an MT string it becomes this (it is now human-authored awaiting approval).
- `in_review` — **claimed by a reviewer.** The `needs_review` → `in_review` distinction is *queued vs claimed*, kept for workload views.
- `approved` — reviewer approved.
- `published` — delivered to runtime / merged (git mode).
- `needs_update` — source changed (per normalized content hash) after approval. **Distinct from rejection.**
- `deprecated` — key removed from source. **Soft-delete: translations retained, state is restorable.**

Transitions of note:
- MT never enters `approved`/`published` directly.
- Human edit of MT: `machine_translated` → `needs_review`.
- Reviewer claim: `needs_review`/`machine_translated` → `in_review`.
- **Send-back (explicit):** `in_review` → `needs_review`, **requires a comment.** Rejection must never be conflated with `needs_update`.
- Source change: `approved`/`published` → `needs_update`.
- Deprecation is reversible: `deprecated` → prior state (restore).

`approved` and `published` stay **separate** to enable release gating and staged publishing; a per-project **auto-publish-on-approve** flag collapses them for simple users [DECIDED: D14].

**Approval workflow (separation of duties).** Default is **translator auto-approve** — a translator's save goes straight to `approved` (small teams need no second pair of eyes). A per-project setting disables auto-approve to require a **separate reviewer** (`needs_review` → `in_review` → `approved`); translators *may* approve their own work only while auto-approve is on. **Editing a string that was already reviewed/approved resets its status** back into the review flow (or straight to `approved` under auto-approve). **[ADDED]**

**Plural / ICU representation.** A translation holds the **standard ICU structure**; each plural/select branch is an **independently editable slot** (edited like any variable, per decision). **CLDR** determines which branches the *target* locale requires (an `en` source `one/other` still shows an Arabic translator all six), and a missing branch **falls back to `other`** per the CLDR spec, so the editor never forces every form to be filled. **[ADDED]**

---

## 6. The Store Interface & Authority Model (architectural spine)

This is the load-bearing abstraction that keeps **full mode** (Postgres) and **lite mode** (git) from becoming two of everything. They do **not** coexist in one instance — a deployment is one or the other (see 6.1). The shared interface is what makes the differences deployment-level rather than tangled together, and what makes a later lite→full migration cheap. **Read this before the pillars — it constrains them.**

### 6.1 Deployment mode, then per-namespace authority [DECIDED: D2]
A deployment is **one mode**, chosen at setup and not mixed:
- **Full mode (Postgres)** — the platform is the store. Within it, each namespace declares an authority, mutually exclusive:
  - `code` — keys authored in code, extracted up (default for `tms init`).
  - `platform` — keys authored in the TMS UI.
- **Lite mode (git)** — a git repository is the durable store; **git mode is always lite mode and vice versa** (§11). It is a whole deployment, not a per-namespace value you can mix into a Postgres instance. Authority is implicitly git/code.

This coupling is a real simplification: it moves the capability and write-semantics differences (6.2) from *per-namespace-within-an-instance* up to *deployment-level*, so the editor never juggles a durable-synchronous store and an eventual-push store at the same time.

Declaring authority makes the sync engine's conflict behavior **deterministic**: the non-authoritative side is flagged, never silently wins [DECIDED: D7].

### 6.2 The store is an interface, not a database
Both Postgres and git are **drivers** behind one interface: write a translation; query by key/locale/register/status/namespace; list changed keys since a version; rename; soft-delete/restore; snapshot. The editor, QA engine, RBAC, workflow, and notifications call the interface and (mostly) don't care which driver is underneath.

Two things break the "don't care" illusion, and the interface must make them explicit rather than hide them:

**(a) Write-acknowledgment level.** A write in full mode is *committed-durable synchronously* (milliseconds). A write in lite mode is *accepted-local* immediately (server working copy), *committed-durable* on a debounced commit (seconds), and *pushed* only on a batched push — which **can fail** at push time (merge conflict, provider rate limit). The interface returns the achieved ack level (`accepted` / `committed` / `pushed`) so the UI reflects reality instead of pretending every save is durable. This is a real semantic difference, not an implementation detail.

**(b) Capability flags.** Each mode advertises capabilities; features check them and **degrade gracefully** rather than erroring:

| Capability | Full mode (Postgres) | Lite mode (git) |
|---|---|---|
| Transactional / synchronously-durable write | yes | no (eventual) |
| Concurrent editors on same locale+namespace | yes | weak (branch conflicts) |
| Register as explicit dimension | yes | no → parent-declared variant files (§11) |
| Regional delta/override storage | yes | delta-only variant files (§11) |
| Rich workflow metadata (claim, SLA, MT flag) inline | yes | via minimal sidecar only |
| Full, chained audit trail | yes | git history is the audit (§11) |

The honest summary: **git "lite" mode is genuinely lite.** It trades away not just concurrency but a slice of the richer domain model (register-as-dimension, regional deltas, some workflow metadata), which either degrades to file conventions/sidecars or isn't available. That is consistent with "pick one truth per project" — but it means several §4 enrichments are **DB-mode capabilities**, and the generation must treat them as capability-gated, not universal.

### 6.3 Job execution — the second mode-bound abstraction
Deferrable work (git clone/commit/push, MT batches, webhook delivery + retries, notification/email fan-out, index rebuild, large import/export, the source-change cascade, Figma sync, search reindex) runs through one `JobRunner { enqueue, schedule, status, cancel }` interface with two implementations bound to deployment mode — same pattern as the store.

- **Lite mode → `InlineRunner` (synchronous-first, single process, no queue, no Redis, no separate worker).** This is the maintenance win: almost everything runs **inline in the triggering request** with a loading state the user waits on. Save writes the server-side working copy instantly, commits locally (fast), and pushes inline (the only slow/failure-prone step — on conflict the per-string merge UI opens immediately; on rate-limit a couple of inline retries, else the commit is marked *committed-not-yet-pushed* and flushed on the next save). The inbound push webhook runs its diff + index-update + `needs_update` cascade **inline within the handler**. The **only** escape hatch: an operation that would exceed an HTTP timeout (initial big clone, a large optional MT batch) spawns an **in-process deferred executor** — one background thread draining a SQLite `jobs` row the UI polls, purely for crash-visibility/resume. That is the entire async surface of lite mode.
- **Full mode → `QueuedRunner` (a real queue).** Default backend is a **Postgres-backed queue** (`SELECT … FOR UPDATE SKIP LOCKED`) — no infra beyond the Postgres already running, and transactional with the data; an **optional Redis/broker adapter** (plugin) covers high throughput. A separate, horizontally scalable **worker pool** executes; the web process only enqueues. Jobs carry idempotency keys, exponential-backoff retries, max-attempts + dead-letter, visibility timeout, priority, and **delayed/scheduled** execution (this powers SLA/due-date reminders and webhook retry backoff, via a cron-like scheduler).

Features enqueue mode-agnostically; the difference is deployment-level, consistent with the git⟺lite coupling. Webhook delivery with minute-scale backoff is intrinsically background work — but lite has no webhooks, so it never hits this, and full mode has the queue for it. **[ADDED]**

---

## Feature Pillars

### F1 — Developer Integration & SDKs
- REST API + typed SDKs: React, Vue, Svelte, Angular, vanilla JS, plus a framework-agnostic core.
- **CLI** (`tms`): `init`, `extract`, `push`, `pull`, `status`, `diff`, `lint`, `rename` (see F6). Primary dev sync surface.
- File-format adapters (as plugins, F8): JSON (i18next / FormatJS), YAML, gettext `.po/.pot`, XLIFF, Android XML, Apple `.strings`/`.stringsdict`, Flutter ARB, CSV. Each adapter normalizes placeholders to the `{name}` canonical model (§4) on import and back on export; export is lossless enough that teams can leave (no lock-in).
- **Import conflict handling** **[ADDED]** — on importing a file that overlaps existing keys, show a **comparison of all overlapping keys** and ask the user to proceed with **overwrite** or **new-keys-only**.
- Key extraction from source to auto-register/update keys.
- Local dev mode: pseudolocalization, missing-key highlighting, in-context editing.
- Authority: in full mode a **per-namespace setting** (`code`/`platform`), `tms init` defaults to `code`; lite mode is git-authoritative by construction [DECIDED: D2].

### F2 — Database / Dynamic Content Translation
- Content-translation model keyed by (entity, record id, field); runtime resolve API with fallback.
- TMS stores link + last-seen source hash + translations + optional cached source; host DB stays authoritative [DECIDED: D3].
- Lifecycle: runtime create/update/delete surfaces as new units / `needs_update` / `deprecated`.
- Bulk strategies for high volume: pagination, partial sync, rate limits. **[ADDED]**

### F3 — Identity, Roles & Permissions (RBAC)
- Built-in roles: Admin, Developer, Translator, Reviewer, Viewer.
- Admins create **custom roles** from granular primitives (read keys, edit translation, approve, manage members/settings/plugins, view audit, configure MT/LLM, manage webhooks…).
- **Language-dependent roles** — scoped to specific locales; scope dimensions: locale, project, namespace.
- **Additive-only permissions** (no explicit deny); "revoke everything now" is a user-level **suspended/locked** flag, not a deny system [DECIDED: D4].
- Pluggable auth: local + OIDC/SAML/OAuth (F8). Service accounts / scoped API tokens for CI. **[ADDED]**
- **Approval mode is a project setting** (§5): default **translator auto-approve**; toggle on a mandatory separate-reviewer workflow when a second pair of eyes is required. Lite mode ships fixed roles (translator/reviewer/dev) + locale scoping, no custom-role creation (§11). **[ADDED]**

### F4 — Machine & LLM Translation
- Built-in MT providers behind one interface: DeepL, Google, Azure, AWS Translate.
- **Bring-your-own LLM**: OpenAI, Anthropic, local/Ollama, custom endpoint; prompt templates; glossary/TM/DNT injection; per-project config.
- Output enters as `machine_translated` — never auto-approved.
- Cost & privacy controls: rate limits, budget caps, and a **hard air-gapped switch** disabling all external calls. **[ADDED]**
- Secrets: **org-scope default, project-scope override**; envelope encryption (AES-256-GCM), key from env or pluggable KMS/Vault; write-only via API (show last-4, never returned or logged) [DECIDED: D5].

### F5 — Figma Integration
- **Import-only at v1** [DECIDED: D6]: pull text-layer strings + context/screenshots in; push translations back for **preview only**. Design is a context provider, not a source of record. Bidirectional is Phase 2.

### F6 — Change Detection & Sync (Commands)
- **Normalized content hash** is the change-detection primitive. Normalized: insignificant whitespace, developer comments/notes, ICU canonicalized to its AST (whitespace-inside-ICU and equivalent forms collapse; **placeholder/variable set and markup structure changes remain meaningful**), escaping. A raw edit that canonicalizes identically does **not** trigger `needs_update`. **[ADDED — load-bearing]**
- Changed source → dependent approved translations → `needs_update`; removed → `deprecated` (soft, restorable).
- **Rename is first-class.** `tms rename A B` (or detected as: same content hash + old key gone + new key appeared → offer to carry translations). Especially important in git mode, where a JSON-key rename is invisible to git *and* matches the old hash. **[ADDED]**
- **Destructive sync is guarded:** any bulk deprecate/delete supports `--dry-run` and a confirmation gate. Bulk namespace removal must never irreversibly nuke approved translations. **[ADDED]**
- CI integration (GitHub Action / generic) with PR-based review of string changes. **[ADDED]**
- **String-lock semantics** **[ADDED]** — rely on the DB (status) for now, not a hard lock. When a translator picks up a string it's marked *being translated*, which discourages others from grabbing in-progress work (fewer collisions). Others *may* still edit; the guard is at **save time**: the client keeps the original text and the draft, and on submit compares the original against the current stored value. Unchanged → save + advance status. Changed but identical translation → fine. Changed with a *different* translation → alert the user, show how the two differ, keep their draft in the field, let them submit-over or cancel. A frontend-side lock can be added later if needed.
- Residual conflicts (authoritative source changes mid-edit): optimistic concurrency (version/etag per translation) + locking; on collision, **3-way merge** (base/theirs/yours), never silent last-write-wins. Branch-based merge is git mode's native answer [DECIDED: D7].
- **Single source-change / inheritance module.** The content-hash diff and the explicit-parent variant resolution (§4, §11) live in **one module**: when a base string changes, the same pass that detects it walks the variant chain to find overrides built on the now-stale source and marks only those `needs_update`. One traversal, one source of truth for "who inherits what," so the cascade stays cheap and can't drift between two implementations. **[ADDED]**

### F7 — Notifications
- In-app notification center with per-user preferences.
- Triggers: assignment, `needs_update`, review requested, @mention, MT batch complete, **due date / SLA approaching** (owned by the Due-date entity, §4).
- **Webhooks** (full mode): configurable subscriptions, **HMAC signing, retries with backoff, delivery log + replay.** Envelope `{ id, type, occurred_at, actor, project, data, delivery_attempt }`, idempotency id, versioned schema, at-least-once. **Canonical event catalog** **[ADDED]**: `translation.{created,updated,status_changed,machine_translated,published}`, `key.{created,updated,renamed,deprecated,restored}`, `source.changed`, `review.{requested,approved,rejected}`, `assignment.{created,completed}`, `comment.created`, `project.{locale_added,locale_removed}`, `mt.batch_completed`, `import.completed`, `export.completed`.
- **Email / SMTP channel** **[ADDED]** — env-configured, **optional** (unset → in-app only). Templated for assignment, review result, `needs_update`, invite, and password reset. In lite mode, email-based invites/resets need SMTP; without it, the admin copies invite/reset links by hand. Optional SES/SendGrid provider plugin in full mode.
- Real-time transport: **SSE with polling fallback; no WebSocket at v1** (one-way server→client; rides plain HTTP, no sticky sessions) [DECIDED: D8].

### F8 — Plugin System
- Extension points: MT/LLM providers, format adapters, auth providers, notification channels, storage/git-provider backends, workflow steps, UI panels.
- Manifest (id, version, requested capabilities/permissions, compatibility, **license**) + lifecycle (install/enable/disable/upgrade).
- **v1: official, in-process only.** Phase 2 community plugins: out-of-process, **capability-based RPC broker** (only manifest-granted capabilities); WASM preferred for pure-function plugins (format converters, QA checks), subprocess-with-broker for IO plugins (MT, auth) [DECIDED: D9].

### F9 — Audit Logging & Configurable Settings
- Append-only audit log: actor, action, target, before/after, timestamp, source (UI/API/plugin).
- **Hash-chain always on** (each entry carries the prior entry's hash — cannot be retrofitted); exportable **signed checkpoints** for compliance; external notarization is a Phase-2 plugin [DECIDED: D10]. Note: in git mode the trail is **partial** (out-of-band repo writes bypass the server — see §11).
- **Per-translation history** **[ADDED]** — the editor's "who changed X→Y when" timeline is a **user-visible, filtered slice of the audit log**, not a separate store: a translation-scoped audit table (or view) keyed by **item ID + change type**, so a translator sees a clean per-string history without exposing the full system audit. In lite mode, git log/blame provides this for free.
- Easy on/off toggles; settings hierarchy **global → org → project → user**, child overrides parent where allowed.
- Feature flags so disabling a subsystem hides it cleanly rather than erroring.

### F10 — Frontend Runtime Delivery
- **Both delivery models** [DECIDED: D11]: default **client-pull** of versioned, ETag'd, per-namespace JSON from the runtime endpoint (no extra infra for the compose user); opt-in **CDN-push** on publish of immutable content-hashed bundles + a tiny manifest (locale+namespace+version → URL), client caches hash-named bundles forever and revalidates only the small manifest.
- OTA updates (publish without redeploy), lazy-load per route/namespace, configurable **fallback chains** (`fr-CA → fr → en`) — rendering-time only; distinct from authoring inheritance (§4).
- ICU MessageFormat: CLDR plurals, select/gender, number/date/currency, RTL/bidi. **[ADDED — i18n correctness]**
- In git mode, delivery is **whatever the repo's existing build/deploy already does** (merge to `release` triggers it); no separate runtime server required (§11).

### F11 — Translation Workspace (Editor UX)
- Key list; filters by status/locale/register/namespace; source + context + **staleness flag**; MT suggestions; TM/glossary hints; **DNT terms highlighted** (from the glossary DNT flag, §4); comments.
- **ICU editing** — each plural/select branch is an editable slot (like a variable); target-locale branches driven by CLDR, missing → `other` (§5). **[ADDED]**
- **Search** **[ADDED]** — full-text over source/translation text plus fuzzy/substring key lookup. Full mode: **Postgres FTS (`tsvector` + GIN) + `pg_trgm`**; index per-locale (or use `simple`/`unaccent` + trigram) to avoid wrong-language stemming across target locales. Lite mode: **SQLite FTS5** over the local index. Optional external engine (Meilisearch/Typesense/OpenSearch) as a plugin for teams needing typo-tolerance/facets — never required. Structured filters are plain indexed columns, not search.
- Inline QA (also runnable in CI, F6): placeholder/variable consistency, HTML tag matching, max-length, glossary adherence, DNT violations, missing translations. **[ADDED]**
- Bulk actions; keyboard-first; clear visual marking of `machine_translated`; reviewer send-back with required comment.
- Assignment/workload view (uses `needs_review` queued vs `in_review` claimed, plus SLA).

---

## 7. Cross-Cutting Concerns

- **i18n correctness** — pluralization, gender/select, bidi/RTL, placeholder & markup safety, escaping. A quality bar across all pillars.
- **CLDR as the locale-data dependency** — plural rules, RTL flags, and locale display names come from **Unicode CLDR** via a maintained library (ICU4J/ICU4C, Format.js / `Intl.PluralRules`, Babel, or `intl_pluralrules`), never hand-rolled. **Pin the CLDR version**; plural rules change between releases, so a bump is a deliberate migration, not an automatic upgrade. **[ADDED]**
- **Search** — Postgres FTS + `pg_trgm` (full), SQLite FTS5 (lite), optional external-engine plugin; details in F11. **[ADDED]**
- **Security & privacy** — RBAC on every endpoint, secret envelope encryption, plugin sandboxing (Phase 2), CORS/CSP for runtime delivery, optional PII handling for dynamic content, air-gapped mode.
- **Performance & scale** — large key counts, many locales, high-volume dynamic content, efficient diffing/delivery.
- **Observability & ops** — health checks, metrics, structured logs, DB migrations, backup/restore.
- **Dogfooding** — the TMS UI is itself localizable.

## 8. Deployment & Agnosticism

- Packaging: Docker image, `docker compose` (simple path), Helm chart (k8s). **[ADDED]**
- DB: **Postgres (sole production) + SQLite (dev/tiny)** behind a repository layer that keeps MySQL *possible* but unsupported/untested at v1 [DECIDED: D13].
- Object storage: local FS default, S3-compatible optional (screenshots/assets/large context).
- Cache: optional Redis; degrade gracefully without it.
- **Job execution** (§6.3): lite = in-process `InlineRunner`, no queue; full = Postgres-backed queue by default, optional Redis/broker adapter + separate worker pool.
- **SMTP**: optional; unset → in-app notifications only (F7).
- Config: 12-factor env + optional config file; no required external services for the minimal deployment.

## 9. API & Interface Surface

- **REST-only at v1** [DECIDED: D12]: versioned, OpenAPI-generated, filtering/pagination/sparse-fieldsets. GraphQL is Phase 3 if real demand appears.
- Outbound webhooks (F7); SSE real-time channel (F7); API keys/OAuth tokens with scopes (F3).

---

## 10. Suggested Phasing

- **MVP**: domain model + status machine, projects/locales/keys/register, RBAC (built-in roles), REST + one SDK + CLI (`push`/`pull`/`status`/`rename`), 2–3 format adapters, editor, client-pull runtime delivery with fallback, one MT provider + BYO-LLM, in-app notifications, hash-chained audit with on/off, Postgres+SQLite, Docker compose. Content-hash change detection and dry-run guards in from the start.
- **Phase 2**: custom & language-scoped roles, CI integration + PR review, webhooks, Figma import, plugin system (official, in-process→out-of-process), TM/glossary/DNT, QA checks, CDN-push delivery, git authority mode hardening.
- **Phase 3**: community plugin registry (sandboxed), bidirectional Figma, MySQL, multi-tenant SaaS mode, GraphQL, UI plugins.

## 11. Lite Mode (git) — "git mode is always lite mode"

Lite mode uses git as the durable store, implemented as a **git-backed store behind the same store interface** (§6). It is a distinct **deployment mode**, not a per-namespace value mixed into a full-mode instance. Because git isn't queryable, the store maintains a **local index (SQLite, rebuilt from the cloned files on each sync)**: git is the durable truth; the index is a disposable cache that makes git answerable.

**Scope & product thesis (very lite)** [RESOLVED, was OPEN-C]. Lite mode targets **small teams, single project, one repo per instance** (multiple projects = multiple setups). It sits on a spectrum — *file-export-only (no host)* ↔ **lite = this hosted thin git-layer** ↔ *full DB mode* — and the store interface (§6) makes moving up non-catastrophic (the lite→full upgrade is "read from the git driver, write to the Postgres driver"). The thesis: **translators live in the web UI and never touch git; devs live in git and own the MRs; the layer maps between them.** Consequences: translators do **not** need git accounts (the bot is the only git identity; `Co-authored-by` preserves attribution); infra is **SQLite index + a single process, no Postgres/Redis**; roles are fixed (translator/reviewer/dev) + locale scoping, no custom-role creation; notifications are in-app + optional email; **no plugins, webhooks, multi-project, or CDN**; MT is optional and off by default. **Accounts** are the simplest workable scheme: **invite link → set password → password reset** (no OIDC/SAML in lite; email-based invites/resets need SMTP, else links are copied by hand). Jobs run **inline/synchronously** (§6.3) — the user waits on results rather than the deployment running a queue.

**Repo topology & consumption (a recommendation, not an app feature).** The TMS only writes translations to a configured `(repo, path)` via the bot; **translators have no git access in any topology** — same-repo or separate-repo, the bot mediates every write and ties the acting user into the commit (`Co-authored-by`). *How the application consumes those translations is a developer decision outside the TMS's scope* — the TMS is agnostic to it. Guidance we give, in order of preference:
- **Separate translations repo, app fetches published bundles** (recommended default). The translations repo's own CI publishes locale bundles on merge-to-base; the app pulls them at runtime (F10 client-pull) or downloads at build. The code repo never references the translations repo — no submodule, no dependency bump. The main reason to prefer separation: the **bot is the universal write path for every translator, so its token is the deployment's most sensitive credential** — scoping it to a translations-only repo means a leak vandalizes strings but can't touch code.
- **Versioned package/artifact** (`@org/translations@1.4.0`) if a build-time dependency is wanted — reproducible and decoupled, bumped like any dependency.
- **`i18n/` subfolder of the code repo** for the smallest teams wanting zero extra setup — cost is the wider bot-token scope; fence it with branch protection + CODEOWNERS so the bot writes only translation paths.
- **Submodules: possible but discouraged.** The parent repo pins a submodule SHA, so every translation update needs a dev to bump the pointer — recurring dev work that undermines the "translators are invisible to devs" goal; using `submodule update --remote` to avoid that throws away the reproducible pinning that is the only reason to use submodules. Prefer published bundles or a package.

**Flow.** A git-provider adapter (GitHub/GitLab/Gitea/Bitbucket — itself a plugin) authenticates via app token / service account and subscribes to push webhooks on a configurable base branch (e.g. `release`). On assignment it does a **partial + sparse clone** — `git clone --filter=blob:none --sparse` then `git sparse-checkout set` scoped to the assignment's locale/namespace dirs — and uses `git worktree` to avoid re-cloning per branch. This is what makes the mode survive a monorepo. It branches **per work-unit — `i18n/<locale>/<namespace>`, not per user** (see the concurrency note below for why) off the base branch and **opens the MR as a draft early** (at branch creation), so CI runs the F11 QA checks continuously as a status check and reviewers see progress. Multiple translators may contribute to one work-unit branch, coordinated by string locking so no two hold the same key. "Mark complete" flips the draft to ready and assigns reviewers from the RBAC/Assignment mapping. One MR per work-unit gives reviewers a coherent scope ("French checkout") and maps cleanly to `published`-on-merge; **devs still own the merge.**

**Saves.** The editor keeps a **server-side working copy** between pushes; commits are **debounced/coalesced** (one logical commit per save batch, batched to respect provider rate limits) with a `Co-authored-by: <translator>` trailer so blame and OSS attribution survive bot commits.

**Status → git mapping** (nearly free): `untranslated` = key present in source / empty target; `needs_review` = MR ready; `in_review` = reviewer engaged; `approved` = MR approved; `published` = merged to base; `needs_update` = source changed on base after approval (webhook diff → rebase → surface conflicts as 3-way merge in the editor); `deprecated` = key removed from source.

**Where the model doesn't fit git — the real design forcing functions:**
- **Status/workflow metadata has no native home.** Git can store translatable content; it cannot store `machine_translated`, claim/`in_review` state, assignment, SLA/due, register (when modeled as a dimension), rename events, or context-version bindings. These live in a **sidecar** (`.tms/status/<namespace>.<locale>.json`, plus PO `fuzzy` for `machine_translated` where the format supports it). Be honest: **the sidecar is a partial second store** — git is truth for translatable content, the sidecar is truth for TMS workflow metadata. Keep it minimal — in lite mode it holds only what translators/devs need (claim state, MT flag, rename events, assignment); everything heavier is out of scope by design (§ Scope above).
- **Register and regional variants are delta-only files with base fallback** [RESOLVED, was OPEN-A]. Each variant is its own file (`de-formal.json`) storing only overrides; unset keys fall back to the base (`de`), chaining up for nested variants. Because register isn't a standard BCP-47 subtag, the chain is **not derived by parsing the locale string** — each variant **declares its parent explicitly** in config (`de-formal → de`, `de-CH-formal → de-CH`) so nesting stays deterministic when region and register combine. Resolution happens at build/runtime. Status cascade walks the chain: a base change flows into inheriting variants for free; only variants that **override** a key whose source changed go to `needs_update`. The editor distinguishes "inherited" from "overridden here."
- **Rename** must be an explicit event (or content-hash heuristic) written to the sidecar, because git won't detect an in-file key rename and the hash matches the old value (§F6).
- **Git history *is* the audit** [RESOLVED, was OPEN-D]. Lite mode makes no hash-chain or compliance claim; git log/blame/MR-approval records (optionally signed commits for tamper-evidence) are the content audit. The server minimally logs only what git can't represent — assignments and review send-backs. Essentials only.

**Honest trade-offs to tell consumers:**
- **Concurrency is the weak spot — mitigated by branch axis + conflict UX** [RECOMMENDED, was OPEN-B]. Branch **per work-unit (locale+namespace), not per user/session** — per-user branches only *defer* conflicts to merge time and dump them on devs, and two translators on the same file still collide regardless of whose branch it is. Work-unit branches mean different units never touch the same file, so cross-translator conflicts become structurally rare; **string-level locking** (F6) handles multiple translators within one unit. For the residual (base drifts mid-edit), surface conflicts in the frontend but **never as raw git text / `<<<<<<<` markers** — resolve at translation-unit granularity (per-key base / yours / theirs-now, using the format parser that builds the index). Git does the file merge; where it can't, the hunk explodes into per-string choices. *Escape hatch if conflict volume ever hurts:* a **merge-train / auto-rebase** (accumulate on the server copy, auto-rebase onto base on approval) minimizes drift and produces the fewest conflicts — but moves merge authority to the bot, so it's not the default while devs own MRs. A real DB is still simply better here; lite mode trades it away.
- **Throughput is provider-rate-limited** — batch and back off; never one push per keystroke.
- **Big binaries** (screenshots/context) go to the object-storage adapter referenced by key, not the repo (or Git LFS if insisted).
- **TM/glossary without a DB**: index the repo's existing translations into the local SQLite TM at clone time (read-only, rebuilt on sync); glossary as `.tms/glossary.csv`. Consistent with "git is truth."
- **Delivery** needs no TMS runtime server — merging to base triggers the repo's existing pipeline.

Git mode also self-answers several decisions for its deployments: conflict resolution = git/branch (D7), delivery = repo pipeline (D11), approved/published = MR-approved/merged (D14), real-time footprint shrinks (D8), content authority = git (D2/D3).

---

## 12. Additional Recommended Requirements (now folded into pillars)

All integrated during review — listed here as a cross-pillar checklist: TM & glossary (quality + better LLM output); DNT as glossary flag (§4/F11); CI + PR-based string review (F6); QA/validation gates before publish (F11); import/export & migration tooling, no lock-in (F1); API tokens/service accounts (F3); backup/restore/migration story (§7); secrets encryption (F4); MT/LLM rate limits & cost caps (F4); air-gapped mode (F4); due-date/SLA entity (§4/F7); context-staleness signal (§4); job runner (§6.3); search (F11/§7).

---

## 13. Decisions Register (D1–D15, resolved)

| # | Decision | One-line rationale |
|---|---|---|
| D1 | Single-tenant default, tenant column on every top-level entity from day one | Retrofitting a tenant column is a brutal migration; carrying it is nearly free. No tenant/billing UI at v1. |
| D2 | Two **deployment modes**: full (Postgres; per-namespace `code`/`platform` authority, default `code`) and **lite (git) — git mode is always lite mode**; modes are not mixed in one instance | Declared authority makes sync deterministic; coupling git⟺lite pushes capability/write-semantics differences to deployment-level instead of per-namespace. |
| D3 | DB content: **reference + translations as truth**, cache (don't own) the source value | Owning source makes TMS a second master and reintroduces bidirectional sync for data it doesn't control. |
| D4 | **Additive-only** permissions; suspend/lock flag for emergency revoke | Deny rules add evaluation-order and audit complexity; scoping already delivers "only `fr-*`." |
| D5 | LLM secrets **org default, project override**; envelope AES-256-GCM, KMS-pluggable, write-only | Project override isolates blast radius across provider accounts; never return/log secrets. |
| D6 | Figma **import-only** at v1 | Full bidirectional makes design/code/platform all claim source authority; conflict matrix explodes. |
| D7 | **Authority-based** conflict handling; optimistic concurrency + locking + 3-way merge for residuals | Explicit authority removes most conflicts; no silent last-write-wins. |
| D8 | **SSE + polling fallback**, no WebSocket at v1 | One-way server→client; rides plain HTTP, no sticky sessions; WebSocket waits for live co-editing. |
| D9 | Official in-process plugins at v1; community out-of-process (capability RPC broker; WASM for pure fns) in Phase 2 | In-process is fine for trusted first-party; defer the hard isolation work. |
| D10 | **Hash-chain audit always on**; signed checkpoints exportable; external notarization Phase 2 | Chaining can't be retrofitted credibly; heavy part stays optional. |
| D11 | **Client-pull default, CDN-push opt-in** | No extra infra for compose users; CDN scale without forcing CDN on anyone. |
| D12 | **REST-only** at v1 | GraphQL's per-field auth/N+1/complexity costs don't pay off until many varied external consumers exist. |
| D13 | **Postgres (prod) + SQLite (dev/tiny)**; MySQL possible, unsupported at v1 | Three DBs triple the edge-case burden (JSON, FTS, locking differ). |
| D14 | Keep **approved/published split**; per-project auto-publish-on-approve flag | Separation enables release gating & staged publish; flag gives simple users one-step behavior. |
| D15 | **Split license**: Apache-2.0 SDKs/CLI/plugin-API, AGPL-3.0 server + CLA; maintainer-led governance w/ RFC process; plugin license shown in manifest/registry | Permissive SDKs for adoption; AGPL server closes the SaaS strip-mine loophole; CLA preserves dual-license option. |

Plus **D-Branch**: versioning is **mode-dependent** — git *is* the VCS in git mode; DB mode uses lightweight named snapshots (no internal merge engine). Prevents two competing branching concepts.

**Decisions from review (D16–D26):**

| # | Decision | One-line rationale |
|---|---|---|
| D16 | Canonical placeholder model = **single curly `{name}`**; adapters normalize on import/export | One representation for hashing, QA, MT, DNT; placeholders are DNT by construction. |
| D17 | **ICU kept as standard structure**; each plural/select branch an editable slot; **CLDR** drives target forms; missing → `other` | Matches "edit ICU like variables"; correct per-locale plural sets without forcing every form. |
| D18 | **Metadata authority by field**: descriptive/technical follows content authority (max-length dev-owned); process metadata always platform-owned (= Comment/Thread) | No co-owned field ⇒ metadata conflicts impossible; reuses existing comment entity, ~zero new complexity. |
| D19 | **DNT** = placeholders-by-construction + a **"do not translate" flag on glossary terms** (global match, highlighted, QA-enforced); inline spans deferred | Covers literal brands/terms without new inline machinery; reuses glossary. |
| D20 | **Per-translation history** = user-visible **filtered slice of the audit log** (item ID + change type); git log in lite | Avoids a parallel history store; clean per-string timeline. |
| D21 | **Default translator auto-approve**; per-project toggle for mandatory separate reviewer; editing a reviewed string resets status | Small teams need no gate; larger ones opt into review. |
| D22 | **String-lock = DB status ("being translated") + save-time original-vs-current comparison**; frontend lock deferred | Cheap, avoids hard locks; status alone cuts most collisions. |
| D23 | **Import conflict** = show overlapping-key comparison, choose **overwrite** or **new-keys-only** | Explicit, non-destructive by default. |
| D24 | **Lite accounts** = invite link → password → reset; no OIDC/SAML in lite | Simplest workable scheme for small teams. |
| D25 | **Job execution** = `JobRunner` interface; lite `InlineRunner` (synchronous, in-process, no queue/Redis); full `QueuedRunner` (Postgres queue default, optional Redis + worker pool) | Keeps lite maintenance minimal (user waits); full scales properly. |
| D26 | **Search** = Postgres FTS + `pg_trgm` (full) / SQLite FTS5 (lite); optional external-engine plugin; CLDR via pinned maintained library | No required new infra; deliberate CLDR version migration. |

## 14. Residual Open Items — status

- **[RESOLVED] OPEN-A — Register/regional variants.** Delta-only variant files with explicit-parent fallback chains; base changes flow to inheritors for free, only overrides on changed source go `needs_update` (§11, §4).
- **[CONFIRMED] OPEN-B — Concurrency & conflicts.** Branch per work-unit (locale+namespace) + string locking + per-string semantic conflict UI (never raw git diffs); devs own merges; merge-train reserved as an escape hatch (§11). Write-ack levels (`accepted`/`committed`/`pushed`) exposed so the editor never claims durability it doesn't have.
- **[RESOLVED] OPEN-C — Lite scope.** Lite = hosted thin git-layer; single project/repo, SQLite single-process, fixed roles + locale scoping, no plugins/webhooks/multi-project/CDN, translators need no git account. Positioned on the file-only ↔ lite ↔ full-DB spectrum with a non-catastrophic upgrade path (§11 Scope).
- **[RESOLVED] OPEN-D — Audit.** Git history *is* the audit; no hash-chain/compliance claim in lite mode; server logs only assignments and review send-backs (§11).

All four residual items are now closed. **The open work is now §15 below** — gaps surfaced during review that affect the schema spine or would bite during generation.

## 15. Gaps From Review — all resolved (where each lives)

The gaps surfaced during review are now closed and folded into the relevant sections. Pointers:

1. **Placeholder/variable model** → `{name}` canonical model (§4, F1) [D16].
2. **Background-job / async runtime** → §6.3 `JobRunner` (§8, §11) [D25].
3. **ICU with differing target plural categories** → §5 plural/ICU representation, F11 editing, CLDR (§7) [D17, D26].
4. **Per-translation history** → filtered audit slice (F9) [D20].
5. **Metadata authority** → field-ownership (§4) [D18].
6. **Separation of duties** → approval workflow (§5, F3) [D21].
7. **String-lock semantics** → DB status + save-time comparison (F6) [D22].
8. **Import conflict** → overwrite vs new-keys-only (F1) [D23].
9. **Lite accounts/onboarding** → invite → password → reset (§11) [D24].
10. **DNT representation** → glossary DNT flag + placeholders-by-construction (§4, F11) [D19].
11. **Webhook event catalog** → enumerated (F7).
12. **CLDR dependency** → maintained library, pinned version (§4, §7) [D26].
13. **Search at scale** → Postgres FTS + `pg_trgm` / SQLite FTS5 / optional engine (F11, §7) [D26].
14. **SMTP/email** → optional env-configured channel (F7, §8).

---

### How to consume this document
- Each `F#` is a Feature/epic; bullets seed Stories; QA/edge-case items seed tickets.
- §6 (store interface + modes + job runner) and §5 (status machine) are the schema spine — generate them first; nearly everything depends on them.
- **Everything is settled**: §13 (D1–D26 + D-Branch) is the decision input; §14's four OPEN items and §15's fourteen gaps are all closed. The spec is generation-ready. The natural first decomposition target is **F6** (fully specified, most cross-cutting) or **F11** if you'd rather pressure-test the placeholder/ICU model against a concrete UI.
