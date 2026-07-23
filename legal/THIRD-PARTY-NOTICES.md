# TickTune — Third-Party Notices (Draft)

Version 1.0-draft · 2026-07-21 · Rendered at `/legal/third-party` and linked
from the Legal Gate and About panel. Process rule: any new dependency is added
here in the same PR that introduces it, after a GPL-3.0 compatibility check
(`docs/11 §5`).

TickTune's own code: **GPL-3.0-only** — © 2026 poli0981.

## Bundled / vendored components

| Component | License | Notes |
|-----------|---------|-------|
| Astro | MIT | build framework |
| Svelte | MIT | UI runtime |
| @astrojs/svelte | MIT | integration |
| Tailwind CSS | MIT | styling |
| Motion | MIT | animation (from P5; not yet installed) |
| music-metadata | MIT | audio tag parsing |
| Dexie.js | Apache-2.0 | IndexedDB wrapper (Apache-2.0 code combined into a GPL-3.0 project — one-way compatible) |
| i18next | MIT | i18n runtime (26.3.6, installed in P5) |
| DSEG7 Classic (font) | SIL OFL 1.1 | © 2017 keshikan (http://www.keshikan.net), **Reserved Font Name "DSEG"**. v0.46, vendored unmodified; the full licence ships with the build as `public/fonts/dseg7/OFL.txt` (OFL §2 requires it to accompany the font). Provenance and SHA-256 hashes: `public/fonts/dseg7/PROVENANCE.md`. The reserved name means the file must not be subset or regenerated while keeping the name — a derivative must be renamed. |
| Be Vietnam Pro (font) | SIL OFL 1.1 | via @fontsource package (packaging MIT) |
| JetBrains Mono (font) | SIL OFL 1.1 | via @fontsource package (packaging MIT) |

Dev-only tooling (TypeScript, ESLint, Prettier, knip, Vitest, Testing Library,
happy-dom, Playwright, ffmpeg-static, Wrangler, pnpm) is **not distributed with
the app**, so no notice obligation attaches to it and it gets no row above. Its
GPL-3.0 *compatibility* is still checked before it lands, per `docs/11 §5` —
the two questions are separate and only one of them stops at the build boundary.

## Services (not bundled)

| Service | Terms |
|---------|-------|
| YouTube embedded player & IFrame Player API | YouTube Terms of Service; loaded at runtime from YouTube only in YouTube mode; never bundled or modified |
| YouTube oEmbed (via our edge proxy) | Public oEmbed endpoint; only video IDs are forwarded |
| Cloudflare (hosting/CDN/Workers) | Cloudflare service terms |

## Media

**TickTune ships no audio files at all.** The end-of-countdown chime is
synthesised at runtime by the app's own Web Audio code — two oscillators and an
envelope (`docs/05 §7`) — so there is no audio asset in the build to license,
attribute or account for. TickTune ships **no** third-party audio, images, or
video.
