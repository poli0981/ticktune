# TickTune — Third-Party Notices

Version 2.0 · 2026-10-21 · English canonical; Vietnamese at
`/legal/third-party/`.

TickTune's own code is **GPL-3.0-only** — © 2026 poli0981. Licensing and
attribution questions: **copyright@poli0981.dev**.

## Full attribution

This page is a curated overview. The complete notice — the full licence text,
copyright line and NOTICE file of every package in the shipped bundle,
transitive ones included — is generated at build time and served at
[`/THIRD-PARTY-NOTICES.txt`](/THIRD-PARTY-NOTICES.txt).

## Bundled / vendored components

| Component | License | Notes |
|-----------|---------|-------|
| Astro | MIT | build framework |
| Svelte | MIT | UI runtime |
| @astrojs/svelte | MIT | integration |
| Tailwind CSS | MIT | styling |
| music-metadata | MIT | audio tag parsing |
| Dexie.js | Apache-2.0 | IndexedDB wrapper; its NOTICE is reproduced in the full attribution |
| i18next | MIT | in-app translations |
| DSEG7 Classic (font) | SIL OFL 1.1 | © 2017 keshikan (http://www.keshikan.net), **Reserved Font Name "DSEG"**. v0.46, vendored unmodified; its licence ships as `/fonts/dseg7/OFL.txt` |
| DSEG14 Classic (font) | SIL OFL 1.1 | © 2017 keshikan (http://www.keshikan.net), **Reserved Font Name "DSEG"**. v0.46, vendored unmodified; its licence ships as `/fonts/dseg14/OFL.txt` |
| Chakra Petch (font) | SIL OFL 1.1 | via @fontsource (packaging MIT) |
| Be Vietnam Pro (font) | SIL OFL 1.1 | via @fontsource (packaging MIT) |
| JetBrains Mono (font) | SIL OFL 1.1 | via @fontsource (packaging MIT) |

Development tools — the TypeScript toolchain, linters, test runners, Wrangler,
pnpm and similar — are not distributed with the app and so carry no notice here.

## Services (not bundled)

| Service | Terms |
|---------|-------|
| YouTube embedded player & IFrame Player API | [YouTube Terms of Service](https://www.youtube.com/t/terms); loaded from YouTube only in YouTube mode, never bundled or modified |
| YouTube oEmbed (via our edge endpoint) | Public oEmbed endpoint; only video IDs are forwarded |
| Cloudflare (hosting, CDN, Workers) | Cloudflare service terms |
| Cloudflare Web Analytics | Cloudflare service terms; beacon loaded from `static.cloudflareinsights.com` (see the Privacy Policy) |

## Media

TickTune ships no audio, images or video from anyone else. The end-of-countdown
chime is synthesised at runtime by the app's own Web Audio code.
