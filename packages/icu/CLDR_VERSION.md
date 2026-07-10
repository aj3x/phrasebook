# CLDR version

This package pins exact versions of the ICU-parsing libraries:

- `intl-messageformat@11.2.10`
- `@formatjs/icu-messageformat-parser@3.5.13`

**Important:** neither of these packages bundles CLDR plural-rule data.
`intl-messageformat` resolves plural categories (`zero`/`one`/`two`/`few`/`many`/`other`)
by calling the JS runtime's native `Intl.PluralRules`, not a FormatJS-shipped dataset.
Pinning the npm package version pins the *parser/formatter API surface*, not the CLDR
plural rules themselves.

The CLDR plural rules actually used at runtime come from the ICU data compiled into
**Bun**, since Bun is the pinned runtime (`docker/server.Dockerfile` uses
`oven/bun:1-alpine`; see `plan/01-repo-topology.md`).

As of this package's initial implementation:

- Bun version: `1.3.14`
- Bundled ICU version (`process.versions.icu`): `75.1`
- Bundled Unicode version (`process.versions.unicode`): `15.1`
- ICU 75 ships in lockstep with **CLDR 45**.

If the plural output for any locale (e.g. Arabic's six categories) ever looks wrong,
check the Bun version first — bumping Bun can shift CLDR plural data even with these
npm versions held constant. Re-verify by running:

```sh
bun -e "console.log(process.versions.icu, process.versions.unicode)"
```

and cross-referencing the ICU→CLDR version table at
<https://github.com/unicode-org/icu/blob/main/icu4c/readme.html> (or the ICU release notes)
before bumping either Bun or these package pins.
