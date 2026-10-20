# TickTune

> A full-screen countdown with your own music — a desktop web app.
> **Live at [ticktune.net](https://ticktune.net)** · GPL-3.0-only · Vietnamese, English and Japanese

[![CI](https://github.com/poli0981/ticktune/actions/workflows/ci.yml/badge.svg)](https://github.com/poli0981/ticktune/actions/workflows/ci.yml)
[![E2E](https://github.com/poli0981/ticktune/actions/workflows/e2e.yml/badge.svg)](https://github.com/poli0981/ticktune/actions/workflows/e2e.yml)

Set a countdown, bring your own music — local files or YouTube links — and get a
big seven-segment clock behind smoked glass, styled like a piece of broadcast
studio hardware. When it reaches zero, a configurable End Behavior fires.

Your files never leave your browser.

## Features

- **Three sources.** *Single* (one local file, looped), *Playlist* (up to 95
  local files, reorderable by drag or `Alt+↑/↓`, shuffle and repeat) and
  *YouTube* (up to 50 links, played through YouTube's own embedded player,
  with each link's length looked up so "Match queue length" works there too).
- **Crossfade**: local tracks fade into each other over 0–5 s (2 s by default,
  0 for a straight cut), and a single track can loop by fading into itself.
  Skips and pauses ramp rather than cut, so they no longer click.
- **A countdown that is derived, never accumulated** — `endAt − now` on every
  tick, so it does not drift. Below 60 s it shows milliseconds.
- **End Behavior**: fade-out, a synthesised chime, a screen flash, then stay,
  restart or loop. The countdown is exact while the tab is visible; in a
  background tab the elapsed time stays exact but the browser may hold the app
  back until you return — and the Finished screen then says when zero was
  actually reached rather than implying "now" (`docs/04 §2`).
- **Visuals**: solid, gradient, picture, slideshow or cover-art backgrounds with
  an adaptive scrim that solves for 4.5:1 contrast behind the digits; a bars / wave /
  ring visualizer; an ON AIR tally lamp that pulses to the beat; Focus mode.
- **Two looks, two faces**: the dark "LED" rack or a light "LCD" panel for
  daytime projection, and a 7- or 14-segment clock.
- **Away from the tab**: opt in, and the countdown's own worker shows a system
  notification at zero while the tab is in the background — generic text,
  never a track name, nothing sent anywhere.
- **Installable, and it starts offline**: `/app/` installs as an app, and once
  visited it opens without a network; local files play as ever (YouTube needs
  one).
- **Settings as a file**: export them, import them on another machine.
- **Keyboard first**: `Space` play/pause, `←/→` tracks, `↑/↓` volume, `M` mute,
  `F` fullscreen, `H` Focus, `S` settings — the full table is in the app.
- **Accessible**: screen-reader milestones at 10 / 5 / 1 min, 10 s and zero;
  every control reachable by keyboard; reduced motion respected.

**Desktop only, by design.** Phones and tablets get a notice instead of the app
(`docs/07`) — the experience is a large clock on a large screen.

## Limits

| Mode | Items | Per track | Total | Countdown |
|------|-------|-----------|-------|-----------|
| Single | 1 local file | ≤ 10:02 | — | 1 s – 24 h |
| Playlist | ≤ 95 local files | ≤ 10:02 | ≤ 91:00 | 1 s – 24 h |
| YouTube | ≤ 50 links | — | — | 1 s – 24 h |

Missing metadata shows as `N/A` (text) or `–` (numbers), never as a blank.

## Privacy

- **Your files stay in your browser.** They are held in memory for the session
  and never uploaded — there is no upload endpoint. Only your settings persist,
  locally, in IndexedDB.
- **One analytics beacon**: Cloudflare Web Analytics counts page views without
  cookies and shows only aggregates. It is disclosed in the
  [Privacy Policy](https://ticktune.net/en/legal/privacy/) and on the consent
  screen, and it never sees your files.
- **YouTube mode** loads YouTube's player from `youtube-nocookie.com`; link
  titles and lengths are looked up through this site's own `/api/yt/oembed`
  and `/api/yt/durations` routes, which forward only the video IDs — from the
  server, with its own key — and cache each answer for a day.
- **A finish notification** is created by the tab itself: no push service, no
  subscription, nothing leaves the machine.
- **The offline copy** holds the app's own files only — never yours.

## Development

Requirements: **Node 24 LTS** and **pnpm 11** (`corepack enable`).

```bash
pnpm install
pnpm dev          # astro dev → http://localhost:4321
pnpm build        # astro build + CSP hash + third-party notices + size budget
pnpm lint         # eslint + prettier --check
pnpm check        # astro check + svelte-check + worker tsc
pnpm knip         # unused files, exports and dependencies
pnpm test         # Vitest: unit + component + worker, with coverage
pnpm test:e2e     # Playwright: Chromium, Firefox, WebKit + the mobile gate
pnpm verify:csp   # the real CSP in a browser, under wrangler dev
pnpm lhci         # Lighthouse CI on the built static pages
pnpm test:visual:docker   # screenshots, in the pinned Playwright image (--update to rewrite)
pnpm perf:render  # the countdown's frame cost, headed (TT_PERF_SOFTWARE=1: no GPU)
```

`pnpm fixtures` regenerates the audio fixtures, `pnpm demo` re-records the
landing page's hero video, and `node scripts/make-brand-assets.mjs` rasterises
the favicon and the social card. The `test/` folder is a local-only audio corpus
for the audio spikes; it is git-ignored and guarded out of every commit.

### How it is built

Astro 7 static pages, plus **one Svelte 5 island** at `/app/`, mounted by hand
behind the mobile gate rather than with a client directive (`docs/01 §3`). The
engines — timer, audio, import, queue, YouTube — are pure TypeScript under
`src/app/engine/`; state lives in Svelte 5 runes stores. It is served by
Cloudflare Workers Static Assets with exactly one Worker route,
`GET /api/yt/oembed`.

### Releases

Production changes only when a **signed `vX.Y.Z` tag** is pushed: `deploy.yml`
verifies the signature and that the tag is on `main`, runs the gates, deploys,
and publishes the GitHub Release. Every other push only uploads a preview
version (`docs/14`).

## Documentation

The `docs/` suite is authoritative; `CLAUDE.md` is its condensed contract.

| Chapter | Contents |
|---------|----------|
| `01-ARCHITECTURE` | System shape, module map, the island mount |
| `02-DATA-FLOW` | State machine, track model, import pipeline, settings schema |
| `03-UI-SPEC` | The "Rack Unit" design system, layout zones, ToS carve-out |
| `04-TIMER-ENGINE` | Derived time, the worker tick, the background-tab promise |
| `05-AUDIO-ENGINE` | Web Audio graph, End Behavior, visualizer |
| `06-YOUTUBE-INTEGRATION` | IFrame Player, ToS constraints, error causes, oEmbed |
| `07-MOBILE-GATE` | The site-wide desktop gate |
| `08-I18N` | VI/EN for the static pages and the app |
| `09-SECURITY` | Threat model, headers, CSP |
| `10-CLOUDFLARE-SETUP` | Zone, Worker and dashboard configuration |
| `11-DEPENDENCIES` | Versions, licences, the notices rule |
| `12-CODE-STANDARDS` | Conventions and the log-code registry |
| `13-TESTING` | Test tiers and the live-site checklists |
| `14-CI-CD` | Workflows, permissions, the release path |
| `15-SPIKES` | The validation spikes and their results |
| `16-ROADMAP` | Phases, exit reviews, what is next |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first — especially the hard invariants in
`CLAUDE.md`, which no change may break.

## Security

Please report vulnerabilities privately: **security@poli0981.dev**, or GitHub's
[private vulnerability reporting](https://github.com/poli0981/ticktune/security/advisories/new).
Details in [SECURITY.md](.github/SECURITY.md).

## Contact

| For | Address |
|-----|---------|
| Press | press@poli0981.dev |
| Collaboration | collab@poli0981.dev |
| Privacy | privacy@poli0981.dev |
| Terms and legal | legal@poli0981.dev |
| Licensing and attribution | copyright@poli0981.dev |

## License

Copyright © 2026 poli0981.

TickTune is free software: you can redistribute it and/or modify it under the
terms of the **GNU General Public License, version 3 only**, as published by the
Free Software Foundation. It is distributed in the hope that it will be useful,
but **without any warranty**; without even the implied warranty of
merchantability or fitness for a particular purpose. See [LICENSE](LICENSE).

Bundled fonts are under the SIL Open Font License 1.1; every third-party
component is listed in
[Third-Party Notices](https://ticktune.net/en/legal/third-party/), and the full
licence texts ship at `/THIRD-PARTY-NOTICES.txt`.
