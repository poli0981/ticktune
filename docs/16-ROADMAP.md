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
| **P5 · Visuals & settings** (~1 wk) | Visualizer (3 styles), backgrounds + slideshow, auto-theme, focus mode, full settings, i18n dictionaries complete + key-diff guard | Reduced-motion + a11y milestones announced. **Perf budget is P7's** — decided 2026-07-24, see below |
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

## P3 slice 2 review — 2026-07-22 · **released as v0.4.0**, and the phase closes

Tagged `v0.4.0` from a rebase-merged `main`, **signed** (`git tag -v` prints
`Good signature` — the only evidence that counts, since `tag.gpgsign = true` was
already set when v0.2.0 was created unsigned). Verified by fetching the served
bundle rather than by trusting the green tick: `/app/` returns 200, CSP and HSTS
are present, the island's content hash changed, and it contains `Chuyển lên`,
`Chuyển xuống`, `Kéo để đổi thứ tự`, `tt-queue-grip` and `Đang nhập` — strings
that exist only because of this slice.

⚠️ **Shipped before the live checklist was run**, at the user's direction. The
⬆ slice-2 block in `tests/manual/p3-live-checklist.md` is still outstanding;
recorded here so a later reader does not mistake "released" for "exercised by a
human". Slice 1 shipped the other way round and that is the safer order.

Still no GitHub Release — see `14 §5`, the gap this project has now carried
across three tags.

| Criterion | Satisfied by | Result |
|-----------|--------------|--------|
| Playlist limits tests pass | `tests/unit/tt-import.test.ts` boundaries + the toast codes in `tests/e2e/playlist.spec.ts` | ✅ |
| 95-file batch import OK | `playlist.spec.ts` "imports a 95-file batch and refuses the 96th" | ✅ and the 96th trips TT-IMP-004 rather than vanishing |
| Drag-reorder | `TtQueuePanel` pointer drag + `playlist.spec.ts` | ✅ verified by mutation — deleting the `pointermove` handler fails the spec |
| `TtContextMenu` | `TtContextMenu.svelte`, `02 §8`'s four items | ✅ incl. `Esc` closing without acting, and the end-of-list move disabled |
| Import progress indicator | `session.progress` + `TtSetup` | ✅ **and it stays away from fast imports** — both sides of the threshold tested |

**311 unit + component, 58 E2E** on the projects this box can launch, five gates
green.

### What was decided rather than defaulted

**Reorder is pointer-driven, not HTML5 drag-and-drop.** `_helpers.ts` had
already recorded that Playwright cannot synthesise a native drag — that is why
file import uses a synthetic `DragEvent`. Building rows on `draggable` would
have left `13 §2`'s reorder test and `13 §6`'s keyboard journey unassertable, so
the feature would have shipped covered by a screenshot. The component test now
asserts that no row carries `draggable`, which pins the decision rather than
trusting it.

**The progress indicator kept the reason it was deferred for.** P2's note —
"Single mode imports one file at a median 11 ms; a spinner would flash" — was
treated as a requirement, not as scheduling: the bar is gated behind a delay, so
a one-file import renders nothing. A version without the gate would have passed
any test that only checked the bar eventually appears, which is why both sides
of the threshold have one.

### Still not shipped, and still for the same reason

**Crossfade.** `15 §S4b` gates the loop style *and* P3's inter-track crossfade,
and its harness cannot produce a valid number until the `15 §S4` fixes land.
Nothing in this slice changes that. P3 closes with a hard cut between tracks,
which is correct until the number exists.

## P4 — YouTube · **CLOSED**, three slices · v0.5.0 → v0.5.2

**Exit criterion met 2026-07-23**: `tests/manual/p4-live-checklist.md` was run
against the deployed site, on Chrome and Firefox, including the `yt-matrix`
block and the region-blocked id from a Vietnamese connection — the one row
nobody else could run.

Written across the phase rather than at the end, because a phase this long should
not be reconstructed from commit messages later. Slices 1 and 2 were recorded
while `main` still carried them unreleased; slice 3 is what closing the phase
actually took.

### Shipped to `main`

| Slice | What |
|-------|------|
| **1 — links become a queue** | The Worker names the failure **cause** (401 no longer rewritten to 404); a new **`tests/worker/**` tier**, because nothing else could reach that file; a pure URL parser for `06 §5`'s six shapes; a pure import pipeline over an injected `lookup` port; the YouTube tab, the paste box, and mode isolation |
| **2 — the player** | The state machine behind an **injected constructor**; `TtYouTubeRail` as a third rail at a fixed 384 px; the `03 §2` carve-out in markup; typed overlays; transport, volume and the countdown end; offline specified (`06 §8`) and built |

**451 unit + component + worker tests, 58 E2E, five gates green.**

### Decisions this phase settled

- **Sources do not mix.** A queue is all-local or all-links, decided by the mode
  (`06 §5`). The caps differ, the 91:00 aggregate is meaningless against
  durations the player has not backfilled, and playback would otherwise hand the
  cursor between a media element and a cross-origin iframe *while `06 §1.2`
  requires the player visible throughout*.
- **A status is only a cause if our own endpoint produced it.** Found by using
  the app: `astro preview` does not run the Worker, so `/api/yt/oembed` hit the
  static 404 page and three known-good videos were reported as deleted.
  `content-type: application/json` is what earns a status the right to be read.
- **`onError` is not a classifier** (spike S1). Cause lives in the oEmbed status,
  at import — which is a better place to tell someone anyway.

### Slice 3 — the phase's real work, 2026-07-23

The five items above were the plan. What the slice actually found, on its first
hour, was that **YouTube playback did not work at all** — and that every other
owed item shared one cause with it.

The first Start cued nothing. `onStart` is synchronous, because `05 §1`'s
gesture chain requires it; the rail only renders once the state IS `playing` and
hands its element over from an `$effect` that Svelte flushes afterwards. So
`yt.load()` ran against a null player and went nowhere — and since `loadApi()`
only runs inside `TtYtPlayer.load()`, **the IFrame API script was never even
requested**. Measured on `astro dev`: no iframe, `window.YT` undefined, no
network call to Google. Pressing ⏭ recovered it, which is why nothing looked
obviously broken from the outside.

Four wiring defects in total, none of which any test could reach:

| | What |
|---|---|
| First Start | the store now holds a pre-mount `load` the way `TtYtPlayer` already held a `#pendingId`, and `attach` flushes it |
| Stop → Start | `attach` guarded on the store's LIFETIME, not the element, so after a remount the player stayed bound to a destroyed node and the second run was a black 384×216 box. Guarded per element now, and disposed on every exit from `playing`/`paused` |
| ⏭ past the end, Stop, Về thiết lập | all three called `playback.stop()` with no mode branch, stopping an audio graph nothing is routed through while the video played on |
| The whole End Behavior | dead in YouTube mode for every visit after the first. `runEndBehavior()` returns null when the audio driver was never built, and the legal gate — which does not render for a returning user — was the only other unlock site. No chime, no flash, no `endAction` |

**The pattern is now precise enough to state.** Nine times this project has
shipped a feature that was declared, rendered, and never written. Every one of
those was a *value*. These four are the next layer: the values are all correct,
the engines are all correct, and the defect is the **wiring between them** —
which no engine test can see by construction, and which the E2E tier did not
exist to see either.

### What closed

| Item | How |
|------|-----|
| **E2E for YouTube** | 26 specs. `page.route` over `iframe_api` serves a stub player — preferred over `addInitScript`, because routing exercises the real `loadApi()` and proves the app requests that URL and no other — and `page.route` over `/api/yt/oembed`, which is not optional since `astro preview` runs no Worker. Reverting the four fixes above turns 15 of them red |
| **`pending` re-check** | The shape `06 §8` said nobody had designed: it is **not part of Start**. `start()` returns, the gesture is already spent on `playVideo()`, and the shell then calls `recheckPending()` unawaited. Answers patch the queue as they land, which is safe only because P3 made the cursor a track id |
| **`getVideoData()` backfill** | Along with the duration half, which turned out never to have reached the track either — `yt.tick()` wrote a store field the bottom bar reads, and `TtTrack.durationMs` stayed null forever, so the info modal, the queue rows and the totals footer all read `–`. The missing piece was a track writer: `markTrackError` was the session's only one and it wrote nothing but `status` |
| **Bot Fight Mode** | Already handled — the content-type guard from slice 2 sends any non-JSON response to `upstream_unreachable`. The claim above was stale. What was NOT handled: an upstream **5xx** rejected every pasted link permanently and the edge cached that for 15 minutes, and an unparseable **200** blamed the video's owner |
| Manual `yt-matrix` re-run | `tests/manual/p4-live-checklist.md`, retargeted at `/app/`. The matrix's own procedure drives the S1 spike harness and would not have exercised P4 at all |

Also closed, and each one a promise the code was already making:

- The **nocookie host** was asserted nowhere, while two source comments claimed
  a test and an E2E existed for it. Both now exist; the comments say what is true.
- `13 §1` excludes `*-driver.ts` from the coverage gate *because* "they are
  covered where they actually run: Playwright" — unkept for both YouTube drivers
  until this slice.
- The component test's ToS floor read `YT_HEIGHT >= 200 * (9/16)`. The floor is
  **square**; that assertion passes at 200×113, proven by setting the height to
  150 and watching the file stay green.
- The **countdown-to-skip** `06 §4` lists among the error card's five parts, and
  `TtYtOverlayState.ambiguous`, `yt.playing` and `playback.status` — all written
  on every change, all read by nothing.
- `06 §3` claimed a client throttle "to 4 concurrent oEmbed checks" that has
  never existed. The importer is strictly sequential, which is stricter than the
  doc promised, so the doc changed.

Every new assertion was mutation-checked — the bug it names re-introduced, the
test confirmed red — because on this project a test that cannot fail is the
thing being guarded against.

### The live run, and the two patch releases it cost

The checklist passed on **v0.5.0** except one line: *"turn your network off — the
offline banner appears and Start is blocked"*. It did not.

The banner was never broken. Forcing `navigator.onLine` to `false` on the live
site raised it correctly and `online` cleared it. **The hint simply never
flipped** — Chrome reports `onLine` from whether a network interface is up, not
from whether anything is reachable. The corroboration was on the same checklist:
the very next line passed, which means links *had* failed to import while the
hint said connected.

`06 §8` had already written the answer — *"`navigator.onLine` is a hint and is
used as one; **the import result is the authority**"* — and only the hint was
ever implemented. The same prose-only shape as everything else this phase.

**v0.5.1** made `reachedEdge()` that authority. Its third state is the one worth
naming: a batch that never touched the network (all malformed, all duplicates,
all over-cap) proves **nothing**, which is not the same as offline — collapsing
those two would raise the banner on a good connection.

**v0.5.2** fixed what v0.5.1 broke. The banner blocks Start, and the re-check
that clears it runs *after* Start — so on the very machine v0.5.1 was written
for, the evidence could only be gathered by the one action the banner forbade.
Found by testing the deploy, not by reading the diff. `§8` rejects a poll, so the
user says when to try: the banner carries **Thử lại** whenever something is
pending to re-check.

⚠️ **The rule that earns:** when an action is gated on evidence, ask what
gathers that evidence — and whether the gate forbids it.

**511 unit + component + worker tests, 79 E2E on Chromium, five gates green.**

### Still owed after P4

| Item | Why it is not here |
|------|--------------------|
| **The 60 req/min rule, and Bot Fight Mode, in the zone** | `10 §11`'s three unticked boxes are dashboard state, unobservable from this repository. `.github/SECURITY.md:43` publicly tells researchers that 429 on `/api/*` is out of scope, for a control nobody has confirmed is switched on |
| **Focus mode's ToS carve-out, end to end** | `TtApp` passes `focusMode={false}` as a literal, so the branch cannot execute in production. The rail's markup and component tests are written and waiting. **A P5 exit item**, not a P4 gap. ✅ **Closed by P5 slice 2** — and the measurement it forced found the player was already being pushed off screen in the `≥ 1 h` regime (`03 §4`) |
| The blurred thumbnail background | Unchanged: an open 🟠 audit finding whose ToS half was never read |
| A re-check on **reconnect** | There is no reliable reconnect signal to hang it on — that is the whole finding above. Start covers it, and **Thử lại** covers the case where the browser never notices |

⚠️ **The thumbnail background (`06 §6`, `03 §5`) is deliberately not built.** Its
modified/decorative use of `hqdefault` rests on an **open 🟠 audit finding** that
S1 answered only the CORS half of — the terms were never read. Shipping the
generated gradient alone needs no ruling; do not let the visualizer substitute be
what pulls an unreviewed ToS question into the release.

## P5 — Visuals & settings · **in progress**, slices 1–2 merged, not released

Sliced into four, one release each, because P4's live checklist found a real bug
on a line nobody expected and a smaller surface per run is what makes that
useful. Written as it goes, for the reason P4's section gives.

### What P5 actually is

One measurement shaped the whole phase: **14 of the 26 fields in `TtSettings`
are declared, defaulted, clamped, persisted, unit-tested — and read by nothing.**

`lang`, `background`, `gradientPreset`, `gradientCustom`, `slideshowIntervalMs`,
`slideshowTransition`, `scrimStrength`, `scrimAuto`, `scanlines`, `autoTheme`,
`countdownSize`, `visualizer`, `visualizerSensitivity`, `crossfadeMs`.

So P5 is not schema design. It is **wiring up what `02 §3.1` already promised** —
which is this project's signature bug shape, except deliberate: the schema was
written ahead and P5 is when it gets consumed. Each slice therefore owes a test
that the field is genuinely read, not merely present.

| Slice | Scope | Fields it wires |
|-------|-------|-----------------|
| **1 — i18n** ✅ | runtime, both dictionaries, the key guard, Z6, every string migrated | `lang` |
| **2 — Settings + Focus** ✅ | the ⚙ panel (7 of 9 groups), Focus mode, the missing hotkeys (`F H S ] Esc`) | `countdownSize`, the six Countdown fields, `allowDuplicates`, `singleLoopStyle` |
| **3 — Backgrounds** ✅ | solid / gradient / image / slideshow, scrim, scanlines, auto-theme | the eight Display fields |
| **4 — Visualizer + a11y** ✅ | three styles, tally pulse, reduced motion, the milestone announcements | `visualizer`, `visualizerSensitivity` |

### Slice 1 — i18n · merged 2026-07-23

`08 §2`'s runtime, both dictionaries, and the `08 §3` key-diff guard that `13 §1`
has been filing since P1. ~145 hardcoded Vietnamese literals across 12 components
became keys; the statics are untouched, because `08 §1`'s route-based EN mirrors
are P6's.

Three guards, because a dictionary is the easiest place here to create something
that reads as finished and renders nowhere: `TtKey` derived from `en.json` makes
a typo a **build** error; the key-diff test covers both directions; and an
orphan/caller guard covers what `knip` structurally cannot — its `project` globs
exclude `.json`, so the dictionaries are outside its file set. The third caught
three keys that had been invented and never called.

Closed the runtime half of an open 🟡 audit finding: `08 §2.1` now states
`escapeValue: false`, `fallbackLng: 'en'` and the missing-key behaviour. The
first is not taste — every interpolated value is a track title, and i18next's
default escapes what Svelte has already escaped.

Also fixed, found on the way: two `Intl` call sites hardcoded `'vi-VN'`, so an EN
user got Vietnamese dates while `§3` had said "the active locale" all along.

⚠️ **`visualizer`'s default changed to `'off'` in the same release, and needed a
`schema` 1 → 2 migration to mean anything.** Changing a default reaches nobody
who has used the app before: `load()` lets the stored row win and `patch()`
writes the whole object, so `'ring'` was already in every existing row. The full
reasoning is in `02 §3.2`, and it applies to every default this suite ever
changes.

### Slice 2 — the ⚙ panel, Focus and the rest of the hotkeys · 2026-07-23

`03 §6`'s panel, `03 §4`'s Focus mode, and the four hotkeys (`F H S ]`) `13 §3`
has been carrying as "arrive in P5". Seven groups ship; **Display and Visualizer
are not rendered at all**, and inside Audio neither is crossfade nor the
loop-style selector — a control whose feature does not exist is the defect this
same slice fixes in `TtSingleRail`, and a greyed-out group is that object with
better manners. The rule is now written down (`03 §6`).

Three more declared-and-never-consumed items turned up while planning it, all
found the same way — grepping for the READ rather than the declaration:

| | |
|---|---|
| `ttLog.entries()` / `diagnostics()` / `clear()` | The whole `02 §7` Diagnostics API. Zero call sites outside its own unit test. The panel is the consumer it was written for |
| `ttLog.subscribe()` | Zero call sites anywhere. It is what keeps the log viewer live while the panel is open |
| `__TT_VERSION__` | Defined in `astro.config.mjs`, declared in `src/env.d.ts` with the comment *"Read by the About panel"* — and read by nothing |

#### The measurement that changed the slice, and found a live bug

`03 §4` says Focus grows the countdown ~20%; `06 §1.2` pins the player at 384×216
and forbids overlapping it. Measuring that **before** writing any Focus code —
which is what the carried item asked for — found the conflict already shipped:

> **In the `≥ 1 h` countdown regime, v0.5.2 pushes the YouTube player off screen
> at every viewport below 1920 px.** At 1280 px, 224 px of the 384 px player —
> 58% of it — is outside the viewport.

Neither flex item could shrink below its min-content size, so the line overflowed
to the right and took the player with it. Every existing YouTube spec used a
one-minute countdown, and `MM:SS` is the *narrowest* of `04 §4`'s three regimes at
3.46 em against `8:88:88`'s 4.48. The full table and the resolution are in
`03 §4`; the guard is `tests/e2e/yt-visibility.spec.ts`, which sweeps six widths
in the widest regime.

A second, quieter breach of the same rule came out with it: `TtTrackInfo`'s
**backdrop** was `inset: 0` at 75% opaque void, so the info modal scrimmed a
playing player. Both are now bounded by one published variable,
`--tt-yt-reserve` (`03 §2`).

⚠️ **And the guard itself had to be fixed before it was worth anything.** Its
first version probed the player's centre point and stayed green while the digits
overlapped its left edge by 79 px. The overlap arrives from one side. It samples
a 5×5 grid now, and with the size cap removed six of its tests turn red — checked
by mutation, per `13 §1`.

Also closed here: **`16 §P4`'s deferred exit item**, the Focus/ToS carve-out end
to end. `TtApp` passed `focusMode={false}` as a literal, so the branch could not
execute in production; it now can, and is asserted.

#### The live run, and a correction to the ritual

`tests/manual/p5-live-checklist.md` was run on **2026-07-23** and **every line
passed first time** — including the whole `≥ 1 h` geometry block and a real
Firefox pass, which this dev box cannot provide.

It was run **before the merge**, against the Cloudflare Workers build of the PR
branch, and that changes the rule this project has been carrying since P4:

> **The requirement is a real DEPLOYMENT, not specifically a tag.** `astro dev`
> and `astro preview` are excluded because they do not run the Worker — that part
> was always right. But the per-PR Cloudflare build is a real deployment too, so
> the checklist can run *before* the merge. A failure there costs a force-push;
> the same failure after a tag costs a patch release, which is precisely what
> v0.5.1 and v0.5.2 were.

Only a short **production re-check** remains tag-scoped, and it is short because
what a preview cannot speak for is zone-scoped rather than code-scoped: that the
tag deployed at all, the custom domain's `/api/yt/oembed` route, and the `10 §11`
headers.

Worth noting against P4's run, which found a real bug on its first line: this one
found nothing, because **the two defects this release fixes were found by
measuring during planning instead**. That is the outcome the measure-first step
exists for, not a sign the checklist was slack.

### Slice 3 — the Z1 background stack · 2026-07-23

`03 §2`'s stack, bottom to top: solid/gradient → image | slideshow → cover-art
blur → adaptive scrim → scanlines. Nine fields wired, which is the largest block
of the fourteen `16 §P5` measured as unread.

Three pure engines carry every decision, so no component picks a colour:
`tt-gradient.ts` (six presets + custom), `tt-contrast.ts` (WCAG luminance and
the solved scrim alpha), `tt-dominant-hue.ts` (median cut). The coverage gate
covers them; the store and the component are asserted separately.

**Four things from it that are not taste:**

- **`scrimAuto` is arithmetic, not a slider someone nudged.** `scrimFor()` solves
  `ratio(text, bg·(1−a)) = 4.5` in closed form and returns the user's own floor
  whenever the background is already dark enough — which is `02 §3.1`'s "never
  lowers it" expressed as a function rather than as a comment. It caps at 0.60
  and **reports the cap** rather than exceeding the documented range.
- **Auto-theme is a `hue-rotate`, not a rebuild of the gradient stops.** The six
  presets were chosen dark so the digits clear 4.5:1 at the minimum scrim, and a
  unit test asserts exactly that; rotating hue leaves luminance alone, so the
  guarantee survives the tint. Sampling a colour and using it would discard it.
- **The pictures are session-only and the panel says so.** Hard invariant 1 keeps
  them in RAM, so `background: 'slideshow'` survives a reload and the images do
  not. Z1 composites rather than switches, so the gradient underneath is already
  painted — nothing breaks, but without the copy nothing explains it either.
- **A second `TtUrlLedger` instance, not a third kind in the first one.**
  `05 §3`'s bound is `≤ queueLength + 2` and it is a statement about the audio
  graph; folding backgrounds in would make `withinBound` stop meaning anything,
  and it is the leak canary `09 §5` relies on.

⚠️ **`03 §5` was corrected, and this is the important part of the slice.** It
specified deriving the ambient colour from YouTube's thumbnail in YouTube mode —
a modified use of YouTube's image, named directly by an open 🟠 audit finding.
S1 measured `i.ytimg.com` sending `ACAO: *`, so the canvas would **not** be
tainted: the technical objection is gone and only the licensing one remains,
which makes building it a decision rather than an oversight. Nobody has read the
terms, so YouTube mode gets the generated gradient — which is the audit
finding's own recommendation. The same ruling keeps `06 §6`'s blurred
`hqdefault` background unbuilt.

Also new: `TT_MAX_BACKGROUND_IMAGES = 20` (`03 §6` said "multi-upload" and named
no ceiling) and the **`TT-IMG-*` log family**. The picker was briefly written
using TT-IMP-001/004 because it rejects for the same two shapes of reason as the
audio importer — which is the code-before-registration violation `12 §6` exists
to prevent, wearing a convincing disguise: `TT-IMP-*` is keyed straight into the
import summary toast, so a rejected background would have surfaced as "Format
not supported" in a toast about music.

**Found while testing, and kept rather than worked around:** `settings.patch()`
writes to Dexie asynchronously and every call site fires it with `void`, so a
spec that clicks a control and reloads immediately out-runs the write and reads
back the old value — indistinguishable from the setting never persisting.
`storedSettings()` in `_helpers.ts` polls the row instead. Also measured:
`test.use({ reducedMotion: 'reduce' })` did **not** reach `matchMedia` on
`@playwright/test` 1.61.1 while `page.emulateMedia()` did.

⚠️ **That same race was already live in v0.6.0, and CI caught it here.** The
slice 3 run reported `1 flaky` — `settings.spec.ts` "the chosen size survives a
reload", expecting 179.2 (size S) and receiving 230.4 (the default). It had
passed every local run; the first slow runner lost the race. Grepping the shape
found a **third** instance, latent since P1: `legal-gate.spec.ts` reloads
immediately after Accept, and the gate hides synchronously while the write is
awaited afterwards. All three now poll the row.

The lesson is about the signal, not the fix: **`retries: 2` means a flake
reports as `pass`**, so a green check is not evidence of a stable suite. The
run's *duration* is what prompted the look — 21m54s against the usual 6m — and
that turned out to be runner queueing, with the real Playwright time at 4.3m.
The flake was found by reading the log rather than the badge.

### Slice 3's live run — 2026-07-24

`tests/manual/p5-slice3-live-checklist.md` run against the **PR preview before
the merge**, second consecutive slice to use the corrected ritual. Every line
passed first time, including a real-Firefox pass and both directions of the
adaptive scrim. Released as **v0.7.0**.

Two runs in a row where the live checklist found nothing — and both slices'
defects were found by *measuring during planning* instead. That is the
measure-first step earning its place, not the checklist going slack.

### Slice 4 — the visualizer, the pulse and the announcements · 2026-07-24

The last slice of P5. `05 §6`'s three styles, `03 §1`'s beat-reactive tally, and
`03 §8`'s five polite milestones — the last of which had been **a sentence with
no code behind it since suite 1.0** and was the phase's stated exit criterion.

**All fourteen fields are now read.** `visualizer` and `visualizerSensitivity`
close the list `16 §P5` opened the phase with.

Decisions worth keeping:

- **The beat is published before the style is consulted.** `05 §6` says "even
  Visualizer: off keeps one live beat element", so the component still mounts at
  `off` and still reads the analyser — it simply draws nothing. The obvious
  arrangement, publishing from inside the draw path, would have made `off`
  silently kill the tally light, and nothing else in the app would have noticed.
  The E2E asserts the pulse **at the `off` setting** for exactly that reason.
- **Adaptive degrade measures the component's own work**, not the gap between
  frames. A page at 30 fps for unrelated reasons reports 33 ms every frame, and
  a gap-based rule would degrade the visualizer forever in response to someone
  else's cost. Recovery is asymmetric — two strikes down, one frame up.
- **The tally rides a CSS custom property, not a class.** The beat is
  continuous; a class quantises it to a blink.
- **Milestones announce only the lowest threshold crossed.** A throttled tab can
  tick 12 min → 30 s (`04 §2`), and four announcements back to back would talk
  over each other with the only true one arriving last.

⚠️ **One defect, and it is the signature shape again.** The milestone rule was
pure, unit-tested at every boundary, and correct. The shell handed it the
**display** value as "previous" — which is initialised to 90 000 for the idle
preview — so a 12-second run compared 90 000 to 12 000 and announced *"one
minute remaining"* to someone who had asked for twelve seconds. Caught by the
E2E on its first run, because no unit test of a pure function can see which
arguments the caller passes it.

Also worth recording: **the first mutation check targeted the wrong line.**
Removing the baseline *seed* changed nothing (the handler self-corrects after
one tick); reverting to the display value is what turns the spec red. The
comment in the code says so, rather than claiming credit for the seed.

### P5 exit review

| Criterion (`16` table) | Status |
|---|---|
| Visualizer, 3 styles | ✅ bars / wave / ring, slice 4 |
| Backgrounds + slideshow | ✅ slice 3 |
| Auto-theme | ✅ slice 3, cover art only — `03 §5`'s thumbnail clause was **removed**, not implemented |
| Focus mode | ✅ slice 2, with the ToS carve-out asserted end to end |
| Full settings | ✅ all nine `03 §6` groups, each shipped with its feature |
| i18n dictionaries + key-diff guard | ✅ slice 1, three guards |
| Reduced motion | ✅ suppresses scanlines, Ken Burns, the visualizer and the tally pulse — **at render time**, never rewriting the stored value |
| a11y milestones announced | ✅ slice 4 |
| ~~Perf budget met~~ | **Moved to P7** (2026-07-24). `13 §5` was right; a budget fixed two phases before the surface is final would only be re-measured |

**What the phase was actually about**, restated because it held up: 14 of 26
`TtSettings` fields were declared, defaulted, clamped, persisted, unit-tested —
and read by nothing. Every one is now consumed, and each slice shipped a test
that its field is genuinely *read* rather than merely present.

Three more declared-and-never-consumed items turned up on the way, all found by
grepping for the READ rather than the declaration: the whole `02 §7` diagnostics
API, `ttLog.subscribe`, and `__TT_VERSION__`. That habit is the phase's most
portable lesson.

### Carried out of P5 — what is still open

| | |
|---|---|
| ~~`TtSingleRail` ships two dead buttons~~ | ✅ Fixed in slice 2. `aria-pressed` derives from the **effective** style, "Cắt thẳng" has a real handler, and a stored `'crossfade'` renders the visible notice `05 §2` promised — until now it was a log line only |
| ~~`settings.reset()` re-blocks the app~~ | ✅ Resolved in slice 2, in favour of the honest reading: a full reset **is** a fresh profile, so the gate returning is correct and the confirmation says so before it happens (`03 §6`). Logged as TT-USR-101 |
| ~~Focus vs the ToS floor~~ | ✅ Measured and resolved — the ToS floor wins, enforced by layout rather than a YouTube branch (`03 §4`) |
| ~~Perf budget: P5 or P7?~~ | ✅ **Resolved 2026-07-24 — it is P7's.** `13 §5` was right and this table was wrong; the row above now says so. The reasoning is that a budget is only meaningful against the finished surface: P6 adds the landing pages and P7 the polish, so measuring `/app/` at ≤ 250 KB gz in P5 would fix a number to a bundle two phases from final, and a "pass" recorded here would have to be re-run anyway. What P5 **does** owe is that the visualizer has an adaptive-degrade path at all (`05 §6`), which is a behaviour rather than a number and is implemented in slice 4 |
| ~~The a11y exit criterion is unwritten code~~ | ✅ **Written in slice 4.** `tt-milestones.ts` plus a polite region in the shell. Its wiring shipped one defect — the display value passed as the crossing baseline — caught by E2E and recorded in `03 §8` |

**Nothing carries out of P5 into P6.** Every row above is closed, and the two
open items that predate the phase are unchanged and belong elsewhere: **S4b**
(`15 §S4`, gates crossfade only, and its harness needs fixing before a sweep
means anything) and the **CodeQL Default setup** dashboard item (`10 §11`,
zone-side, unfixable from this repository).

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
