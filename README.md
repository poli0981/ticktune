# TickTune — Documentation Suite

> A desktop-only web app that plays your own music behind a large digital countdown.
> 100% client-side playback · session-only · GPL-3.0 · Cloudflare Workers Static Assets

- **Repo:** `poli0981/ticktune`
- **Domain (planned):** `ticktune.net` — ⚠️ availability not yet checked; fallbacks `ticktune.app`, `ticktune.dev`. All docs use `ticktune.net` as placeholder.
- **Component prefix:** `Tt*`
- **License:** GPL-3.0-only (code). No bundled media.
- **Suite version:** 1.0 — 2026-07-21
- **Status:** Pre-implementation. P0 spikes (see `docs/15-SPIKES.md`) must pass before feature work.

---

## What TickTune is

The user sets a countdown, supplies music (local files or YouTube links), and gets a
full-screen "On Air" style display: a large seven-segment digital countdown in the
center, ambient background layers (color / gradient / image / slideshow / cover art),
a beat-reactive visualizer (local modes only), and minimal track info at the bottom.
When the countdown reaches zero, a configurable end behavior fires (fade + chime by
default).

Nothing the user provides ever leaves their machine. Local audio files are held in
memory for the session only. The only network media path is the official embedded
YouTube player.

## Locked decisions (2026-07-21)

| # | Decision | Choice |
|---|----------|--------|
| D1 | YouTube mode | **Kept.** Official IFrame Player API, player visibly rendered in the right rail (384×216, ToS ≥200×200). No audio extraction, ever. |
| D2 | Mobile strategy | **Blocked site-wide.** Inline gate in `<head>`; landing HTML stays in DOM under the block overlay (SEO mitigation); heavy bundles never load on mobile. |
| D3 | Persistence | **Session-only** for playlist + files. Settings persist locally. Consequence: no File System Access API → full Firefox/Safari support. |
| D4 | Countdown end | Configurable **End Behavior** setting. Default: fade-out (2 s) + soft chime + "Time's up" screen. |
| D5 | Name | **TickTune**, prefix `Tt`, slug `poli0981/ticktune`. |
| D6 | Hosting | Cloudflare Workers Static Assets + one edge route `GET /api/yt/oembed` (YouTube oEmbed has no CORS; see `docs/06`). |
| D7 | Animation lib | **Motion (MIT)**, not GSAP — GSAP's license is not FOSS and conflicts with GPL-3.0 distribution. |

## Hard limits

| Mode | Items | Per track | Total duration | Countdown |
|------|-------|-----------|----------------|-----------|
| Single | 1 local file | ≤ 10:02 (10 min + 2 s tolerance) | — | 1 s – 24 h |
| Playlist *(first-run default)* | ≤ 95 local files | ≤ 10:02 | ≤ 91:00 (1 h 30 + 1 min tolerance) | 1 s – 24 h |
| YouTube | ≤ 50 links | unlimited | unlimited | 1 s – 24 h |

Countdown < 60 s → milliseconds are shown. Missing metadata → text fields `N/A`,
numeric fields `–`.

## Stack (versions verified live 2026-07-21 — see `docs/11-DEPENDENCIES.md`)

Astro 7.1 (static, Rolldown toolchain already validated in the SoftHarbor spike) ·
Svelte 5.56 island for `/app/` · Tailwind CSS 4.3 · Motion 12 · Web Audio API ·
music-metadata 11 · Dexie 4 · i18next 26 · DSEG7 Classic + Be Vietnam Pro +
JetBrains Mono (self-hosted) · pnpm 11 · Node 24 LTS · Wrangler 4 on Cloudflare
Workers Static Assets.

## Reading order

| File | Contents |
|------|----------|
| `docs/01-ARCHITECTURE.md` | System shape, module map, directory tree, non-goals |
| `docs/02-DATA-FLOW.md` | State machine, track model, import pipeline, dedupe, removal/error paths, log schema |
| `docs/03-UI-SPEC.md` | "On Air" design system, layout zones, per-mode right rail, settings, hotkeys, a11y |
| `docs/04-TIMER-ENGINE.md` | Timestamp-based countdown, worker tick, Wake Lock, ms display |
| `docs/05-AUDIO-ENGINE.md` | Web Audio graph, crossfade, metadata extraction, visualizer |
| `docs/06-YOUTUBE-INTEGRATION.md` | IFrame API, ToS constraints, error matrix, oEmbed proxy |
| `docs/07-MOBILE-GATE.md` | Site-wide block, criteria const, SEO mitigation |
| `docs/08-I18N.md` | EN/VI strategy — static landing routes + runtime app dictionary |
| `docs/09-SECURITY.md` | Threat model, full header set, CSP |
| `docs/10-CLOUDFLARE-SETUP.md` | Step-by-step zone + Worker configuration |
| `docs/11-DEPENDENCIES.md` | Pinned versions, LTS notes, CVE process |
| `docs/12-CODE-STANDARDS.md` | Naming, structure, lint/knip gates, log-code registry |
| `docs/13-TESTING.md` | Unit/component/E2E strategy, live-site smoke checklist |
| `docs/14-CI-CD.md` | Caller stubs → `poli0981/.github` reusable workflows, permissions matrix |
| `docs/15-SPIKES.md` | 4 P0 validation spikes with acceptance criteria |
| `docs/16-ROADMAP.md` | Phases P0–P7, v1.0 target late Q3 2026 |
| `legal/*` | EULA, Disclaimer, Privacy Policy, Third-Party Notices (gate content) |
| `CLAUDE.md` | AI-assistant instruction file (repo convention) |
| `CONTRIBUTING.md` + `.github/ISSUE_TEMPLATE/bug_report.yml` | Contribution rules, bug template with mandatory console-error field |

## Open action items

1. Check + purchase domain (`ticktune.net` → fallbacks above).
2. Run spikes S1–S4 (`docs/15-SPIKES.md`) before any feature code.
3. Confirm exact reusable-workflow filenames against the `poli0981/.github` catalog (`docs/14-CI-CD.md`).
4. Verify TypeScript 7 (native) compatibility with svelte-check/typescript-eslint at scaffold time; fallback pin `typescript@~5.9` (`docs/11`).
