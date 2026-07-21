# 16 — Roadmap

Suite 1.0 · 2026-07-21 · Solo-dev pacing alongside OmniDeck/PipDock/poli0981.dev.
Durations are effort estimates, not calendar promises. **v1.0 target: late Q3
2026** (≈ 8 focused weeks from spike start).

| Phase | Scope | Exit criteria |
|-------|-------|---------------|
| **P0 · Spikes** (~1 wk) | S1–S4 (`15-SPIKES.md`) | All four ✅; docs 04/05/06 updated |
| **P1 · Skeleton** (~1 wk) | Scaffold (Astro 7 + Svelte 5 + TW 4 + wrangler), TS7-vs-5.9 check (`11 §4`), mobile gate, legal gate shell, timer engine + countdown display, settings shell + Dexie, log engine, CI stubs live | Countdown runs full formats; gate blocks on mobile viewport; CI green |
| **P2 · Local audio + Single** (~1 wk) | Audio graph **incl. the silent keep-alive source (`04 §2`, blocking input from S2)**, import pipeline (single), metadata modal, bottom bar, loop styles, end behavior default | Single mode E2E passes; fade+chime works with tab hidden; **a 30-min hidden+silent run stays inside ±500 ms** |
| **P3 · Playlist** (~1 wk) | Queue panel, drag-reorder, shuffle/repeat, dedupe + limits + summary toasts, context menu, crossfade | Playlist limits tests pass; 95-file batch import OK |
| **P4 · YouTube** (~1 wk) | `/api/yt/oembed` Worker route, player rail, error overlays, YT import pipeline, offline panel | Manual yt-matrix passes; rate-limit path handled |
| **P5 · Visuals & settings** (~1 wk) | Visualizer (3 styles), backgrounds + slideshow, auto-theme, focus mode, full settings, i18n dictionaries complete + key-diff guard | Reduced-motion + a11y milestones announced; perf budget met |
| **P6 · Landing + legal** (~0.5–1 wk) | Landing VI/EN (hero uses **placeholder** capture until core is stable — per spec), legal pages from `legal/*` drafts, **VI translation of legal**, 404, FAQ | Lighthouse ≥ 95 static pages; hreflang correct |
| **P7 · Hardening + launch** (~1 wk) | CSP Report-Only → enforce, a11y pass, perf pass, cross-browser sweep incl. WebKit, live-site smoke checklist, domain + CF checklist (`10 §11`), demo capture replaces placeholder | v1.0.0 tag; notify fan-out |

## Post-1.0 backlog (unordered)

- YouTube Data API v3 proxy on the existing Worker (duration/publish date at
  import; key server-side).
- PWA offline for local modes (installable, cache shell; YT mode stays online).
- Loudness normalization (EBU R128-ish gain scan on local files, opt-in).
- JP language pack (`08 §5`).
- Countdown themes (alternate segment fonts: DSEG14, Nixie-style).
- Zone-plan upgrade decision → branded Cloudflare error pages (`10 §8`).
- SkullMute community preset: shareable settings JSON export/import
  (session-only queue stays non-exportable by design).

## Standing rules

- Placeholder policy (spec): landing may ship with placeholder hero media; every
  placeholder is tracked as an issue labeled `placeholder` and must be cleared
  before v1.0 is announced publicly.
- Any scope addition mid-phase goes to the backlog unless it unblocks the phase's
  exit criteria.
