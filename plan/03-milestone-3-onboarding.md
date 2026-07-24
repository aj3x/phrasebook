# Milestone 3 — Permissions, Owner Role & First-Run Onboarding

## Why this milestone, and why now

The outline in [`03-later-milestones.md`](03-later-milestones.md) slotted **CLI + JSON adapter + extraction** as M3. This milestone **takes that slot**; the CLI moves back one place (confirmed — see Roadmap bookkeeping). Two things drove the swap.

**1. There is no way into a fresh instance.** Everything the app needs — an organization, a workspace, a project, locales, and a privileged user — exists only because `apps/server/src/seed.ts` inserts it. There is a sign-**in** screen but no sign-**up**, and no UI to create an org or a project. Someone self-hosting this, booted against an empty database, lands on a login screen for an account that does not exist. M3's headline outcome: **a person who has just hosted the app enters their email and sets a password, names their org, creates their first project, and is in — with no seed script and no shell access.**

**2. M2's RBAC can't express what we now need.** Roles are currently just *names*, checked by string comparison (`requireRole(db, ['Admin','Developer'])`). There is no permissions table, no Owner, and no way to say "this role may create projects" without editing server code and redeploying. M3 replaces role-name checks with a real **permission** model.

M2 built the machinery (better-auth sign-up, RBAC scaffolding, project/locale schema, editor shell). M3 is partly wiring a first-run experience over it — and partly a genuine rework of the authorization core underneath it.

## Decisions taken (from review)

| # | Decision |
|---|---|
| 1 | **Owner is a real, distinct role** — not "the first Admin." Owner can view and do everything. What is Owner-*only* is the **container structure**: creating workspaces (and org-level actions). |
| 1b | **Admins are full operators inside a workspace** — they create projects, and assign roles, within their workspace scope. |
| 2 | **A `permissions` table**, with `"<resource>:<action>"` naming — `project:view`, `project:*`. |
| 3 | **Invites: copy-link only** for now. The *ability to invite* becomes a permission, so it can be granted to other roles/users later without code changes. |
| 4 | **Bootstrap atomicity as recommended**: owner + org + default workspace atomic; project and survey are optional follow-ons. |
| 5 | **Workspace stays implicit** in M3 (one created automatically); workspace management is its own later milestone. |
| 6 | **CLI + adapters bumped** to a later milestone. |
| 7 | **Breaking changes are acceptable** — alpha; "drop and recreate your database" is a valid upgrade path. |

## The permission model

This is the part most likely to be wrong if built casually, so it's specified before the step list.

### Grammar

A permission is `"<resource>:<action>"`. `*` is a wildcard valid in **either** position:

| Pattern | Means |
|---|---|
| `project:view` | exactly that |
| `project:*` | every action on projects |
| `*:view` | view everything (a read-only auditor) |
| `*:*` | everything — the Owner grant |

**Matching rule.** A held pattern satisfies a required permission iff
`(held.resource === required.resource || held.resource === '*')` **and**
`(held.action === required.action || held.action === '*')`.

The required side is **always concrete** — code asks for `translation:save`, never for a wildcard. That keeps the matcher total and order-independent.

**Why this stays simple: there are no deny rules.** §D4 makes the model purely additive, so wildcards need no precedence or specificity rules — a user is allowed something if *any* held pattern matches. Introducing a single deny rule later would break that property and force a real precedence design; worth not doing accidentally.

### Schema

Two tables, with deliberately different jobs:

- **`permissions`** — the catalog of *concrete* permissions the application actually checks (`resource`, `action`, `description`). This is documentation, write-time validation, and the data behind a future permissions-picker UI.
- **`role_permissions`** — the *grants*: `(role_id, resource, action)` where either column may be `'*'`. Unique on the triple.

**Why grants aren't a foreign key into the catalog:** `project:*` is a *pattern*, not a permission — putting it in the catalog would mean the catalog no longer lists "things you can do." So grants store resource/action as text, validated at write time against the catalog's grammar (resource must either exist in the catalog or be `*`). Storing the two segments as separate columns rather than one `"project:view"` string keeps the wildcard match a plain SQL/JS comparison instead of string-splitting on every check.

### Design rule: split resources, don't withhold actions

Because the model is additive with **no deny rules**, the only way to withhold something is to *not grant it*. That creates a trap: any role needing most-but-not-all of a resource can't use that resource's wildcard, and instead carries a hand-maintained list of concrete actions that silently goes stale every time a new action is added.

**The rule we follow instead: when a role needs most-but-not-all of a resource, split the resource.**

Applied here — *assigning* a role and *defining* a role are genuinely different capabilities, so they are two resources, not one:

| Resource | Actions | Who |
|---|---|---|
| `role_assignment` | `view`, `create`, `revoke` | Admin (workspace-scoped) — grants roles to people |
| `role` | `view`, `create`, `update`, `delete` | Owner — defines what roles *are* (custom roles, later) |

This is what makes "Admins assign roles within a workspace" expressible as a clean `role_assignment:*` rather than a `role:*`-minus-`create` carve-out, and it leaves room for custom roles without denying anything.

**Where one carve-out genuinely remains:** `workspace`. Owner holds `workspace:*`; an Admin plausibly wants `workspace:view` (and maybe `update`, to rename their own workspace) without `create`/`delete`. Two things make this acceptable for now: workspaces aren't user-facing until M7, so nothing exercises it; and if it becomes annoying, the same splitting rule applies (`workspace` = container lifecycle, `workspace_settings` = view/rename). **Deliberately not designing that split now** — that's M7's call, when workspaces become real, per the project's own "no premature abstraction" principle. The important thing is that the carve-out sits on the least-trafficked resource in the system instead of on `project`.

### Starter role → permission matrix

Resources in M3's surface: `org`, `workspace`, `project`, `namespace`, `key`, `locale`, `translation`, `comment`, `user`, `role`, `role_assignment`, `invite`, `settings`.

Admin and below are **workspace-scoped** via `role_assignments` (see the scope note below); Owner is instance-wide.

| Role | Grants |
|---|---|
| **Owner** | `*:*` — the only holder of `workspace:create`/`delete`, `org:*`, and `role:*` |
| **Admin** | `project:*`, `namespace:*`, `key:*`, `locale:*`, `translation:*`, `comment:*`, `settings:*`, `user:*`, `invite:*`, `role_assignment:*`, `workspace:view` |
| **Developer** | `project:view`, `namespace:*`, `key:*`, `locale:view`, `translation:view/save`, `comment:view/create` |
| **Translator** | `project:view`, `key:view`, `locale:view`, `translation:view/save`, `comment:view/create` |
| **Reviewer** | Translator's, plus `translation:claim/approve/send_back` |
| **Viewer** | `project:view`, `key:view`, `locale:view`, `translation:view`, `comment:view` |

Notes on the shape:

- **Admin is now clean wildcards**, not a maintained subtraction list. New actions on those resources are automatically covered, which is the whole point.
- **Viewer is concrete, not `*:view`** (confirmed). `*:view` would let a Viewer read users, invites, role assignments, and org settings. Least privilege by default; the concrete list is short and intentional.
- **Review actions stay three permissions** (`claim`, `approve`, `send_back`) rather than one `translation:review` — they're already three endpoints, and approve-vs-send-back is exactly the split a customer eventually asks for. Reviewer holds all three, so there's no practical cost today.

### Noted, deliberately not decided: permissions at project *and* workspace level

Flagging this now because it will come up when the permission set is fleshed out, and because knowing it's coming changes what we should avoid painting ourselves into. **Not committing to an answer in M3.**

Today the two axes are separate: **roles carry permissions, assignments carry scope.** A role means the same thing everywhere it's assigned; where it applies is the assignment's business. That covers more than it first appears — "Admin on workspace A" and "Admin on project X" already produce different effective power from the same role, which is why this can wait.

What it *doesn't* cover, and what we'd be deciding later, roughly in increasing order of cost:

1. **Permissions that only make sense at one level.** `workspace:create` at project scope is nonsense; `translation:save` at org scope is coherent but sweeping. The catalog could carry an `applies_at` level so nonsense grants are rejected at write time instead of silently never matching. *Cheap, additive, likely.*
2. **The same permission meaning different things by level.** `project:update` at workspace scope ("any project in here") vs at project scope ("this one"). Mostly already handled by the scope matcher — worth confirming rather than designing.
3. **Grants themselves carrying scope** — `role_permissions` gaining a scope, so one role could hold `translation:save` at project level but `project:view` at workspace level. *This is the real fork*, and the expensive one: it moves scope from "a property of who you are somewhere" to "a property of each individual capability," and it's painful to retrofit once real grants exist.

**The hedge for M3:** keep the **catalog** the authoritative description of a permission, and keep level assumptions out of scattered route code. Adding a column to the catalog later (option 1) is easy; discovering that six route handlers each hard-coded their own idea of what scope a permission implies is not. Nothing in M3 should assume a permission is inherently level-bound.

### One honest consequence: Owner ≈ Admin in M3

If Owner's distinguishing power is "creates workspaces," and workspaces stay implicit until M7, then **within M3 the practical gap between Owner and Admin is small** — org-level actions, `role:*` (nothing defines custom roles yet), and last-Owner protection.

That's fine, and better than inventing an artificial distinction to make Owner feel special. The grammar and the grants are correct from day one, so when M7 makes workspaces real, Owner's role becomes meaningful **without a permissions migration**. Worth knowing so the small M3 gap doesn't read as a bug.

### Mapping M2's existing gates

Every current role-name constant in `apps/server/src/app.ts` becomes a permission check — this is the migration surface, and it is the whole reason this work lands before onboarding rather than after:

| M2 constant | Becomes |
|---|---|
| `CAN_SAVE_TRANSLATIONS` | `translation:save` |
| `CAN_REVIEW_TRANSLATIONS` | `translation:claim` / `:approve` / `:send_back` (per route) |
| `CAN_MANAGE_PROJECT` | `settings:update` |
| `ANY_ROLE` (comment read) | `comment:view` |

The check becomes *"does the user hold a grant whose scope covers this workspace/project/locale **and** whose role carries a pattern matching the required permission."* So `requireRole(names)` → `requirePermission('translation:save')`, and `hasScopedRole(names, scope)` → `hasPermission(ctx, 'translation:save', scope)`. `AuthContext` grows the permission patterns per grant (one extra join in the session middleware).

### Scope gains a workspace dimension

`role_assignments` currently scopes on nullable `project_id`/`locale_code`, where NULL means "all" (§F3). "Admins assign roles **within a workspace**" needs workspace to be a third scope dimension, so **`workspace_id` (nullable, NULL = all) is added in M3** — even though M3 creates exactly one implicit workspace and nothing can yet create a second.

That's deliberate, and it's the same argument the project already accepted for D1's tenant column: *"retrofitting is a brutal migration; carrying it is nearly free."* With one workspace, every assignment is NULL-or-that-workspace and behavior is identical to today — but the schema and the scope matcher are correct from the start, and M7 becomes a UI/feature milestone rather than a migration of live grant data. The matcher already treats each dimension independently ("NULL means all", dimensions not requested aren't checked), so a third dimension is a uniform extension, not a special case.

**What workspaces are *for* in M3:** exercising the permission machinery early, not being a feature. M3 doesn't need workspaces to be useful — it needs a second scope dimension above `project` so the three-dimensional scope matcher is genuinely tested (rather than "one workspace, so the column is always NULL and the code path never runs"). **Refining the workspace structure itself is M7's job**, and nothing in M3 should be read as settling that shape.

## Definition of done

A freshly hosted instance, empty database, no seed:

1. Opening the app detects "no owner yet" and shows a **setup wizard**, not a login screen. After setup, that same URL shows login/app and **never** the wizard again.
2. The **owner account** step takes an email + password, creates the user through better-auth's real sign-up path, grants the **Owner** role, and signs them in — atomically with the org.
3. The **org name** step names the organization; a default workspace is created implicitly.
4. The **project** step creates a project with a source locale and validated target locales, through the same `POST /v1/projects` a "new project" button will later use, gated on `project:create` — which **Admins hold** within their workspace, not just the Owner.
5. The **optional questionnaire** can be filled or skipped; skipping never blocks completion.
6. The **bootstrap endpoint is provably one-time**: once an owner exists, unauthenticated `POST /v1/setup` returns 409, and two concurrent attempts cannot both create an owner (enforced at the DB, not check-then-insert).
7. **Permissions are real**: every M2 route that used a role-name list now checks a permission, with tests proving a role *without* the permission is refused server-side regardless of UI.
8. **Wildcards work as specified**: `*:*` (Owner) passes everything; `project:*` passes every project action; a role holding only concrete grants is refused the ones it lacks. Exhaustively tested at the matcher level.
9. **Scope holds across three dimensions**: a grant scoped to one workspace/project/locale doesn't reach another, and NULL still means "all" per dimension. Owner-only actions (`workspace:create`, `org:*`, `role:*`) are refused to an Admin server-side.
10. **The last Owner cannot be locked, demoted, or deleted** — nobody can brick their own instance.
11. **Resumability:** creating owner+org then abandoning the wizard, then logging back in, lands in the app (empty project picker + "create your first project"), not a broken or re-triggered wizard.
12. `GET /v1/temp/seed` is gone (see cleanup note below).
13. `pnpm test` passes on every touched package; `pnpm typecheck`/`pnpm lint` exit 0; `vite build` succeeds. Same bar as M1/M2.

## Security spotlight — the one-time bootstrap

- **Unauthenticated by necessity, inert by design.** `POST /v1/setup` cannot require a session — there is nobody to authenticate as. Its guard is *state*: it must refuse the moment an org exists. **409 Conflict**, not 403 — the request is well-formed, it just no longer applies (same reasoning M2 step 4 used).
- **Race safety at the DB, not the app.** "Check no org exists, then insert" is textbook TOCTOU. Two simultaneous calls must not both succeed: enforce a **DB-level singleton invariant** the second inserter violates inside its transaction, so the loser gets a clean 409 rather than a second Owner quietly appearing.
- **Atomic or nothing.** Owner user + Owner role assignment + org + default workspace commit together or roll back together. A half-bootstrapped instance is what makes both the guard and resumability ambiguous.
- **`GET /v1/setup/status` is public but returns only `{ needsSetup: boolean }`** — never the org name, never the owner's email.
- **Cleanup, worth doing early:** the working tree currently carries an uncommitted `GET /v1/temp/seed` that grants Admin to a hardcoded email/password with no auth at all. Alpha or not, that is a "make yourself admin of this instance" endpoint. It gets deleted as part of step 11, and shouldn't survive to any exposed deployment.

## The vertical slice, in order

Same discipline as M1/M2: each numbered item is roughly one commit, built TDD, split if it balloons. Backend work gets the three-layer treatment (module → `Store` against pg-mem → HTTP with real auth) M2 established.

This is a **large milestone** — the permission rework alone is M2-step-4-sized. Phases A–D below are natural PR-series boundaries if we want to land it in pieces.

### Phase A — Permission foundation (must land first; onboarding depends on it)

**1. `permissions` + `role_permissions` schema + Owner role** — **done**
Migration `0014`: both tables, the concrete-permission catalog seeded as system rows (same reasoning as M2's built-in roles: required in every environment, so migration-inserted, not `seed.ts`), the **Owner** role added to `BUILT_IN_ROLE_IDS`, and the starter matrix seeded as grants. An `is_system` marker so built-in roles (Owner especially) can't be deleted or edited by a future custom-roles UI.

**2. The permission matcher** — **done**
A pure module (`permissions.ts`): parse/validate patterns, and `matches(held, required)` implementing the wildcard rule. No DB, no HTTP. Exhaustively tested — every combination of concrete/wildcard on both sides, plus malformed input. This is the highest-leverage test file in the milestone.

*As built* (`apps/server/src/permissions.ts`): a wildcard on the **required** side throws rather than returning a result. The plan says required is always concrete; making that a hard error keeps the matcher total, and turns a would-be silently-permissive query into a caught programming mistake.

**3. `workspace_id` scope dimension on `role_assignments`** — **done**
Nullable column, NULL = all, same rule as `project_id`/`locale_code`. Only one workspace exists in M3, so this is behaviour-neutral today — it's carried now so M7 is a feature milestone rather than a migration of live grant data (D1's precedent). The scope matcher gains a third independent dimension.

**4. `AuthContext` carries permissions** — **done**
Session middleware joins `role_permissions` so each grant carries its patterns alongside its (now three-dimensional) scope. Pure plumbing, no behavior change yet.

*As built* (`apps/server/src/middleware/session.ts`): rather than a three-way join (assignment × role × permission) that would multiply rows, the middleware fetches assignments, then all patterns for the distinct assigned `role_id`s in one query, and attaches them per grant in memory. `RoleGrant.permissions` is a required field (`Permission[]`), so a grant always carries its patterns.

**5. `requirePermission` / `hasPermission`** — **done**
The permission-checking siblings of `requireRole`/`hasScopedRole`, keeping the existing auth + `locked` + scope semantics intact. Built alongside the old ones, not yet swapped in.

*As built* (`apps/server/src/middleware/permission.ts`): pure `hasPermission(ctx, required, scope)` (scope-matched, wildcard via `permissionSatisfies`), plus three middleware factories mirroring the role-name ones — `requirePermission` (instance-wide), `requireProjectAndLocalePermission`, `requireProjectPermission`. `permissions.ts` gained `permissionSatisfies` (parsed-input matcher) so the in-memory grant hot path avoids re-serializing/re-parsing; `matches` now wraps it. Scoped factories are proven through the route tests when step 6 swaps them in (same convention as the role-name scoped middleware, which has no standalone test).

**6. Migrate every route off role names** — **done**
Swap the four M2 constants for permission checks per the mapping table, then **delete** `requireRole`/`hasScopedRole` and the constants so there's one authorization mechanism, not two. M2's existing route tests should pass essentially unchanged — that's the proof the rework preserved behavior.

*As built*: all four route files migrated (`translations`, `comments`, `projects`, `keys`), inline `hasScopedRole` calls swapped for `hasPermission`, and `scope.ts` / `require-role.ts` / `roles.ts` (plus their tests) deleted. Two **deliberate narrowings** fall out of the approved matrix rather than being behavior-preserving: under M2 `CAN_MANAGE_PROJECT` and `CAN_REVIEW_TRANSLATIONS` both included **Developer**, but the matrix gives `settings:*` and the review actions (`claim`/`approve`/`send_back`) to Admin/Owner and Reviewer only. So Developers lost project-settings management and translation review — intended, and exactly the DoD #7 "role lacking the permission is refused" property. The `project-settings` test that asserted "a Developer can toggle" was flipped to assert a 403; no test guarded Developer-can-review, so that narrowing was silent. Everything else passed unchanged.

**7. Last-Owner protection**
The last remaining Owner cannot be locked, demoted, or deleted. Enforced server-side at the mutation points (M2's `locked` flag and role-assignment paths), with tests for each.

**8. Role assignment endpoints**
`role_assignment:*` needs a surface for Admins to actually use it: assign/revoke a role for a user, scoped to the caller's workspace. Gated on `role_assignment:create`/`:revoke`, with the scope check preventing an Admin from granting outside their own workspace — and from granting Owner, which lives behind `role:*`. This is what makes decision 1b real rather than theoretical.

### Phase B — Onboarding backend

**9. `GET /v1/setup/status`** — public, read-only, `{ needsSetup }` derived from "does an org exist." No information leakage.

**10. `POST /v1/setup` — atomic owner + org bootstrap** (the load-bearing step)
Body: `{ ownerEmail, password, ownerName?, orgName }`. One transaction: better-auth `signUpEmail` (real hashing path — same reason `seedAdminUser` uses it) → Owner role assignment → org → default workspace → session cookie returned. Guarded by the state check + DB-level singleton invariant. Tests: happy path, already-setup → 409, and a genuine concurrency test proving only one of two racing calls wins.

**11. `POST /v1/projects` — reusable project creation**
`{ name, sourceLocale, targetLocales[] }`, project + locale rows in one transaction, locale codes validated against the CLDR set `packages/icu` already pins. Gated on `project:create` — held by Owner *and* Admin (workspace-scoped), per decision 1b. The wizard and a future "new project" button call this same endpoint — no wizard-only variant. **Delete `GET /v1/temp/seed` in this commit.**

**12. Survey capture** — `onboarding_responses` (owner-scoped, JSON payload, `created_at`) + `POST /v1/setup/survey`. Nothing keys off the data in M3; it's captured for future defaults/tour work. Optional by construction — completion without it must work.

**13. Seed reconciliation**
Split `seed()` (demo data, dev default) from `seedAdminUser()` (behind a flag, off wherever onboarding should own bootstrap). Verify a real-deployment posture boots to `needsSetup: true` while dev keeps its convenience admin. `docker-compose.yml` env + `CONTRIBUTING.md` updated in the same commit.

### Phase C — The wizard (`apps/editor`)

**14. Wizard shell + first-run gating** — `App` calls `/v1/setup/status` on load; `needsSetup` routes to the wizard, else the existing login/app split. Multi-step **local state**, not a new router (M2 deliberately has none; steps don't need to be URL-addressable yet).

**15. Owner account + org step** — email, password, org name → step 10 → session → advance. Client-side validation with the server as the real gate.

**16. Project + locales step** — form over step 11: name, source-locale picker, target-locale multi-select from the CLDR set.

**17. Questionnaire step** — skippable; "Skip" and "Submit" both advance. Field list TBD with you (team size, primary use case, formats in use, MT interest).

**18. Completion, landing, and no-relapse** — lands in the new project's key list (M2's `ProjectView`), or the empty project picker if the project step was skipped. A test flips `needsSetup` to false and proves the wizard never reappears.

### Phase D — Copy-link invites

**19. Invite backend** — invite-token schema + `POST /v1/invites` (role-scoped, one-time, expiring), gated on `invite:create`, plus a signup-via-invite path that assigns the invited role. No SMTP.

**20. Invite UI** — an optional wizard step / settings panel generating copyable per-role links.

**Design validation worth noting:** because `invite:create` is a *permission*, widening it later — letting Developers invite translators, say — is a **grant change, not a code change**. That's exactly the extensibility decision 3 asked for, and the same mechanism covers granting it to a single user via a scoped role rather than to a whole role class.

## Explicit non-goals for M3

- **No product tour / coach marks.** Named as future; the wizard is transactional setup, not a walkthrough.
- **No SMTP / email-delivered invites or password-reset emails.** Copy-link only; email delivery is M5 with notifications.
- **No custom-role creation UI.** The permissions model makes it *possible* (that's the point), but the UI is later. `is_system` protects the built-ins in the meantime.
- **No deny rules / permission precedence.** Additive-only per §D4 — see the note in the permission model for why this matters.
- **No per-user permission grants.** Permissions attach to roles; users get roles. Direct user grants are a later question if it ever comes up.
- **No OIDC/SAML sign-up.** Local email + password only (F3 deferral, unchanged from M2).
- **No workspace UI, no org/tenant/billing management.** One implicit workspace; D1 is explicit that there's no tenant/billing UI at v1.
- **No CLI, adapters, or extraction** — the following milestone, unchanged in substance.

## On "breaking changes are fine"

Taking the freedom where it genuinely saves work — specifically, **no data-backfill migration** for existing role assignments, and no compatibility shim keeping role-name checks alive next to permission checks (Phase A step 5 deletes them outright).

Still shipping **forward migrations** rather than rewriting `0009` in place, for two reasons that cost nothing: the `pg-mem` test suite runs the whole migration chain as a correctness check, and `docker compose up` stays honest for anyone who already has a database. So "drop and recreate" will be the *documented, easiest* path — not the only one. Say so if you'd rather I collapse the migrations into a clean set instead; it's cheap now and expensive later.

## Roadmap bookkeeping (approved — I'll land these alongside)

- `00-overview.md` milestone map: M3 → onboarding/permissions; CLI shifts down.
- `03-later-milestones.md`: M3 heading replaced; CLI outline moves; add a workspace-management milestone (decision 5).
- `04-open-questions.md`: "To decide by M3" (config format, extraction strategy) re-labelled to the CLI milestone so they don't read as overdue.

## Definition of feedback we want after M3

- Did the setup wizard actually work on a machine that isn't this one — fresh host, empty DB, no shell access to the container?
- Does the Owner/Admin split feel right *in use*, given the gap is small until workspaces land (see "Owner ≈ Admin in M3")? If Owner feels pointless in practice, that's a signal to either pull workspaces forward or move more org-level power behind it.
- Is `role_assignment` vs `role` as separate resources a distinction that holds up, or does it read as hair-splitting once you're clicking through a role-management UI?
- Are three review permissions (`claim`/`approve`/`send_back`) the right granularity, or is one `translation:review` enough in practice?
- Anything about the permission grammar that will fight custom roles or multi-tenant later — wildcards are cheap to change now and painful once real databases hold real grants.
