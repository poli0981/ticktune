# 16 — Roadmap

Suite 1.0 · 2026-07-21 · Solo-dev pacing alongside OmniDeck/PipDock/poli0981.dev.
Durations are effort estimates, not calendar promises. **v1.0 target: late Q3
2026** (≈ 8 focused weeks from spike start).

| Phase | Scope | Exit criteria |
|-------|-------|---------------|
| **P0 · Spikes** (~1 wk) | S1–S4 (`15-SPIKES.md`) | All four ✅; docs 04/05/06 updated |
| **P1 · Skeleton** (~1 wk) | Scaffold (Astro 7 + Svelte 5 + TW 4 + wrangler), TS7-vs-5.9 check (`11 §4`), mobile gate, legal gate shell, timer engine + countdown display, settings shell + Dexie, log engine, CI stubs live | Countdown runs full formats; gate blocks on mobile viewport; CI green |
| **P2 · Local audio + Single** (~1 wk) | Audio graph, import pipeline (single), metadata modal, bottom bar, loop styles, end behavior default, **+ the S2 late-finish variant of the Finished screen (`04 §2` option 3, decided)** | Single mode E2E passes; fade+chime works with tab hidden; a hidden run past `LATE_THRESHOLD_MS` shows the actual finish time rather than implying "now" |
| **P3 · Playlist** (~1 wk) | Queue panel, drag-reorder, shuffle/repeat, dedupe + limits + summary toasts, context menu, crossfade | Playlist limits tests pass; 95-file batch import OK |
| **P4 · YouTube** (~1 wk) | `/api/yt/oembed` Worker route, player rail, error overlays, YT import pipeline, offline panel | Manual yt-matrix passes; rate-limit path handled |
| **P5 · Visuals & settings** (~1 wk) | Visualizer (3 styles), backgrounds + slideshow, auto-theme, focus mode, full settings, i18n dictionaries complete + key-diff guard | Reduced-motion + a11y milestones announced; perf budget met |
| **P6 · Landing + legal** (~0.5–1 wk) | Landing VI/EN (hero uses **placeholder** capture until core is stable — per spec), legal pages from `legal/*` drafts, **VI translation of legal**, 404, FAQ | Lighthouse ≥ 95 static pages; hreflang correct |
| **P7 · Hardening + launch** (~1 wk) | CSP Report-Only → enforce, a11y pass, perf pass, cross-browser sweep incl. WebKit, live-site smoke checklist, domain + CF checklist (`10 §11`), demo capture replaces placeholder | v1.0.0 tag; notify fan-out |

## P1 exit review — 2026-07-21: **scope complete (8 of 8)**, blocked on S2

### Scope

| # | P1 scope item | State |
|---|---------------|-------|
| 1 | Scaffold (Astro 7 + Svelte 5 + TW 4 + wrangler) | ✅ |
| 2 | TS 7 vs ~5.9 check (`11 §4`) | ✅ pinned `~5.9` on evidence |
| 3 | Mobile gate | ✅ enforced, 10 E2E on Chromium + WebKit |
| 4 | Legal gate shell | ✅ blocks first run, persists, re-shows on version bump — 5 E2E |
| 5 | Timer engine + countdown display | ✅ 59 unit tests, 98.9% line coverage on the core |
| 6 | Settings shell + Dexie | ✅ `TtSettings` + clamping + additive-only upgrade — 22 unit tests |
| 7 | Log engine | ✅ ring buffer 500, level filter, diagnostics payload, global capture — 14 unit tests |
| 8 | CI stubs live | ✅ green on `main` |

### Stated exit criteria — all three pass, and that is the problem

| Criterion | Result |
|-----------|--------|
| Countdown runs full formats | ✅ boundary truth table at 3 600 000 / 3 599 999 / 60 000 / 59 999 / 0, plus 7 E2E |
| Gate blocks on mobile viewport | ✅ overlay shown, **zero** component bundles fetched, content still in the DOM |
| CI green | ✅ |

**These three criteria do not test items 4, 6 or 7 at all.** A phase whose exit
criteria can be fully satisfied while 3 of its 8 deliverables are missing has
under-specified criteria, not a complete phase. This is audit finding *"roadmap
phases do not own several artifacts that earlier phases depend on"*, confirmed in
practice. Amended criteria for P1:

- [x] Legal gate blocks first run, Accept persists across reload, and a
      `TT_LEGAL_VERSION` bump re-shows it
- [x] `TT_DEFAULT_SETTINGS` round-trips through Dexie; a corrupt row falls back
      and logs TT-SYS-204 — and a malformed acceptance fails **closed**
- [x] Log ring buffer wraps at 500; `window.onerror` is captured
- [x] the three original criteria

**Totals: 89 unit tests, 22 E2E, five gates green.** P1's deliverables are done;
the phase is not closed, because S2 still blocks P2 (below).

### Verified beyond the original plan

Mount mechanism decided by measurement (`01 §3`) · CSP verified **enforcing**
against a real edge, not deferred to P7 (`10 §11`) · deployed and reachable ·
corpus guard proven against a forced add · DSEG7 vendored byte-identical.

### 🔴 Blocking P2

**S2 failed, and so did its remedy** (`04 §2`). Hidden + silent: `done` fired
2 m 57 s late. The control run with the keep-alive **ON**: still **52.4 s late**,
105× the bound, again fired by the visibility latch rather than the worker.
Audibility does not protect the timer, and the stall is in main-thread message
processing, so no amount of worker code routes around it.

**Decided 2026-07-21 — option 3, re-scope the promise:** the countdown is
accurate while visible, best-effort while hidden, and the Finished screen states
*when* zero was actually reached when it was late by more than 2 s. Spelled out
in `04 §2` and `03 §3.5`; P2 implements it. Out-of-page notification (option 2)
moves to the post-1.0 backlog — it needs its own spike, a permission prompt and a
privacy review, none of which belongs in P2.

S3 passed. S1 and S4 are partial and gate P4 and P2 respectively.

### Recommended order

1. ~~Finish items 4, 6, 7~~ — done 2026-07-21.
2. ~~Run the S2 control~~ — done 2026-07-21; the remedy failed.
3. ~~Decide the S2 question~~ — decided 2026-07-21, option 3 (`04 §2`).
4. **P2 is unblocked.** It opens with the audio graph and carries the late-finish
   Finished screen with it.

## Post-1.0 backlog (unordered)

- YouTube Data API v3 proxy on the existing Worker (duration/publish date at
  import; key server-side).
- PWA offline for local modes (installable, cache shell; YT mode stays online).
- **Out-of-page finish notification** (S2 option 2): a service worker has its own
  scheduling and could fire a Notification when a backgrounded tab's countdown
  ends. Needs its own spike, a permission prompt, and a privacy review against
  hard invariant 1 — which is why P2 took option 3 instead (`04 §2`).
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
