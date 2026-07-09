# Overview

## North star for the build

A dev clones the repo, runs `docker compose up`, opens a demo React app, and sees a translated string render — including a working ICU plural — in under 5 minutes. That's Milestone 1's user-visible outcome. Everything else grows out of that seed.

## Guiding principles for the build (not just the spec)

1. **Build the interface, not the driver.** §6's store interface goes in at M1 even though only the Postgres driver exists. Adding the git driver later must be an implementation change, not a refactor. Same for §6.3's `JobRunner` — put the interface behind the seam even if M1's implementation is just "call it inline."
2. **Ship the smallest slice that exercises the load-bearing pieces.** M1 touches the store interface, ICU MessageFormat, CLDR plurals, locale fallback, and the runtime delivery contract — the parts most likely to be wrong if built in isolation.
3. **Never fake ICU.** The moment we render text, we render it through `intl-messageformat`. No `String.replace` placeholders in demo code. If ICU is wrong for us at M1 it's wrong forever.
4. **Auth-off at localhost, auth-on before anything sensitive.** M1's server binds `127.0.0.1` and skips auth — API tokens land at M2 when the editor arrives. This keeps M1 small without shipping a footgun.
5. **DB migrations from commit 1.** No "we'll add migrations later." Kysely migrator with a `migrations/` dir from the first schema.
6. **No premature abstraction for MT/plugins/Figma.** M1 doesn't need a plugin trait. Add extension points where §8 requires them, when we need them.
7. **`tms-foundations.md` is the contract; the plan is negotiable.** If a milestone reveals a spec ambiguity, flag it — don't quietly reinterpret.

## Milestone map at a glance

| # | Name | User-visible outcome | Approx. size |
|---|---|---|---|
| **M1** | **Rendering slice** | Demo React app renders a translated string + ICU plural from the server. Locale switcher works. Fallback chain works. | Small, ~1 week solo. |
| M2 | Editor + auth | Log in, create a project + locales, add keys, edit translations in a keyboard-first workspace. Status machine visible. | Medium. |
| M3 | CLI + JSON adapter + extraction | `tms init`, `tms push`, `tms pull`, `tms status` against a demo repo with a JSON adapter. Key extraction from source. | Medium. |
| M4 | Review workflow + MT + notifications | Reviewer send-back, needs_update cascade, one MT provider, in-app notifications, hash-chained audit. | Medium-large. |
| M5 | Plugins (in-process), TM/glossary/DNT, QA checks, CI action | The remaining MVP surface from §10. | Large. |
| M6+ | Git/lite driver, CDN-push, Figma import, webhooks, community-plugin isolation, etc. | Phase 2/3 in the spec. | Ongoing. |

Only M1 has a fully written checklist right now. M2–M6 exist as outlines in `03-later-milestones.md` and get expanded after M1 lands.

## Working agreement

- **Feedback cadence:** you run M1 when it's up; I don't guess what to build next until you've poked it.
- **Scope creep goes to `04-open-questions.md`.** If M1 grows a "wouldn't it be great if…" it goes on that list, not into M1.
- **Small PRs, real commits.** Each M1 step below is a commit-sized chunk.
- **I ask before doing anything hard-to-reverse** (schema-shape changes after M1 lands, dep bumps that break Bun compat, etc.).
- **No TODO markers left in code.** Anything unfinished is either done or documented in `04-open-questions.md`.

## Non-goals for M1 (explicit)

Called out because they're tempting to sneak in:

- No auth beyond "server binds localhost."
- No editor UI. The seed script is how translations get in for M1.
- No CLI.
- No MT/LLM.
- No status transitions beyond `untranslated → published` (seed-set).
- No hash-chain audit *checking* (schema exists; enforcement lands with M4).
- No git driver. No sidecar. No plugin loading.
- No SSE, no webhooks, no notifications.
- No search, no glossary, no DNT, no QA checks.
- No CDN-push delivery. Client-pull only, `ETag` + `Cache-Control`.
- No Figma anything.
- No dogfooding-of-editor-strings. TMS UI localization comes when there's UI.

If any of these should come earlier, say so before I start.
