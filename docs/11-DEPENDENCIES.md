# 11 — Dependencies & Versions

Suite 2.0 · **Versions as of v2.0.2 (2026-10-26), resolved from `pnpm-lock.yaml`.**
Spec requirement: latest-or-LTS everywhere, no components with known critical
CVEs. Dependabot moves these weekly, so treat a version here as a floor and the
lockfile as the truth.

## 1. Runtime / toolchain

| Component | Version (v2.0.2) | Channel | Notes |
|-----------|---------------------|---------|-------|
| Node.js | **24.x (Maintenance LTS)** | LTS | Entered maintenance 2026-10-20; Node 26 becomes LTS 2026-10-28. `.nvmrc` pins 24 (every job, Workers Builds); `engines` is `>=24 <27` and the `ci-node26` job builds and tests on 26 (`14 §1`). EOL v24: 2028-04-30. |
| pnpm | 11.15.1 | latest | Portfolio used 10.x this month; 11 is current major — adopt for new repo, migration is trivial. |
| Wrangler | **4.152.0** | latest | `compatibility_date: 2026-07-01`. Its `miniflare` resolves `sharp@0.35.5`, past the four libvips CVEs in `sharp <0.35.0` (GHSA-f88m-g3jw-g9cj) that first forced a Wrangler bump (4.112 → 4.114, see `§5`). Its `undici` is overridden to `7.30.1` — 4.152.0 still pins `7.29.1` exactly (`§5`) |

## 2. Application dependencies

| Package | Version | License | Role |
|---------|---------|---------|------|
| astro | 7.4.2 | MIT | Static framework; Rolldown toolchain — compatibility already validated in the SoftHarbor spike |
| svelte | 5.57.2 | MIT | App island, runes |
| @astrojs/svelte | 9.1.1 | MIT | Integration |
| tailwindcss / @tailwindcss/vite | 4.3.3 | MIT | Styling, `@theme` tokens |
| motion | — | MIT | **Not installed.** The vetted choice over GSAP (licence, D7) if imperative animation is ever needed; every animation shipped through v1.1 is CSS keyframes and transitions |
| music-metadata | 12.3.0 | MIT | `parseBlob` tag/cover extraction. **Production dependency**, dynamically imported at first import action so it stays off the boot chunk (`13 §5` budget) |
| dexie | 4.4.7 | Apache-2.0 | Settings persistence (Apache-2.0 → GPL-3.0 compatible, one-way) |
| i18next | 26.5.10 | MIT | App runtime i18n — installed in P5 slice 1, when the dictionaries were wired (`08 §2`) |
| @fontsource/be-vietnam-pro | 5.3.0 | OFL-1.1 (pkg MIT) | UI font, VI diacritics. **Installed in P6 slice A** — see the note below |
| @fontsource/jetbrains-mono | 5.3.0 | OFL-1.1 (pkg MIT) | Mono/meta font. **Installed in P6 slice A** |
| @fontsource/chakra-petch | 5.3.0 | OFL-1.1 (pkg MIT) | Display font for the v1.1 "Rack Unit" redesign (labels, headings, keycaps); full Vietnamese subset checked before adoption. CSS-imported, so it is in `knip.json` `ignoreDependencies` and `make-notices.ts` `CSS_ONLY` like the other two |
| DSEG14 Classic (vendored, v2.0) | **v0.46** — the same release asset as DSEG7 (SHA-256 recorded in `public/fonts/dseg14/PROVENANCE.md`), retrieved 2026-10-21 | OFL-1.1 | The second clock face; `public/fonts/dseg14/` + OFL.txt |
| DSEG7 Classic (vendored) | **v0.46** ✅ *verified 2026-07-21 via GitHub Releases API — latest **stable** release, published 2020-03-15. A `v0.50beta1` tag exists but is not a release; do not vendor a beta into a distributed font.* | OFL-1.1 | Seven-segment digits; `public/fonts/dseg7/` + OFL.txt |

## 3. Dev dependencies

| Package | Version | Role |
|---------|---------|------|
| typescript | **`~6.0`** (resolved 6.0.3) — TS 7 still rejected, **see §4** | Types |
| eslint · @eslint/js · typescript-eslint | 10.13.0 · 10.0.1 · 8.72.0 | Lint (flat config) |
| eslint-plugin-svelte · svelte-eslint-parser | 3.23.1 · 1.10.0 | Svelte rules |
| globals | 17.13.0 | ESLint environment globals |
| prettier | 3.9.10 | Format. **Plugins must be `prettier-plugin-svelte@^4` and `prettier-plugin-tailwindcss@^0.8`** — the 3.x/0.6.x pair crashes on every `.svelte` file with `TypeError: getVisitorKeys is not a function` (the Tailwind plugin wraps the Svelte one and the older pair mis-negotiates prettier 3.9's embedded-language API). Also `prettier-plugin-astro` for `.astro`. |
| knip | 6.43.0 | Dead/unused code gate (spec requirement) |
| svelte-check · @astrojs/check | 4.7.7 · 0.9.12 | Template type-checking (`pnpm check`) |
| @sveltejs/vite-plugin-svelte | 7.3.1 | Svelte in Vitest |
| vitest | 5.0.5 | Unit/component runner. The 4 → 5 major (2026-10-26) needed no change: 1,030 tests green, and the coverage report lists the same 53 files under both — 5's `coverage.include` matching is relative to the root now, and `src/**/*.ts` already was. `clearMocks` defaults to `true` in 5, which can only make an assertion stricter; none failed |
| @testing-library/svelte | 5.4.2 | Component tests. ⚠️ Requires `resolve.conditions: ['browser']` in `vitest.config.ts` — without it `import { mount } from 'svelte'` resolves to Svelte 5's **server** build and every component test dies with `mount(...) is not available on the server`. Measured 2026-07-21 against the P1 config, before the tier had any tests in it |
| happy-dom | 21.0.4 | Test DOM |
| @playwright/test | 1.64.1 | E2E, and the visual and render-cost suites. The visual baselines are made only in `mcr.microsoft.com/playwright:v1.64.1-noble`, pinned by digest in `quality.yml` and `scripts/visual-docker.ts` — a Playwright bump moves the image and regenerates every baseline in the same PR (`13 §3`) |
| @axe-core/playwright | 4.14.0 | The a11y scan (`13 §6`) |
| @vitest/coverage-v8 | 5.0.5 | Coverage provider — the docs/13 §1 threshold is enforced, so it must exist |
| @lhci/cli | 0.15.1 | Lighthouse CI (v2.0, `13 §5`). Apache-2.0, dev-only, never distributed — no notice row (`§5`). Reports go to a workflow artifact, never to Google's public storage |
| @types/node | 24.x | Node types, held to the lowest supported major (24) — Dependabot ignores its majors (`14 §1`) |
| ffmpeg-static | 5.3.0 | **Dev-only asset generation** (`scripts/make-fixtures.ts`, `scripts/make-demo.ts`). Never imported by shipped code and never distributed, so no notice obligation follows (`§5`). Its postinstall downloads an **unchecksummed** prebuilt ffmpeg (GPL), so `pnpm-workspace.yaml` sets `allowBuilds: ffmpeg-static: false` — the binary is fetched on demand by `scripts/ensure-ffmpeg.ts` on a developer machine, never on a CI runner (`14 §2`). |
| @cloudflare/workers-types | 5.x | Worker globals. Kept in a separate program (`tsconfig.worker.json`) because it conflicts with the DOM lib |
| @astrojs/sitemap | 3.7.4 | **Dev-only, no notice row** (`§5`) — MIT, runs at build and emits static XML; nothing of it reaches the bundle, exactly like Astro/Vite/Tailwind. Added in P6 slice A because the sitemap is derived from the routes actually built: a hand-authored one is a second source of truth that rots the first time someone adds a page. Its `i18n` option is **not** used — it assumes locales are path prefixes (`/vi/`) and Vietnamese lives at the root, so hreflang stays in the page (`08 §1`) |
| @astrojs/markdown-satteri | **pinned `0.4.5`** | **Dev-only, no notice row** (`§5`) — MIT, the Markdown processor; it runs at build and emits static HTML. Added in P6 slice B only so `astro.config.mjs` can `import { satteri }` and pass `mdastPlugins` (the legal `.md` cross-link rewrite, `08 §1.1`). ⚠️ **Pin it to exactly the version Astro depends on**, not a range: it is already in the tree as Astro's own dependency, and an exact match dedupes to one copy while a looser range would resolve a second Markdown processor beside the one actually rendering. Astro 7 made Sätteri the default and `markdown.remarkPlugins` now needs `@astrojs/markdown-remark` instead — switching the whole pipeline back to unified to rewrite two links is the wrong trade |

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

## 4. TypeScript version — ✅ RESOLVED 2026-07-21: pinned `~5.9` · moved to `~6.0` 2026-10-26

**Since 2026-10-26: `typescript@~6.0` (6.0.3).** TS 6 is the last
JavaScript-based release, and the ecosystem below now accepts it where it still
refuses 7: svelte-check 4.7.7 and @astrojs/check 0.9.12 declare peer
`typescript: ^5.0.0 || ^6.0.0`, and typescript-eslint 8.72.0 is still
`>=4.8.4 <6.1.0`. Measured on the whole repo, not a probe: `pnpm check` 0 errors
and 0 warnings across 1,434 files, lint, knip, build and the 1,030 unit and
component tests green, and the build byte-identical to 5.9's (the same
service-worker version — `noEmit`, so the compiler never touched the output).
The one change TS 6 asked for: `baseUrl` is deprecated (7 drops it), so
`tsconfig.json` no longer sets it and its two `paths` start with `./`.
The 7 rejection below stands, and `dependabot.yml` still ignores TypeScript
majors — 7 is the next one.

**Decision 2026-07-21: `typescript@~5.9` (5.9.3).** TypeScript 7.0.2 was tried first per the
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
`pnpm check` or `pnpm lint`. Neither had landed by 2026-10-26 (see above).

## 5. CVE & update process

- **At scaffold:** `pnpm audit --prod` must be clean of high/critical before the
  first commit of `pnpm-lock.yaml`. (Registry-only environment here — the audit
  itself runs at scaffold, not in this suite.)
- **Continuous:** CI gate `pnpm audit --prod` (fail ≥ high) and, since v1.1, a
  whole-tree audit failing on **critical** — dev tooling included — plus CodeQL
  (default setup) and Dependabot weekly grouped PRs (`14 §1`).
- **Policy:** patch/minor updates auto-PR'd; majors get a short written check in
  the PR (breaking changes + license re-check). Security releases jump the queue.

  ⚠️ **`pnpm audit --prod` is deliberately narrower than "no vulnerabilities",
  and the first advisory after 1.0 showed the gap.** CodeQL flagged four libvips
  CVEs in `sharp <0.35.0` (GHSA-f88m-g3jw-g9cj) while `pnpm audit --prod` was
  **clean** — correctly, because the vulnerable copy came in via
  `wrangler → miniflare`, a **devDependency**, and `astro`'s own `sharp` was
  already on a patched 0.35.x. The `--prod` gate is about what ships to users;
  a dev-only advisory still runs on developer machines and in CI, so it is worth
  fixing — and since v1.1 a critical one fails CI too. Run
  `pnpm audit --audit-level high` (no `--prod`) when triaging one of these.

  **Prefer an upstream bump to an override.** `miniflare` pinned `sharp@0.34.5`
  *exactly*, so `pnpm update` could not move it and the options were a
  `pnpm.overrides` entry — forcing a version past a pin its author chose — or a
  newer `wrangler`. `4.114.0` ships `miniflare@4.20260722.0` with `sharp@0.35.2`,
  so the fix is the one upstream intended and nothing is forced. Verified with
  `wrangler deploy --dry-run` before merge, because a build tool that installs
  is not the same as one that still works.

  ✅ **Closed, same class:** `brace-expansion ≤5.0.7` (GHSA-mh99-v99m-4gvg)
  reached the tree through **eslint** over 37 paths; it cleared upstream as the
  advice here predicted — the lockfile now resolves only `5.0.12`.

  **When upstream cannot move: `@lhci/cli` (v2.0).** Lighthouse CI arrived with
  six Dependabot alerts in its dev-only tree, and `@lhci/cli` 0.15.1 is the
  latest release, pinning `lighthouse@12.6.1` exactly — there was no bump to
  prefer. So, in `pnpm-workspace.yaml`, each override with its reason beside it:
  `tmp ^0.2.6` (two alerts) and `uuid ^11.1.1` (one) move to patched releases
  whose APIs the callers use unchanged (`tmp.fileSync`, `uuid.v4()`); and
  `sprintf-js`, which has **no** patched release, leaves the tree entirely by
  pointing `js-yaml@3`'s `argparse` at v2 — js-yaml 3 loads argparse only in its
  own CLI, which nothing runs. `pnpm audit` had a seventh before Dependabot did,
  `basic-ftp ≤ 6.2.0` (GHSA-c475-qrg2-pj4r) under `proxy-agent → get-uri`;
  `get-uri>basic-ftp ^6.2.1` crosses a major, checked against the five calls
  get-uri makes (`access`, `lastMod`, `list`, `downloadTo`, `modifiedAt`), all
  still there. Verified by running `pnpm lhci` on the result.

  **v2.0.2 (2026-10-26) — the scheduled `audit` went red on `main`**, on
  `undici 8.11.2` (GHSA-xjj6-f33q-929c, high) under `astro → unifont`: a
  build-time font resolver, never in the client bundle, but the `--prod` gate
  counts what `dependencies` pull, not what ships. The whole tree had sixteen
  more. In the order this section prefers:
  - **Upstream bumps, or a range already allowing the fix:** Astro 7.4.2 and
    `pnpm update undici body-parser fast-uri` moved `unifont`'s undici to
    8.12.3, `@lhci/cli → express`'s body-parser to 1.20.9
    (GHSA-27r3-jxmh-p828, high) and `@astrojs/check`'s fast-uri to 3.1.9 (four
    advisories); happy-dom 21.0.4 (GHSA-834v-8h66-3h79, high) and vitest
    5.0.5 (`@vitest/mocker`, Dependabot alerts 68 and 69) are direct bumps.
  - **Overrides, where upstream cannot move** (`pnpm-workspace.yaml`, reasons
    beside them): `miniflare>undici ^7.30.1` — Wrangler 4.152.0, the latest,
    still pins `7.29.1` exactly, so this is a patch inside the line miniflare
    chose; verified with `wrangler deploy --dry-run` and `pnpm verify:csp`
    (6/6), which runs the site under `wrangler dev` and so through miniflare.
    `chromium-bidi>zod ^4.6.6` — GHSA-mrhx-c7xc-m3w5 (high) has no 3.x
    release, and puppeteer-core 24.43.1 pins chromium-bidi 14, which asks for
    zod 3. puppeteer-core reaches chromium-bidi only through a dynamic
    `import('bidi.js')` taken for `protocol: 'webDriverBiDi'`, and Lighthouse
    connects over CDP, so zod 3 leaves the tree the way sprintf-js did.

  **`extract-zip ≤ 2.0.1` stays** (GHSA-7pqw-9j4j-h8q3, GHSA-jmr9-qjv8-65gv:
  symlink entries can write outside the target). Since 2026-10 the advisories
  name `2.0.2` as patched, but npm's newest release is still `2.0.1`, so there
  is still nothing to move to;
  it reaches us through `lighthouse → puppeteer-core 24 → @puppeteer/browsers 2`,
  whose 3.x replaced it but belongs to a puppeteer major `@lhci` does not use;
  and its only caller **unpacks a browser that puppeteer downloads**. Lighthouse
  CI here never downloads one — it launches the installed Chrome
  (`CHROME_PATH` in `quality.yml`, the system Chrome locally) — so the
  vulnerable code has no input to read. Re-check when `@lhci/cli` moves to
  Lighthouse 13.
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

  ✅ **Since P7 slice A the claim is checked by the build, not by the reviewer.**
  `scripts/make-notices.ts` emits `dist/THIRD-PARTY-NOTICES.txt` containing the
  **full licence text** of every package whose code is in the shipped client
  bundle, and **fails the build** if any of them has no licence text to
  reproduce. That closes the `AUDIT-BACKLOG` release blocker, whose point was
  that a hand-kept table structurally cannot carry the obligation: `music-metadata`
  alone brings `strtok3`, `token-types`, `@borewit/text-codec`,
  `@tokenizer/inflate`, `file-type` and `uint8array-extras` into the bundle, and
  nobody was ever going to add those rows by hand. **20 components** are
  attributed as of v1.1 (Chakra Petch was the twentieth) where the curated table
  lists 11.

  ⚠️ **Which packages comes from the build, not from `package.json`.** The
  `ttBundledPackages` plugin in `astro.config.mjs` reads the module graph of the
  **client** environment only. Collecting the server pass too — the first
  version's bug — attributed `astro`, `zod` and `cookie` as if a browser had
  downloaded them, and `pnpm licenses list --prod` on its own reports **233**
  packages including the Astro compiler. Attribution attaches to what is
  distributed; that is the whole distinction this section is about.

  ⚠️ **The three `@fontsource` families are added by name in that script**, because
  woff2 arrives through a CSS `@import` and never appears as a JS module. It is
  the same blind spot that makes `knip` need them in `ignoreDependencies`. Two
  workarounds for one cause: move them together, or the OFL text silently stops
  shipping.

  `legal/THIRD-PARTY-NOTICES.md` remains the **curated human overview** and is
  not generated. Two artifacts, two jobs: one is read by a person deciding
  whether to trust the app, the other satisfies a licence.

## 6. Deliberately absent

GSAP (non-FOSS license, D7) · music-metadata-browser (deprecated; main package
does blobs) · any yt-dlp-class tool (ToS, `06 §1`) · Google Fonts CDN (privacy —
fonts self-hosted) · analytics SDKs as dependencies (the one analytics script is Cloudflare's hosted beacon, loaded at runtime and disclosed — `09 §1`).
