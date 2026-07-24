# 11 — Dependencies & Versions

Suite 1.0 · **Verified against live registries: 2026-07-21.** Spec requirement:
latest-or-LTS everywhere, no components with known critical CVEs.

## 1. Runtime / toolchain

| Component | Version (2026-07-21) | Channel | Notes |
|-----------|---------------------|---------|-------|
| Node.js | **24.x (Active LTS)** | LTS | Enters maintenance 2026-10-20; Node 26 becomes LTS 2026-10-28 — plan the bump then. EOL v24: 2028-04-30. `engines` + `.nvmrc` pinned. |
| pnpm | 11.15.1 | latest | Portfolio used 10.x this month; 11 is current major — adopt for new repo, migration is trivial. |
| Wrangler | 4.112.0 | latest | `compatibility_date: 2026-07-01`. |

## 2. Application dependencies

| Package | Version | License | Role |
|---------|---------|---------|------|
| astro | 7.1.3 | MIT | Static framework; Rolldown toolchain — compatibility already validated in the SoftHarbor spike |
| svelte | 5.56.7 | MIT | App island, runes |
| @astrojs/svelte | 9.0.1 | MIT | Integration |
| tailwindcss / @tailwindcss/vite | 4.3.3 | MIT | Styling, `@theme` tokens |
| motion | 12.42.2 | MIT | Imperative FX (chosen over GSAP for license — D7). **Not installed as of P2** — P2's motion (4 s bottom-bar auto-hide, toasts, `endFlash`) is CSS transitions only; Motion lands with the P5 visuals that need imperative control |
| music-metadata | 11.14.0 | MIT | `parseBlob` tag/cover extraction. **Production dependency**, dynamically imported at first import action so it stays off the boot chunk (`13 §5` budget) |
| dexie | 4.4.4 | Apache-2.0 | Settings persistence (Apache-2.0 → GPL-3.0 compatible, one-way) |
| i18next | 26.3.6 | MIT | App runtime i18n. **Not installed until P5** — `04 §2` item 5 authorises hardcoded VI + filed keys for P2 (`08 §3.1`) |
| @fontsource/be-vietnam-pro | 5.3.0 | OFL-1.1 (pkg MIT) | UI font, VI diacritics. **Installed in P6 slice A** — see the note below |
| @fontsource/jetbrains-mono | 5.3.0 | OFL-1.1 (pkg MIT) | Mono/meta font. **Installed in P6 slice A** |
| DSEG7 Classic (vendored) | **v0.46** ✅ *verified 2026-07-21 via GitHub Releases API — latest **stable** release, published 2020-03-15. A `v0.50beta1` tag exists but is not a release; do not vendor a beta into a distributed font.* | OFL-1.1 | Seven-segment digits; `public/fonts/dseg7/` + OFL.txt |

## 3. Dev dependencies

| Package | Version | Role |
|---------|---------|------|
| typescript | **`~5.9`** (resolved 5.9.3) — TS 7 rejected, **see §4** | Types |
| eslint | 10.7.0 | Lint (flat config) |
| eslint-plugin-svelte | 3.22.0 | Svelte rules |
| prettier | 3.9.5 | Format. **Plugins must be `prettier-plugin-svelte@^4` and `prettier-plugin-tailwindcss@^0.8`** — the 3.x/0.6.x pair crashes on every `.svelte` file with `TypeError: getVisitorKeys is not a function` (the Tailwind plugin wraps the Svelte one and the older pair mis-negotiates prettier 3.9's embedded-language API). Also `prettier-plugin-astro` for `.astro`. |
| knip | 6.27.0 | Dead/unused code gate (spec requirement) |
| svelte-check | 4.7.3 | Template type-checking |
| vitest | 4.1.10 | Unit/component runner |
| @testing-library/svelte | 5.4.2 | Component tests. ⚠️ Requires `resolve.conditions: ['browser']` in `vitest.config.ts` — without it `import { mount } from 'svelte'` resolves to Svelte 5's **server** build and every component test dies with `mount(...) is not available on the server`. Measured 2026-07-21 against the P1 config, before the tier had any tests in it |
| happy-dom | 20.11.0 | Test DOM |
| @playwright/test | 1.61.1 | E2E |
| @vitest/coverage-v8 | 4.1.10 | Coverage provider — the docs/13 §1 threshold is enforced, so it must exist |
| ffmpeg-static | 5.3.0 | **Dev-only fixture generation** (`scripts/make-fixtures.ts`). Its postinstall downloads a prebuilt ffmpeg (GPL); never imported by shipped code and never distributed, so no notice obligation follows (`§5`). Requires an explicit `allowBuilds` entry in `pnpm-workspace.yaml` — pnpm blocks postinstall scripts by default and we keep that guard. |
| @cloudflare/workers-types | 5.x | Worker globals. Kept in a separate program (`tsconfig.worker.json`) because it conflicts with the DOM lib |
| @astrojs/sitemap | 3.7.3 | **Dev-only, no notice row** (`§5`) — MIT, runs at build and emits static XML; nothing of it reaches the bundle, exactly like Astro/Vite/Tailwind. Added in P6 slice A because the sitemap is derived from the routes actually built: a hand-authored one is a second source of truth that rots the first time someone adds a page. Its `i18n` option is **not** used — it assumes locales are path prefixes (`/vi/`) and Vietnamese lives at the root, so hreflang stays in the page (`08 §1`) |

### The fonts were named for four phases before they were installed

This table pinned both `@fontsource` packages from suite 1.0 and `03 §1` said
"fonts are self-hosted (privacy §09)" — but **neither was actually a dependency
until P6 slice A**, so `--font-ui` and `--font-mono` named families the build
never shipped and every surface fell back to `system-ui`.

It was never a privacy defect: `font-src 'self'` forbids a third-party font
fetch outright, and a missing family simply falls through to the next in the
stack. It was a **fidelity** one — Vietnamese diacritics rendered in the OS font
rather than the face the design was drawn for. It was closed on the release that
publishes the landing page, because that is the first surface a stranger sees
and the same release publishes the Privacy Policy making the self-hosted claim.

Imported as the **full weight files** (`400.css`, `500.css`, `600.css`), not the
`latin-*` subsets: each carries `unicode-range` per subset, so `/en/` fetches
only latin while `/` adds the ~8 KB vietnamese subset because the page genuinely
contains those code points. Importing the subset files instead would drop the
ranges and fetch everything everywhere.

⚠️ **knip cannot see these.** They are reached by `@import` from
`src/styles/global.css`, and knip parses JS/TS imports, not CSS — so both sit in
`knip.json`'s `ignoreDependencies` beside `tailwindcss`, which is there for the
same reason. Removing either "unused" entry would silently restore the
`system-ui` fallback this note exists to explain.

## 4. TypeScript version — ✅ RESOLVED 2026-07-21: pinned `~5.9`

**Decision: `typescript@~5.9` (5.9.3).** TypeScript 7.0.2 was tried first per the
original instruction and rejected. Probe run in an isolated scratch project
(Node 24.18.0, pnpm 11.1.0, svelte 5.56.7, svelte-check 4.7.3, eslint 10.7.0,
eslint-plugin-svelte 3.22.0, typescript-eslint 8.64.0) against one `.ts` and one
`.svelte` file using the exact `12 §2` compiler flags.

| Tool | TS 7.0.2 | TS 5.9.3 |
|------|----------|----------|
| `tsc --noEmit` | ✅ exit 0 | ✅ exit 0 |
| **`svelte-check`** | ❌ **hard crash** — `TypeError: Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')`, thrown constructing `FileMap` from `typescript.sys` | ✅ 0 errors, 0 warnings |
| **`typescript-eslint`** | ❌ peer range is `>=4.8.4 <6.1.0` — unmet across all 8 `@typescript-eslint/*` packages | ✅ no peer issues |
| `eslint` (flat, ts + svelte) | not reached | ✅ exit 0 |

The native Go-based TS 7 does not expose the CJS `typescript.sys` shape that
svelte-language-tools reads, so this is a crash rather than a warning — `pnpm
check` would be permanently red. The compiler itself is fine; the ecosystem is
not, exactly as this section anticipated.

**Revisit when** svelte-check declares TS 7 support *and* typescript-eslint
widens its peer range — both must land, since either alone still breaks
`pnpm check` or `pnpm lint`. 5.9 remains maintained, so there is no pressure.

## 5. CVE & update process

- **At scaffold:** `pnpm audit --prod` must be clean of high/critical before the
  first commit of `pnpm-lock.yaml`. (Registry-only environment here — the audit
  itself runs at scaffold, not in this suite.)
- **Continuous:** CI gate `pnpm audit --prod` (fail ≥ high) + CodeQL
  `javascript-typescript` + Dependabot weekly grouped PRs (`14 §2`).
- **Policy:** patch/minor updates auto-PR'd; majors get a short written check in
  the PR (breaking changes + license re-check). Security releases jump the queue.
- Licenses of any new dependency are checked for GPL-3.0 compatibility **and for
  attribution/notice obligations** before merge, and appended to
  `legal/THIRD-PARTY-NOTICES.md`.

  **Scope: distributed code.** The notice obligation attaches to what ships in
  the built output. Dev-only tooling that is never bundled — the test runners,
  linters, formatters, `ffmpeg-static`, Testing Library — carries none, and
  `legal/THIRD-PARTY-NOTICES.md` already says so in one paragraph rather than
  one row each. The **compatibility** check still applies to everything, because
  a tool with a viral license can still constrain how the repo is licensed. State
  which of the two applies when adding a dependency; "dev-only, no notice row" is
  a claim a reviewer should be able to check, not a shrug.

## 6. Deliberately absent

GSAP (non-FOSS license, D7) · music-metadata-browser (deprecated; main package
does blobs) · any yt-dlp-class tool (ToS, `06 §1`) · Google Fonts CDN (privacy —
fonts self-hosted) · analytics SDKs (privacy default).
