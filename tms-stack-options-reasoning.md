# Reasoning Behind `tms-stack-options.md`

Companion doc explaining the choices in the options list — what got filtered before it reached the shortlist, why the ten constraints are load-bearing, how each star was assigned, and why the recommendation lands where it does.

---

## 1. Why the shortlist is five stacks, not ten

The options doc is a **backend-language + editor-framework + surrounding-tooling** decision. I filtered by asking each candidate: *does this stack have a distinct, defensible strength on at least one of the ten constraints, and no immediate disqualifier?* That gave five: TypeScript-everywhere, Go, Rust, Elixir, Python.

Filtered out at that stage, with reasons:

- **Java / Kotlin (Spring, Ktor, Micronaut).** Objectively strong on ICU (ICU4J is *the* reference), best-in-class typed workers (jobrunr, Quartz), Postgres/SQLite fine. Cut because: (a) contributor pool for a self-hosted OSS TMS skews away from JVM; (b) JVM memory footprint hurts the "lite mode on a $5 VPS" pitch; (c) single-binary CLI is possible with GraalVM native-image but adds a whole build dimension. Would beat Python; would not clearly beat A/B/C/D on any axis that matters more than the contributor cost.
- **C#/.NET (ASP.NET Core, EF Core).** Similar analysis — excellent tech, ICU4N exists, but contributor pool for an AGPL OSS TMS is thin and the "MS ecosystem" tag pushes away parts of the OSS crowd fairly or not.
- **Ruby (Rails, Hanami).** ICU story via `twitter-cldr-rb` / `ruby-cldr` is weaker than JS/Java/Elixir; workers (Sidekiq) require Redis by default which fights §6.3's lite-mode "no Redis" rule; deploy story less clean than Go/Rust. Nothing to recommend it *over* the five.
- **PHP (Symfony, Laravel).** ICU via `MessageFormatter` (intl extension, libicu-backed) is actually solid, and Symfony is fine. Filtered on contributor-pool overlap with the target audience (frontend-focused devs already using i18next/FormatJS) — Node wins that overlap decisively.
- **Deno / Bun as separate options.** Both are Node-compatible runtimes; treated as *deployment choices within Option A*, not separate stacks. Bun's single-file `bun build --compile` output actually helps A's weak spot (single-binary CLI), which is called out inside Option A.

## 2. Why Astro / Next / Remix / SvelteKit / SolidStart aren't listed

This was the specific question. Short version: **meta-frameworks solve a problem the TMS editor doesn't have.**

The TMS editor (F11) is a **highly interactive SPA-shaped application**: keyboard-first key list, ICU plural/select slot editing, live status transitions over SSE, comment threads, bulk actions, staleness flags. It looks like Linear, Figma, or an IDE — not like a blog or marketing site.

Meta-framework value propositions and how they land here:

- **Astro (islands architecture, zero-JS by default).** Astro's whole thesis is *most of the page is static content; hydrate small interactive islands*. The TMS editor is the inverse — nearly the entire screen is interactive state. Astro would give us a nice server-rendered shell and then we'd hydrate a giant React island covering 95% of the page, which is just React-with-extra-steps. Astro remains a **great choice for the marketing site, the docs site, or a public-facing status page** — those are separate deliverables from the product stack.
- **Next.js / Remix.** SSR + file-based routing + server actions. The TMS editor doesn't benefit meaningfully from SSR (it's authenticated, behind a login, no SEO concern) and D8 rules out WebSocket/RSC-streaming complexity. We'd take on Next's opinionation and version churn without cashing in its SSR/RSC value. Also: Next is React-only; a chunk of our SDK audience is Vue/Svelte/Angular users who'd resent a Next-shaped product editor if we ever open the editor for extension.
- **SvelteKit / SolidStart / Nuxt / Qwik.** Same shape as Next — SSR meta-frameworks tied to one component framework. Same reason for skipping: no SSR benefit, adds framework opinion the editor doesn't need.
- **Remix Islands / Astro server actions.** Neither changes the analysis; the editor's data flow (mutations against REST, live updates over SSE, optimistic UI) is already well-served by React + TanStack Query.

Where a meta-framework *would* make sense in this project:

- **Docs site** (`docs.tms.dev` or the in-repo mkdocs equivalent) — Astro/Starlight is genuinely a strong choice here.
- **Public marketing site** — Astro again.
- **Runtime-served locale bundle preview pages** (F10) — if we ever build a hosted "preview your bundle" tool, Astro fits.

These are separate stack decisions from the product editor and were not in scope for this doc. If you want, we can add a "peripheral sites" section covering docs + marketing separately.

**Explicit stack pick for the editor:** React (or Vue/Svelte) + Vite + TanStack Query, no meta-framework. Vite gives us HMR, ESM, and code-splitting; TanStack Query gives us the server-state cache the editor needs; SSE + polling per D8. That's the entire meta-framework value for this app shape.

## 3. Why these ten constraints are treated as load-bearing

Every ranking key in the scoring matrix comes from a specific spec citation, not general "good tech stack" heuristics. Rationale per constraint:

1. **ICU MessageFormat maturity.** §5 makes each plural/select branch an "editable slot" and requires CLDR-driven target plural sets. §7 pins CLDR as the locale-data dependency. F11 requires inline ICU editing. If the stack lacks a real ICU-MF library, we either port one (real work) or wrap ICU4C (kills single-binary). This is the single most stack-differentiating requirement in the spec.
2. **Postgres SKIP LOCKED queue lib.** §6.3 names `SELECT … FOR UPDATE SKIP LOCKED` as the default `QueuedRunner` backend. "Adequate queue" isn't enough — we need scheduled/delayed execution (SLA reminders, webhook backoff), idempotency keys, and dead-letter. Maturity here is the difference between shipping F7 webhooks in a week vs a month.
3. **Store-interface ergonomics.** §6.2 requires one interface with two drivers exposing write-ack levels (`accepted`/`committed`/`pushed`) and capability flags. Languages with clean interface/trait/protocol systems and non-terrible ORMs/query builders win here.
4. **Single-binary CLI.** F1 makes `tms` the primary dev-sync surface. §1 pitches "solo dev deployable." A `curl | sh` or `brew install tms` that lands a single binary is a material adoption win over `npm i -g` (Node version mismatches) or `pip install` (venv confusion).
5. **Lite-mode memory footprint.** §11 targets small teams on cheap hosts. Idle memory of the lite process is a real constraint if we're serious about "runs on a $5 VPS."
6. **WASM host (Phase 2).** D9 makes community plugins WASM-preferred for pure functions. The WASM-host library quality determines whether Phase 2 is a quarter of work or a year of work.
7. **Contributor pool.** D15 chose AGPL server with community governance. An OSS TMS lives or dies on external contributors, especially for format adapters (F1) and MT/LLM providers (F4) — long-tail integrations we can't all write ourselves.
8. **SDK codegen / shared types.** F1 requires typed SDKs for React/Vue/Svelte/Angular/vanilla JS + core. Stacks where the server language *is* TypeScript get shared DTOs for free; others need OpenAPI codegen and a discipline of never letting the OpenAPI drift.
9. **MVP velocity.** §10 phases MVP explicitly. This is a *pragmatic* weight, not a technical one — the correct stack is the one that ships MVP fastest without painting us into a corner on Phase 2.
10. **Git operations.** §11 requires partial + sparse clone, worktrees, per-work-unit branches, and provider-webhook diff processing. Libraries range from "libgit2 bindings, works" to "pure-language impl, missing partial clone" to "shell out to `git` and parse output."

Constraints deliberately *not* in the matrix:

- **Raw request/s throughput.** A TMS is not a CDN — every stack in the list handles our load ceiling. Ranking on RPS would over-reward Rust/Go for no shipped benefit.
- **Type system power.** All five have adequate types; further gradations are aesthetic.
- **"Modernness"** or trend momentum. Non-load-bearing; already implicitly reflected in contributor pool.
- **Real-time transport.** D8 chose SSE, which is trivial everywhere. Non-differentiating.

## 4. Why each star landed where it did (per constraint)

Stars are 1–5, calibrated relative to the best option for that row (not absolute). Notable assignments:

**ICU MessageFormat maturity**
- TS = 5: `@formatjs/intl-messageformat` is the reference, `Intl.MessageFormat` v2 development happens in TC39 with FormatJS contributors.
- Go = 2: `x/text` covers plural rules but no maintained ICU-MF library on Format.js's tier. This is the biggest single-tech risk of Option B.
- Rust = 4: `icu4x` (Unicode Consortium) is Rust-native and covers MF2 well; docked one because MF1 tooling ecosystem is thinner than JS's.
- Elixir = 4: `ex_cldr` + `ex_cldr_messages` is genuinely strong, on par with Rust's icu4x.
- Python = 4: PyICU wraps ICU4C directly — most "authentic" ICU, but MF2 support lags and libicu system-dep hurts packaging.

**Postgres SKIP LOCKED queue lib**
- Elixir = 5: Oban is best-in-class of any language on any runtime — no serious competitor.
- TS = 4: graphile-worker + pg-boss are both production-grade, mature, well-documented.
- Go = 4: river is excellent and modern; gocraft/work is older but proven.
- Python = 4: Procrastinate is solid; Dramatiq with pg backend works.
- Rust = 3: apalis exists but the Rust queue library market is less mature than the others.

**Contributor pool**
- TS = 5, Python = 5: broadest available JS/Python developer pools.
- Go = 4: strong for OSS infra, slightly narrower than JS/Python.
- Rust = 3: growing but higher bar for casual PRs — matters more for long-tail adapter/plugin contributions.
- Elixir = 2: smallest of the five; excellent devs but numerically fewer.

**Single-binary CLI**
- Go = 5, Rust = 5: static binaries are native.
- TS = 2: Bun/pkg can produce binaries but they're large and have native-module edge cases (better-sqlite3 in particular).
- Elixir = 2: Burrito/Bakeware exist but not idiomatic; realistic distribution is Docker.
- Python = 1: PyInstaller/Nuitka work but consistently painful.

**Store-interface ergonomics** favored Elixir slightly (Ecto's changeset/schema/query separation maps unusually well onto the driver pattern) but the difference across the top four is minor.

**MVP velocity** rewards Option A heavily because a shared language for server + editor + CLI + SDKs cuts context-switching and eliminates codegen-drift as a class of bug. Rust gets a 2 mostly because of compile times on a multi-crate workspace and the sqlx/Tokio friction curve on a team not already Rust-fluent.

## 5. Why the recommendation is A, with B as the credible alternative

The tie-breaker between A and B is the ICU/CLDR gap. Everything else about Option B is genuinely better than A — deploy story, memory footprint, WASM host, static binaries. But ICU MessageFormat is not a peripheral concern in this spec; it's cited in §4, §5, §7, F10, and F11, and D17 explicitly makes ICU the standard structure with per-branch editing driven by CLDR. Shipping a TMS with a homegrown ICU-MF parser (or a Go server that embeds a JS runtime just for this) is the kind of foundational risk that eats an MVP.

A wins because the ICU risk is closed for free and the deploy-story gap is closable — Bun's `--compile` mode, distroless Node images (~50MB), and pnpm workspaces address most of B's structural advantages. B's advantages that stay real are (a) memory footprint (~5x smaller) and (b) wazero as a Phase 2 WASM host — both are Phase 2 concerns, not MVP.

C loses the tie on contributor pool + velocity despite winning on technical elegance. D loses on contributor pool + CLI story despite winning on the queue and matching JS on ICU. E has no axis on which it's the best choice.

**Explicit recommendation with reservation:** pick A now, and if a Go/Rust ICU-MF implementation reaches parity with Format.js in the next 12 months, revisit B for a v2 rewrite of hot paths (worker pool, git driver). The store-interface abstraction (§6) makes such a rewrite tractable — that's part of why the spec's abstraction is worth honoring.

## 6. Things I'm least confident about

Called out honestly so you can push back where it matters:

- **Whether Format.js's ICU-MF v2 lead over icu4x is a durable advantage.** icu4x is well-funded (Unicode Consortium + Google) and moving fast; a snapshot 12 months from now might close this gap.
- **Whether "single-binary CLI" is actually adoption-load-bearing** or whether an `npx tms` command papers over it well enough. If we accept `npx`, Option A's weakest score improves materially.
- **Whether contributor-pool weight is right for an AGPL server.** AGPL narrows the corporate contributor pool anyway; if we assume most contributors are individuals doing evening PRs, JS/Python's pool advantage may be smaller than assumed and Elixir/Rust closer than scored.
- **Whether we've under-weighted Elixir.** Oban + ex_cldr + BEAM supervision is a genuinely good match for §6.3 + §7 + fault tolerance. The main reason Elixir isn't the pick is contributor pool, and if that assumption is soft, D moves up.
- **Whether the editor stays SPA-shaped forever.** If the eventual product grows a large public docs/preview surface, a meta-framework becomes relevant *for that surface*. The current recommendation doesn't preclude adding Astro for docs later — that's an additive decision, not a re-do.
