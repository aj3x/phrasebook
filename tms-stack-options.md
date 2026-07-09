# TMS Tech-Stack Options

Decision needed: overall implementation stack (backend language + framework, editor framework, and how the CLI/SDKs/plugins sit together). The spec (`tms-foundations.md`) is design-decided but stack-agnostic. This doc scores five realistic stacks against the constraints the spec *actually* imposes, then recommends.

## Constraints the stack must satisfy

Pulled from the spec — these are the non-negotiables that eliminate options fast:

1. **Store interface, two drivers (§6):** Postgres + git behind one interface. Needs clean interface abstraction and both a durable-sync driver and a git-backed driver with local SQLite index.
2. **JobRunner, two impls (§6.3):** `InlineRunner` (single process, no queue, lite) + `QueuedRunner` (Postgres-backed queue via `SELECT … FOR UPDATE SKIP LOCKED`, optional Redis adapter, separate worker pool).
3. **ICU MessageFormat + CLDR (§4, §5, §7, F11):** load-bearing. Plural/select branch editing, per-locale plural sets from CLDR, pinned CLDR version. The stack must have a mature ICU-MF library — not something we hand-roll.
4. **SDKs for React, Vue, Svelte, Angular, vanilla JS + framework-agnostic core (F1).** So a JS/TS runtime is unavoidable on the client SDK axis regardless of server choice.
5. **CLI (`tms init/push/pull/rename/…`) shipped as an easy install (F1, §11).** Solo devs should get one binary or one `npm i -g`.
6. **`docker compose up` for lite; scales to a team (§1, §8).** Lite = single process, SQLite index, no Redis. Full = web + worker pool + Postgres.
7. **Git operations for lite (§11):** `git clone --filter=blob:none --sparse`, `sparse-checkout`, `worktree`, per-work-unit branches, provider adapters. Partial-clone support in whatever library is used.
8. **WASM host for Phase 2 community plugins (D9, F8):** pure-function plugins (format converters, QA checks) via WASM; subprocess+capability-RPC for IO plugins. WASM host quality matters at Phase 2.
9. **REST-only, OpenAPI-generated (D12):** codegen story for typed SDKs.
10. **SSE + polling, no WebSocket at v1 (D8).** Trivial in any modern stack — non-differentiator.
11. **Postgres FTS + `pg_trgm` / SQLite FTS5 (F11, §7).** Raw SQL is fine; both are available anywhere with decent Postgres/SQLite bindings.
12. **Self-hostable OSS, AGPL server (D15).** Contributor-pool size matters for external PRs.

---

## Options

### A. TypeScript end-to-end (Node + React)

Server: **Fastify** (or NestJS if we want opinionated modules); **Kysely** or **Drizzle** for the store interface; **graphile-worker** or **pg-boss** for `QueuedRunner` (both use `SKIP LOCKED` on Postgres); **better-sqlite3** for the lite index; **simple-git** or shelling to `git` for git ops; **@formatjs/intl-messageformat** for ICU (reference implementation); **wasmtime-node** or **@bytecodealliance/jco** for Phase 2 WASM. Editor: React + Vite + TanStack Query. CLI: same Node runtime, packaged with `pkg`/`bun build --compile` for single-binary distribution. Monorepo: pnpm workspaces.

**Pros**
- **One language for server, editor, CLI, SDKs, plugin API.** Contributor onboarding is one toolchain. Shared types between server and editor via a `core` package.
- **Best ICU/CLDR ecosystem in any language.** Format.js is *the* reference for ICU MessageFormat; TC39 `Intl.MessageFormat` v2 work happens here first.
- SDK codegen is native: the framework-agnostic core is TS; React/Vue/Svelte/Angular wrappers are thin.
- graphile-worker + pg-boss are production-grade Postgres queues with SKIP LOCKED, scheduled jobs, backoff — exactly the §6.3 shape.
- Fastest MVP velocity, largest OSS contributor pool of the five.

**Cons**
- Lite-mode single-process memory footprint is higher than Go/Rust (typically 80–150MB idle vs 15–40MB). Matters for the "runs on a $5 VPS" pitch.
- Node dep churn / supply-chain risk is real for an AGPL server intended to live a decade.
- Single-binary CLI is worse than Go/Rust: `bun build --compile` or `pkg` works but produces 50–90MB binaries and has edge cases with native modules (`better-sqlite3`, `nodegit`).
- WASM host is decent but not the strongest — Wasmtime bindings for Node are less polished than Go/Rust hosts (matters at Phase 2, not v1).

---

### B. Go backend + React frontend

Server: **chi** or **Echo**; **sqlc** for typed queries against the store interface; **river** (Postgres-backed queue, SKIP LOCKED, native Go) for `QueuedRunner`; **modernc.org/sqlite** (pure Go, no cgo) for the lite index; **go-git** *or* shell out to `git` for git ops; **wazero** (pure-Go WASM runtime, embeddable, zero deps) for Phase 2 plugins. Editor: React + Vite. CLI: Go single static binary. Monorepo: Go workspace + pnpm workspace for JS side.

**Pros**
- **Best single-binary deploy story.** One static binary for server + CLI + worker. Docker image can be 15–25MB (scratch/distroless). Genuinely runs anywhere.
- **wazero is arguably the best embedded WASM host of any language** — zero-dep, pure-Go, sandboxed by default. Phase 2 plugin system almost falls out.
- Excellent concurrency primitives for the QueuedRunner worker pool.
- Postgres/SQLite bindings are mature; river is a strong queue.
- go-git supports partial clone and sparse checkout (via `PackfileURIs` / recent versions), though shelling to `git` inside the container is often simpler.

**Cons**
- **ICU MessageFormat ecosystem is Go's weak point and this is load-bearing.** `golang.org/x/text` handles CLDR plural rules and formatting, but there's no mature ICU MessageFormat parser/evaluator on the Format.js tier. Options: (a) ship an embedded JS runtime (goja/otto) to run `@formatjs/intl-messageformat` server-side — awkward; (b) port it — real work; (c) wrap ICU4C via cgo — kills the single-binary win. This is the single biggest concrete risk.
- Two-language project (Go server, TS SDKs/editor) means every DTO gets defined twice or generated. OpenAPI codegen helps but isn't free.
- Migrations story (`goose`, `atlas`) is fine but less ergonomic than Prisma/Drizzle/Ecto.

---

### C. Rust backend + React frontend

Server: **Axum** + **sqlx**; **apalis** or a hand-rolled Postgres SKIP LOCKED queue for `QueuedRunner`; **rusqlite** for the lite index; **git2** (libgit2 bindings) for git ops; **wasmtime** for WASM plugins; **icu4x** (Unicode-maintained, Rust-native) for ICU/CLDR. Editor: React + Vite. CLI: Rust static binary.

**Pros**
- **icu4x is the strongest Rust ICU story of any non-JS language** — Unicode Consortium maintains it. MessageFormat 2 is a first-class citizen. This closes Go's biggest gap.
- Wasmtime is the reference WASM host — Phase 2 plugin isolation is best-in-class.
- Single static binary, tiny images, tightest memory footprint.
- libgit2 bindings are mature; partial clone / sparse checkout supported.

**Cons**
- **Slowest to build and hardest to attract external contributors** — for an OSS TMS this is a real cost. AGPL server needs a community; Rust's contributor pool is smaller than JS or Go and the learning curve gates casual PRs.
- Compile times hurt iteration on a project with many crates (server + CLI + workers + adapters).
- Async story (Tokio, Send/Sync bounds, `sqlx` compile-time query checks) is powerful but adds friction for a domain-heavy app (translation editor logic isn't performance-critical).
- Two-language project like Go, without Go's contributor-pool compensation.
- Postgres-backed queue libraries are less mature than graphile-worker or river.

---

### D. Elixir/Phoenix + React

Server: **Phoenix**; **Ecto** for the store interface; **Oban** (Postgres-backed queue, arguably the best-in-class queue of any language) for `QueuedRunner`; **Exqlite** for the lite index; shell to `git` for git ops; **wasmex** (Wasmtime NIFs) for WASM plugins; **`ex_cldr`** (Kip Cole) for CLDR — genuinely top-tier, on par with Format.js for CLDR coverage. Editor: React (LiveView is possible but real-time requirements are SSE-only per D8, so LiveView's edge is muted).

**Pros**
- **Oban is best-in-class** — the JobRunner spec in §6.3 reads like it was written for Oban (idempotency, exponential backoff, dead-letter, cron/scheduled, unique jobs). Postgres-backed, no Redis needed.
- ex_cldr rivals Format.js for correctness; ICU MessageFormat support via `ex_cldr_messages` exists.
- BEAM supervision maps cleanly onto InlineRunner/QueuedRunner + git-worker + webhook fan-out. Fault tolerance is free.
- Ecto migrations are excellent.

**Cons**
- **Smallest OSS contributor pool of the five** — biggest hiring/PR risk for an OSS project betting on community.
- Two-language project (Elixir server + TS editor/SDKs).
- WASM host (wasmex) is usable but less polished than wasmtime-rust/wazero.
- Single-binary distribution is possible (Burrito, Bakeware) but not the norm and has rough edges. Docker is the realistic distribution channel — fine, but no CLI single-binary win.
- CLI in Elixir is awkward; `tms` would likely be a separate binary (Go/Rust) or a Node CLI, splitting the toolchain further.

---

### E. Python (FastAPI) + React

Server: **FastAPI** + **SQLModel/SQLAlchemy**; **Procrastinate** (Postgres SKIP LOCKED queue) or **Dramatiq** for `QueuedRunner`; stdlib `sqlite3` for the lite index; **PyICU** (libicu bindings) for ICU/CLDR; **wasmtime-py** for WASM. Editor: React.

**Pros**
- PyICU is real ICU (bindings to ICU4C) — MF v1 solid.
- FastAPI + Pydantic gives OpenAPI-first spec generation basically for free.
- Broad contributor pool.

**Cons**
- **Doesn't dominate any axis** vs the alternatives. Slower runtime than Go/Rust, worse ICU ecosystem than JS/Elixir/Rust, worse deploy story than Go/Rust (Python packaging is still painful), worse worker perf than Elixir/Go.
- PyICU requires ICU4C system libs — kills clean single-binary and complicates the compose image slightly.
- CLI story is worse than Node/Go/Rust (pip install vs one binary).
- No compelling reason over Option A given TypeScript's ICU lead and shared-language advantage.

**Not recommended.** Listed for completeness.

---

## Scoring at a glance

| Constraint | A (TS) | B (Go) | C (Rust) | D (Elixir) | E (Python) |
|---|---|---|---|---|---|
| ICU MessageFormat maturity | ★★★★★ | ★★ | ★★★★ | ★★★★ | ★★★★ |
| Postgres SKIP LOCKED queue lib | ★★★★ | ★★★★ | ★★★ | ★★★★★ | ★★★★ |
| Store-interface ergonomics | ★★★★ | ★★★★ | ★★★★ | ★★★★★ | ★★★ |
| Single-binary CLI | ★★ | ★★★★★ | ★★★★★ | ★★ | ★ |
| Lite-mode memory footprint | ★★ | ★★★★★ | ★★★★★ | ★★★ | ★★★ |
| WASM host (Phase 2) | ★★★ | ★★★★★ | ★★★★★ | ★★★ | ★★★ |
| Contributor pool (OSS) | ★★★★★ | ★★★★ | ★★★ | ★★ | ★★★★★ |
| SDK codegen / shared types | ★★★★★ | ★★★ | ★★★ | ★★★ | ★★★ |
| MVP velocity | ★★★★★ | ★★★★ | ★★ | ★★★ | ★★★★ |
| Git operations | ★★★ | ★★★★ | ★★★★★ | ★★★ | ★★★ |

---

## Recommendation

**Option A (TypeScript end-to-end)** is the pragmatic default, primarily because ICU MessageFormat is load-bearing in §4/§5/§7 and Format.js is the reference implementation — every other stack pays a real tax there. Shared-language advantage across server/editor/CLI/SDKs shortens the MVP and lowers the contributor bar for an OSS project.

**Option B (Go)** is the strongest alternative if you value the single-binary deploy story and Phase 2 WASM plugin isolation more than ICU convenience, and are willing to invest in a Go MessageFormat implementation (or ship a small JS runtime for that one subsystem).

**Option C (Rust)** wins on raw technical merit — icu4x + wasmtime + tiny binaries — but the contributor-pool and iteration-speed penalties are steep for a domain-heavy OSS product. Consider only if the team is Rust-native.

Main tradeoff to sanity-check: how much do you weight (a) MVP velocity + ICU correctness (favors A) vs (b) deployment/plugin-isolation elegance (favors B/C)?
