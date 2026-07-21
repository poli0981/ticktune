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
| motion | 12.42.2 | MIT | Imperative FX (chosen over GSAP for license — D7) |
| music-metadata | 11.14.0 | MIT | `parseBlob` tag/cover extraction |
| dexie | 4.4.4 | Apache-2.0 | Settings persistence (Apache-2.0 → GPL-3.0 compatible, one-way) |
| i18next | 26.3.6 | MIT | App runtime i18n |
| nanoid | 6.0.0 | MIT | Track ids |
| @fontsource/be-vietnam-pro | 5.3.0 | OFL-1.1 (pkg MIT) | UI font, VI diacritics |
| @fontsource/jetbrains-mono | 5.3.0 | OFL-1.1 (pkg MIT) | Mono/meta font |
| DSEG7 Classic (vendored) | v0.46 *(GitHub API rate-limited during verification — re-verify tag at scaffold)* | OFL-1.1 | Seven-segment digits; `public/fonts/dseg7/` + OFL.txt |

## 3. Dev dependencies

| Package | Version | Role |
|---------|---------|------|
| typescript | 7.0.2 — **see caveat §4** | Types |
| eslint | 10.7.0 | Lint (flat config) |
| eslint-plugin-svelte | 3.22.0 | Svelte rules |
| prettier | 3.9.5 | Format (+ svelte & tailwind plugins) |
| knip | 6.27.0 | Dead/unused code gate (spec requirement) |
| svelte-check | 4.7.3 | Template type-checking |
| vitest | 4.1.10 | Unit/component runner |
| @testing-library/svelte | 5.4.2 | Component tests |
| happy-dom | 20.11.0 | Test DOM |
| @playwright/test | 1.61.1 | E2E |

## 4. TypeScript 7 caveat (open action item)

`latest` is now the native (Go-based) 7.0 line. Ecosystem tooling
(svelte-check / svelte-language-tools / typescript-eslint) may still expect the
5.x/6.x TS-in-TS line. **At scaffold:** try 7.0.2; if svelte-check or
typescript-eslint reject the peer range or misbehave, pin `typescript@~5.9`
(still maintained) and record the decision here. Ten-minute check, do it first.

## 5. CVE & update process

- **At scaffold:** `pnpm audit --prod` must be clean of high/critical before the
  first commit of `pnpm-lock.yaml`. (Registry-only environment here — the audit
  itself runs at scaffold, not in this suite.)
- **Continuous:** CI gate `pnpm audit --prod` (fail ≥ high) + CodeQL
  `javascript-typescript` + Dependabot weekly grouped PRs (`14 §2`).
- **Policy:** patch/minor updates auto-PR'd; majors get a short written check in
  the PR (breaking changes + license re-check). Security releases jump the queue.
- Licenses of any new dependency are checked for GPL-3.0 compatibility before
  merge and appended to `legal/THIRD-PARTY-NOTICES.md`.

## 6. Deliberately absent

GSAP (non-FOSS license, D7) · music-metadata-browser (deprecated; main package
does blobs) · any yt-dlp-class tool (ToS, `06 §1`) · Google Fonts CDN (privacy —
fonts self-hosted) · analytics SDKs (privacy default).
