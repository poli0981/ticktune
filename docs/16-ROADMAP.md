# 16 — Roadmap

Suite 1.0 · 2026-07-21 · Solo-dev pacing alongside OmniDeck/PipDock/poli0981.dev.
Durations are effort estimates, not calendar promises. **v1.0 target: late Q3
2026** (≈ 8 focused weeks from spike start).

| Phase | Scope | Exit criteria |
|-------|-------|---------------|
| **P0 · Spikes** (~1 wk) | S1–S4 (`15-SPIKES.md`) | All four ✅; docs 04/05/06 updated |
| **P1 · Skeleton** (~1 wk) | Scaffold (Astro 7 + Svelte 5 + TW 4 + wrangler), TS7-vs-5.9 check (`11 §4`), mobile gate, legal gate shell, timer engine + countdown display, settings shell + Dexie, log engine, CI stubs live | Countdown runs full formats; gate blocks on mobile viewport; CI green |
| **P2 · Local audio + Single** (~1 wk) | Audio graph, import pipeline (single), metadata modal, bottom bar, loop styles, end behavior default, **+ the S2 late-finish variant of the Finished screen (`04 §2` option 3, decided)** — scope notes below | Single mode E2E passes; fade+chime works with tab hidden; a hidden run past `LATE_THRESHOLD_MS` shows the actual finish time rather than implying "now" |
| **P3 · Playlist** (~1 wk) | Queue panel, drag-reorder, shuffle/repeat, dedupe + limits + summary toasts, context menu, import progress · ~~crossfade~~ (`15 §S4b`, see below) | Playlist limits tests pass; 95-file batch import OK — amended in the scope notes below |
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

## P2 scope notes — set 2026-07-21, before the phase started

Recorded here because P1's exit review found that a phase whose criteria can be
met while deliverables go missing has under-specified criteria. These are
**deferrals, not omissions**, and each is stated in the chapter that owns it.

| Item | Position |
|------|----------|
| **Crossfade loop style** | Not shipped. `15 §S4b` is still open and the toggle renders disabled; a stored `'crossfade'` falls back to `hard` with a notice (`05 §2`) |
| Mode tabs | All three render; Playlist/YouTube disabled, effective mode forced to `single`, `lastMode` untouched (`03 §3`) |
| `endAction` restart/loop | Engine-complete and unit-tested, but with **no UI** until the P5 settings panel. A clamped-valid stored value must still behave (`02 §3.3`) |
| Z5 tally | Static two-state dot; the beat pulse ships with the visualizer in P5 (`03 §1`, `05 §6`) |
| Import progress indicator | Deferred to P3, where a 95-file batch makes it meaningful; Single mode imports one file at a median 11 ms (`02 §4`) |
| i18n | Hardcoded VI; keys filed in `08 §3.1` for P5 (`04 §2` item 5) |
| Motion | Not installed — P2's motion is CSS transitions only (`11 §2`) |
| Pulled in from later phases | Import toasts, Z7 volume/mute, the `beforeunload` guard, countdown `aria-live` milestones — each unblocks a P2 exit criterion or a P2-scope deliverable, per the standing rule below.<br>⚠️ `TtContextMenu` was listed here too and **was never built**: `TtSingleRail` short-circuits `contextmenu` straight to the info modal, so P2 needed no menu. Corrected 2026-07-22; it is P3 scope, green-field |

Also **filed against P6**: `04 §2` item 6 — the landing FAQ must state the
visible-vs-hidden countdown distinction plainly, rather than leaving it in the
EULA. It is the one item of the six the S2 decision demanded that lives outside
the app, and it belongs with the P6 landing copy.

## P2 exit review — 2026-07-21 · **released as v0.2.0 on 2026-07-22**

Tagged `v0.2.0` from a rebase-merged `main` (the repo keeps a strictly linear
history — rebase, never squash). `deploy.yml` ran in 43 s. Verified by fetching
the served bundle rather than by trusting the green tick: `/app/` returns 200,
the CSP is enforcing with the inline-gate hash, and the shipped island contains
strings that exist only in this release.

### What P3 inherits

Worth knowing before starting Playlist, because more of it is already done than
the phase description suggests:

- **The playlist caps are already implemented and unit-tested** — 95 files,
  91:00 total, the TT-IMP-003/004 boundaries, dedupe, and the aggregate check
  all live in `tt-import.ts` and `tt-queue-rules.ts`. P3 is mostly the queue UI
  plus playback order.
- `TT_QUEUE_CAP` already carries all three modes; `isQueueValid` already has the
  playlist branch.
- The A/B deck pair, the URL ledger and the `queueLength + 2` bound were built
  for a queue, not for one track — `TtUrlLedger` is property-tested against
  random add/remove across twelve tracks.
- Still missing for P3, and deliberately: the shuffle order itself (`02 §5`
  Fisher-Yates, reshuffle on wrap), the queue mutation rules during playback
  (an open audit finding), the import progress indicator, and the crossfade
  between tracks — which `15 §S4b` gates exactly as it gates the Single-mode
  loop style.

Written to the standard P1's own review demanded: **each criterion names the
artifact that satisfies it**, because a phase whose criteria can be met while
deliverables go missing has under-specified criteria.

| Criterion | Satisfied by | Result |
|-----------|--------------|--------|
| Single mode E2E passes | `tests/e2e/single-mode.spec.ts` + `import-single.spec.ts` | ✅ asserts `dataset.ttAudio === 'running'` **and** peak Analyser RMS > 0 — without both, the flow passes identically on a silently-suspended context |
| fade + chime work with the tab hidden | `tests/e2e/end-behavior.spec.ts` "fade and chime survive a hidden run" | ✅ with the caveat below |
| a hidden run past `LATE_THRESHOLD_MS` shows the actual finish time | `tests/e2e/finished-late.spec.ts` (both branches) + `tests/component/TtFinished.test.ts` + `tests/unit/tt-late.test.ts` | ✅ |

**Read criterion 2 precisely, or a future reader will re-litigate it as a bug.**
It is satisfied in the sense `04 §2` left available: the fade and chime are
committed to the audio clock in one synchronous block at `done`, so they execute
correctly whenever `done` fires and need no further main-thread frame. They can
still fire **minutes late** on a hidden, throttled tab. That is the re-scoped
promise, not a defect — and it is exactly why criterion 3 exists.

The E2E fronts a second page so `document.hidden` is genuinely true, but it
cannot reproduce Chromium's *intensive* throttling: Playwright launches with
`--disable-renderer-backgrounding`, and the stall needs ~5 minutes of real
backgrounding. The minutes-late case stays the manual `13 §7` item.

### Scope delivered

Audio graph (`05 §1`, split master stage) · import pipeline with the `02 §4`
step-0 pre-scan · metadata modal (`02 §8`) · bottom bar (`03 §2` Z7, now also
owning Stop) · hard loop + loop counter · End Behavior incl. `endFlash` and all
three `endAction` values · the late-finish Finished screen · the `02 §1` state
machine incl. `playing ⇄ paused`, Stop and Restart.

**228 unit + component tests, 42 E2E** across chromium and the two mobile
projects, five gates green. Engine coverage 95.8 % statements / 87.6 % branches.

### Found after the review, by using it

**Cover art was never extracted.** `TtTrack.coverArtUrl` was declared, the
`02 §8` modal read it, and the URL ledger had a `cover` slot — but nothing
between `parseBlob` and the track ever wrote it, so every file reported "no
cover" however much art it carried. The `N/A` was honest and the feature was
absent, which is the combination no test catches: the fallback rule worked
perfectly.

Why the suite missed it: the only fixture with embedded art is the ~5 MB one,
and it lives in the git-ignored tree because of the 2 MB corpus-guard limit — so
the cover path had no fixture any test could use. Fixed by generating a small
committed `with-cover.mp3` alongside it, which is now asserted end to end.

### Not delivered, and why

**The crossfade loop style** — `15 §S4b` is open, and P2 shipped `hard` with the
toggle disabled (`05 §2`). Everything else in the P2 scope notes above is a
stated deferral with an owner phase.

### What the phase changed in the docs

Three audit findings closed and one partly resolved; `15 §S4` split into S4a/S4b;
`03 §2` gained the Z7 Stop control and the position format; `03 §6` finally
defines `endFlash`; `05 §1` records why the master stage is two nodes. Three
behaviours were established by measurement rather than assumption — `page.clock`
moves both clocks in step, the component-test tier needed
`resolve.conditions: ['browser']` to work at all, and a truncated MP3 does not
fail to decode (a garbled one does).

## P3 scope notes — set 2026-07-22, before the phase started

Written before any P3 code, for the reason P1's exit review established: a phase
whose criteria can be satisfied while deliverables go missing has under-specified
criteria, not a complete phase. These are **deferrals with owners**, not
omissions.

### The phase ships in two slices

Slice 1 is "a playlist that plays": the `02 §5.1` spec decision, a dynamic mode,
the pure play-order engine, `ended`-driven advance, a readable queue panel, and
⏮/⏭. Slice 2 is the manipulation layer: drag-reorder, `TtContextMenu`, the import
progress indicator, and the 95-file batch E2E. Slice 1 is independently testable
on the live site, which is the whole reason for the split.

| Item | Position |
|------|----------|
| **Inter-track crossfade** | **Not shipped, and not startable.** `15 §S4b` gates "the crossfade loop style **and P3's inter-track crossfade**" and is still open — and its harness cannot produce a valid number until the fixes in `15 §S4` land. P3 advances on the media element's `ended` event, which is a different mechanism from S4b's scheduled pre-trigger and is therefore **not** gated. The roadmap row above listed crossfade in P3 scope until 2026-07-22; `15`, `05 §2` and CLAUDE.md always agreed it could not be, so the row was the outlier |
| Drag-reorder + `TtContextMenu` + import progress | Slice 2. `02 §5.1` and `02 §8` define their behaviour first so the implementation cannot become the spec by default |
| 95-file batch E2E | Slice 2, and it needs work the helper does not do today: `tests/e2e/_helpers.ts` base64-inlines every fixture byte across CDP, and 95 copies of one fixture share a dedupe key (`name::size::duration`), so that test would measure **dedupe**, not capacity. It needs N distinct files synthesised in-page |
| TT-IMP-003 (91:00) from E2E | Deferred: the only long fixture, `over-limit-11min.mp3`, exists to be rejected by TT-IMP-002. Reaching the aggregate cap needs a ~10:00 *legal* fixture that does not exist. The boundary keeps its exact-value unit coverage meanwhile |
| i18n | Still hardcoded VI, as in P2. There are no dictionaries and no key-diff guard yet — `13 §1` puts both in P5, and introducing a catalogue for one panel is the worst of both |
| Keyboard reorder | `Alt+↑/↓`, specified in `03 §7` and mirrored as context-menu items in `02 §8`, so slice 2 and `13 §6`'s keyboard-only journey have a fixed target |

### Amended exit criteria

The stated pair ("Playlist limits tests pass; 95-file batch import OK") repeats
P1's mistake: **both were already satisfiable before P3 began.** The limits live
in `tt-import.ts`/`tt-queue-rules.ts` and were unit-tested in P2, and neither
criterion mentions playback order, the cursor, advance, or the queue panel — the
things P3 actually builds. Each criterion below names the artifact that satisfies
it:

- [ ] Three tracks play **in sequence** — asserted by peak Analyser RMS > 0 after
      an advance, not by absence of an error (`tests/e2e/playlist.spec.ts`)
- [ ] Shuffle produces a full permutation with no lost or repeated track, and the
      wrap obeys `02 §5.1` rule 4 (`tests/unit/tt-play-order.test.ts`)
- [ ] Toggling Shuffle mid-run keeps the current track current, and removing the
      playing track advances rather than stopping (store tests)
- [ ] Repeat OFF at exhaustion logs TT-PLY-102, stops media, and **leaves the
      countdown running** (`02 §5.1` rule 6)
- [ ] `allowDuplicates` reaches the importer from settings — a store-level test,
      because the engine has always been correct and the call site has always
      passed a literal `false`
- [ ] Playlist limits tests pass; 95-file batch import OK *(slice 2)*

## P3 slice 1 review — 2026-07-22 · **released as v0.3.0**

Tagged `v0.3.0` from a rebase-merged `main` (strictly linear history — rebase,
never squash), **signed**, and verified by fetching the served bundle rather
than by trusting the green tick: `/app/` returns 200, the CSP is enforcing with
the inline-gate hash, HSTS is present, and the shipped island contains
`DANH SÁCH`, `Đã hết danh sách` and `data-tt-variant` — the last of which exists
only because of the overflow fix, so the deployed build demonstrably includes
the final commit rather than merely a build of the tag's ancestry.

Two things the release itself exposed, both recorded in `14 §5` rather than
patched over: **v0.2.0 was never signed** despite `tag.gpgsign = true` (so the
config proves nothing and `git tag -v` is the only evidence), and **no GitHub
Release or fan-out exists** — `deploy.yml` builds and deploys, full stop, and
`notify.yml` has never existed. A deploy that works looks identical either way.

Not a phase exit: slice 2 (drag-reorder, `TtContextMenu`, import progress, the
95-file E2E) is still open. What is done is everything needed to run a queue,
which is the point at which it can be tested by using it.

| Criterion | Satisfied by | Result |
|-----------|--------------|--------|
| Three tracks play in sequence | `tests/e2e/playlist.spec.ts` | ✅ peak Analyser RMS > 0 **both before and after** the advance — an advance that moved the highlight while loading a dead deck passes on the highlight alone |
| Shuffle is a full permutation; the wrap obeys rule 4 | `tests/unit/tt-play-order.test.ts` | ✅ 27 cases, incl. the length-1 and length-2 boundaries where the swap rule can and cannot act |
| Shuffle mid-run keeps the current track; removing it advances | `tests/unit/session-queue.test.ts` | ✅ |
| Repeat OFF logs TT-PLY-102, stops media, **leaves the countdown running** | store test + E2E | ✅ |
| `allowDuplicates` reaches the importer from settings | store test | ✅ — and verified by mutation, see below |
| Playlist limits; 95-file batch | — | ⬜ slice 2 |

**295 unit + component, 53 E2E** on the projects this box can launch. Engine
coverage 95.0 % statements / 87.8 % branches.

### What the slice actually changed

`02 §5.1` was written **before** any UI, which is the whole reason the awkward
cases have answers: with the cursor naming a track id rather than an index,
"does a drag remap the shuffle cycle" and "does the now-playing track survive a
reorder" stop being questions. Shuffle-off stores no permutation at all.

Three things were declared and never written, all found by grepping for the
**write** rather than the read:

- `allowDuplicates` was a literal `false` at the only call site, while the
  setting was declared, defaulted, clamped, persisted and correctly honoured by
  the engine. A P5 toggle would have shipped doing nothing and passed every test.
- `singleLoopStyle` was read by nobody; `05 §2`'s promise of a fallback "with a
  notice rather than silently" described behaviour no code implemented.
- `TtTrack.objectUrl` had never held a value. Deleted.

Plus one latent inconsistency P3 made reachable: the count cap filtered
`isPlayable` while the 91:00 aggregate beside it did not, so an errored track
freed a slot while still spending its duration. Unreachable in Single mode.

### The discipline worth repeating

**Store tests were checked by mutation.** Restoring the `allowDuplicates`
literal fails exactly one test; moving the queue filter ahead of the advance in
`removeTrack` fails exactly one other. Without that check this tier would have
been decoration — and decoration is precisely what let two bugs reach the live
site through 233 passing tests.

**Four Firefox skips were written and then removed.** They asserted a highlight,
a disabled control and a bar title — no Analyser — so "no audio output device"
was a false reason. `13 §3` now says skip per assertion, not per file.

### Known-absent, and stated as such

`tests/manual/p3-live-checklist.md` carries a **"known-absent — do not report"**
table, so a live pass does not spend the reviewer's attention on drag-reorder,
the context menu, the progress bar or crossfade. That table is the P2 lesson
applied: the reviewer's time is the scarce resource, and an unfiltered checklist
spends it on absences that were deliberate.

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
