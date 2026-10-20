# 15 — P0 Validation Spikes

Suite 2.0 · 2026-10-21 (scope rule amended 2026-07-21) · Total budget: ~4 working
days. Findings are written back into the referenced doc section.

## Scope rule

**No feature code in the area a spike covers, until that spike passes.**

The original wording was "no feature code before all four spikes pass". That
reading is self-defeating for S2, whose own method requires "the real `tt-timer`
core" — taken literally it forces the timer to be written twice, once as a
throwaway and once for real, and the throwaway is precisely the artifact whose
behaviour we are *not* trying to measure. The amended rule keeps every spike's
risk-retiring purpose while letting the measured code survive:

| Spike | Gates | Harness |
|-------|-------|---------|
| S1 | **P4** (YouTube) | throwaway `spike/s1-youtube` — built 2026-07-22 |
| S2 | **P2** (audio) — but runs *on* the P1 timer engine | the shipping countdown page under `?ttdebug=1` |
| S3 | **P2** (audio/import) | throwaway `spike/s3-metadata` |
| **S4a** | **P2** (audio graph + unlock) — ✅ passed | throwaway `spike/s4-crossfade` |
| **S4b** | **the crossfade loop style only** (P2 §Z4 toggle, P3 inter-track) | same harness, after the upgrade in §S4 |
| **S5** | **the finish notification** (v2.0) | throwaway `spike/s5-notify` — dev-only, `pnpm s5` |
| **S6** | **loudness normalisation** (v2.0) | throwaway `spike/s6-loudness` — dev-only, `pnpm s6` |

P1 (scaffold, mobile gate, timer engine, countdown display, settings/Dexie, log)
touches no area a spike covers except the timer, which S2 measures directly. No
audio-engine, importer, or YouTube code is written before S1/S3/S4 pass.

**Where the harnesses live, and where they do not.** `src/spike/pages/` plus one
folder per harness (`src/spike/s1`, `s3`, `s4`). They are routed only for
`astro dev`, or for a `TT_SPIKES=1` build, which goes to **`dist-spikes/`** —
never to the `dist/` that CI tests and `deploy.yml` ships (`ttSpikeRoutes` in
`astro.config.mjs`). `pnpm spikes` builds and previews them on port 4330. Until
v2.0 they were plain pages under `src/pages/spike/`, and every deploy published
them; `tests/e2e/spikes.spec.ts` and `tests/unit/tt-no-spikes-in-dist.test.ts`
keep them out.

## S1 — YouTube error matrix & playback chain (→ `06 §2, §4`)

- **Goal:** confirm real-world mapping of onError codes (esp. age-restricted vs
  region-blocked vs embed-disabled), controls rendering at 384×216, and the
  gesture→playVideo chain.
- **Method:** minimal page with one `YT.Player` on youtube-nocookie; curated
  video list (normal / deleted / embed-off / age-restricted / region-blocked-VN);
  drive `loadVideoById` sequence; log every event; test Chromium + Firefox.
  Also probe `/oembed` responses for each id (server-side curl is fine here).
  **Additionally** render the player inside a mock of the real Z4 right rail —
  collapsible (`]`) and with Focus mode active — not a bare page. `03 §2/§4` let
  both affordances hide the rail, and `06 §1.2` forbids the player ever being
  hidden or overlapped while a YouTube track plays; a bare-page spike cannot
  detect that conflict.
  **Also record** whether `i.ytimg.com` responds with an `Access-Control-Allow-Origin`
  header: without it the thumbnail canvas is tainted and the dominant-hue
  extraction specified in `03 §5` / `06 §6` is unimplementable as written.
- **Acceptance:** every list entry maps to a documented overlay type with no
  "unknown" bucket; queue of 3 advances hands-free after one initial gesture;
  native controls fully visible at 384×216 **inside the real rail, in every rail
  and Focus state reachable in YouTube mode**; thumbnail CORS status recorded.
- **Timebox:** 1 day. **Risk if failed:** overlay taxonomy in `06 §4` is
  restructured before any YT UI work; a tainted thumbnail canvas forces an
  ambient-background redesign in `03 §5` before P5.

## S2 — Timer drift, background throttling, Wake Lock (→ `04`)

- **Goal:** measure countdown accuracy with tab hidden for long periods, **with
  and without audio playing**; verify Worker `done` fires while hidden; verify
  Wake Lock reacquisition; verify the drift rule (`04 §1`) distinguishes a
  wall-clock jump from a throttling gap.
- **How to run:** open **`https://ticktune.net/app/?ttdebug=1`** (or a local
  `astro preview`). A panel appears top-right; it is absent without the flag and
  collects nothing, because a 90-minute run at 200 ms would otherwise accumulate
  ~27 000 sample objects for no reason. Set a duration, press Bắt đầu, drive the
  browser through the case you are testing, then **copy JSON report** and paste
  the result into the table below.

  The panel reports four numbers, and the distinction between the first two
  matters:

  | Metric | Meaning | S2 bound |
  |--------|---------|----------|
  | **max render gap** | Worst delay between display repaints. Below 60 s the digits repaint per rAF frame, so this is what the user actually perceives | **≤ ±50 ms**, visible tab |
  | **tick gap** (visible / hidden) | Worst gap between *authoritative* worker ticks, ~200 ms nominal. Bounds how late `done` can fire | hidden: **≤ ±500 ms** with audio |
  | **max \|skew\|** | Largest `dWall − dMono`. Non-zero means the wall clock moved (`04 §1`) | ~0 unless the clock is changed |
  | **overshoot at done** | How far past the deadline the finish actually fired | the real acceptance figure |

  ⚠️ **From P2, Start requires a track** (`02 §1` `isReady`), which would kill
  this apparatus — cases 4–7 are still unrun. So a **timer-only Start** stays
  available under `?ttdebug=1`, bypassing the queue predicate. Case 3 is
  audio-free by definition, so this is not a shortcut around the measurement; it
  is what keeps the measurement possible. Unreachable without the flag, exactly
  like the panel itself, and it collects nothing.

  The **keep-alive audio** checkbox is the apparatus for case 3: an inaudible
  ~0-gain oscillator that makes the tab count as playing audio. Running case 3
  once with it on and once off, then diffing, *is* the measurement. It is
  deliberately a raw oscillator and not the audio engine — the scope rule keeps
  audio-engine code behind S3/S4, and this is instrumentation.

- **Method:** the real `tt-timer` core — the shipping countdown page under
  `?ttdebug=1`, **not** a throwaway harness (this spike's own goal requires the
  real core, so writing it twice is waste; see the scope note under "Exit").
  30-min and 90-min runs in Chromium + Firefox on Windows 11 (i7-14700KF box).
  Matrix:

  | # | Tab state | Audio | Why |
  |---|-----------|-------|-----|
  | 1 | visible | any | baseline |
  | 2 | hidden | playing | the case the original acceptance covered |
  | 3 | **hidden** | **silent** | `02 §5` TT-PLY-102 (repeat off, playlist exhausted → "silence, countdown continues") and the `endChime: false` + `endFadeMs: 0` combination (`02 §3.3`) are documented product states that can last most of a 90-min session |
  | 4 | **hidden** | **YouTube mode** | audio comes from a cross-origin iframe; there is no page-owned media element at all |
  | 5 | minimized / occluded | both | `document.hidden` may not be set while throttling still applies |
  | 6 | sleep/resume across zero | any | TT-SYS-203 latch |
  | 7 | any | any + **clock ±5 min mid-run** | TT-SYS-201 must fire here and **only** here |

  For #3, run twice — once with a looping near-zero-gain oscillator alive, once
  with nothing — and diff. That difference *is* the measurement.

- **Why #3–#4 matter:** `04 §2` rests correctness on Workers being lightly
  throttled, with a parenthetical conceding that playing audio is what buys the
  exemption. Chromium's intensive wake-up throttling of hidden pages also reaches
  their dedicated workers; audibility is the reliable exemption. An acceptance
  criterion written only for the audible case cannot fail on the dangerous
  configuration.
- **Acceptance:** visible-tab error ≤ ±50 ms sustained; hidden-tab error at
  `done` ≤ ±500 ms **with audio playing**; **a recorded number for the silent
  hidden tab and for YouTube mode** (no pass/fail threshold is asserted in
  advance — the point is to learn it, then write it into `04 §2` as a stated
  guarantee); sleep-across-zero fires the latch on wake (TT-SYS-203); no
  double-`done`; a ±5 min clock change does **not** move the displayed deadline
  and does log TT-SYS-201, while a throttling gap of similar size does **not**.
- ~~**Contingency if #3/#4 drift is unacceptable:** keep an inaudible
  near-zero-gain looping buffer alive during silence states.~~ **Tried and
  withdrawn 2026-07-21** — the control run with the keep-alive ON was still
  52.4 s late. Audibility does not protect the timer. See `04 §2` for the three
  remaining options, which are product decisions rather than code fixes.
- **Timebox:** 1 day (long runs can run unattended).

### S2 results

Paste one row per run. `keepAlive` records the oscillator state, since case 3 is
meaningless without it.

| Date | Browser | Case | keepAlive | render gap | tick gap | \|skew\| | overshoot | Verdict |
|------|---------|------|-----------|-----------|----------|--------|-----------|---------|
| 2026-07-21 | Chromium (headless) | 1 visible, 4 s | off | **18 ms** | 202 ms | 0.7 ms | **29 ms** | ✅ smoke — harness sanity only |
| 2026-07-21 | Edge 151 | 2 hidden+audio, ~90 s | **on** | — | 280 ms | 1.0 ms | **28 ms** | ✅ within bounds, but hidden only 1.4 min — **below the ~5 min intensive-throttling onset**, so it does not clear the risk |
| 2026-07-21 | Edge 151 | **3 hidden+SILENT, 30 min** (24.9 min hidden) | **off** | 116 ms | **798 786 ms** | 1.7 ms | **177 509 ms** | 🔴 **FAIL.** 355× over bound. Worker frozen up to 13m 19s; mean hidden interval still 428 ms, so it stalls in bursts. `done` was rescued by the visibility latch (TT-SYS-203), not the worker |
| 2026-07-21 | Edge 151 | **2 CONTROL, 18.9 min** (17.8 min hidden) | **ON** | 30 908 ms* | **721 190 ms** | 1.5 ms | **52 351 ms** | 🔴 **The remedy fails too.** 105× over bound, `done` again fired by the latch not the worker. *the "visible" render gap is an attribution artefact — a hidden stall observed after returning; fixed in the harness after this run |

Cases 1–3 and the case-2 control above have run; cases 4–7 — minimised,
suspended and clock-change — are still to run. They all need a human driving a
real browser window, which is exactly why they were never going to be
automated.

## S3 — music-metadata coverage & Vietnamese tags (→ `05 §4–5`)

- **Goal:** validate `parseBlob` across the real accept-list and the mojibake
  policy against actual Vietnamese-tagged files.
- **Method:** two corpora, because neither alone is sufficient.

  **(a) Bulk / real-world — the local `test/` corpus** (never committed, see
  `.gitignore`). 103 CC-BY/CC0 mp3s + format samples. Covers for free: the ≥95-file
  batch timing; the 95th-vs-96th `TT-IMP-004` boundary; a ready-made `TT-IMP-001`
  rejection set, since `.alac` / `.ac3` / `.aif` all sit outside the `02 §4`
  allow-list; real VBR MP3s for `element.duration` integrity.

  **(b) Tag matrix — generated, committed** by `scripts/make-fixtures.ts`
  (self-made ⇒ no rights issues, tiny). The `test/` corpus **cannot** cover this:
  a check of all 103 filenames found **zero** Vietnamese characters, and `.m4a`,
  `.oga` and `.webm` are absent entirely — so the Vietnamese acceptance criterion
  below would otherwise pass vacuously. Generate: ID3v1-only, ID3v2.3 UTF-16,
  ID3v2.4 UTF-8, Vorbis comment, MP4/`.m4a` — each tagged in Vietnamese with full
  diacritics — plus `.oga` and `.webm` containers and one file carrying ~5 MB of
  embedded cover art.

  Run both through the importer pipeline prototype in Chromium + Firefox +
  (if reachable) Safari; record parse time per file.
- **Acceptance:** all v2/vorbis/mp4 tags render Vietnamese correctly **including
  diacritics**; ID3v1-only mojibake triggers the U+FFFD → filename fallback
  (TT-IMP-007); cover art extracted; every allow-list container in `02 §4` either
  parses or is honestly rejected by the `canPlayType()` probe; 95-file batch
  parses < 10 s total on the dev box.
- **Prerequisite:** `scripts/make-fixtures.ts` and ffmpeg (fetched on demand by
  `scripts/ensure-ffmpeg.ts`), and the local `test/` corpus for the 95-file row.
  (A corpus-audit script was planned here and never written; S3 ran without
  it.)
- **Timebox:** 0.5–1 day.

## S4 — Crossfade + AudioContext unlock (→ `05 §1–2`)

### ⚠️ Split into S4a / S4b — 2026-07-21

S4 was one spike gating all of `05 §1–2`, and it stalled half-measured: the
crossfade was judged clean by ear, but overlap timing and the 0/1/2/5 s sweep
were never recorded. Taken literally that blocks the entire P2 audio graph on a
number that only the *crossfade* depends on, which is why `16` and this chapter
appeared to contradict each other. Split along what each half actually gates:

| Half | Covers | State | Gates |
|------|--------|-------|-------|
| **S4a** | the `05 §1` graph, `createMediaElementSource` reuse, gesture `resume()`, equal-power curve shape, no audible click | ✅ **passed** — measured 2026-07-21, clean by ear on headphones and speakers | P2's audio graph, Single mode, End Behavior |
| **S4b** | `timeupdate` trigger accuracy (±150 ms), the 0/1/2/5 s sweep, `element.duration` revision on real VBR MP3s | ✅ **passed** — full sweep 2026-10-20, the corpus as shipped (from the start) | the crossfade loop style only (`03 §2` Z4 toggle) and P3's inter-track crossfade — **released in v2.0** |

P2 therefore ships `singleLoopStyle: 'hard'` and renders the crossfade toggle
disabled (`05 §2`). Nothing else in P2 depends on S4b.

⚠️ **Closing S4b was not "run the existing harness".** The v1 harness computed
its overlap from `gain[i].gain.value` — the automation it had scheduled itself —
so the measurement could not disagree with the schedule and could not fail. It
also fired the fade from a hard-coded `setTimeout(1200)`, never read
`element.duration`, built one master gain where the app has two, and at a 0.02
threshold spent 127 of the 150 ms tolerance on a perfect 5 s fade.

### S4b harness v2 — v2.0

- **The graph under test is the shipping one.** `buildTtGraph()` and
  `ttGraphPorts()` are exported from `tt-audio-driver.ts`; the driver and the
  harness both call them, so nothing measured is a hand-built copy.
- **Measured from the audio.** An AudioWorklet probe per deck reads the signal
  **before** and **after** its `deckGain`, and a third reads the master around
  `fadeGain`, every 128-frame render quantum (`src/spike/s4/tt-s4b-probe.worklet.ts`).
  A deck is *playing* when its pre-gain signal is above −60 dBFS; its *realized
  gain* is √(post/pre) — which cancels the music out, and reads zero when the
  media is absent however loudly the automation says 1.
- **The trigger is the candidate engine code.** `crossfadePlan()`
  (`tt-s4b-plan.ts`, pure) runs on every real `timeupdate`: it fires when
  `remaining ≤ effFade + margin`, with `effFade = min(fade, D_out/2, D_in/2)`, and
  runs the curves for `min(effFade, remaining − latency − guard)`. On a PASS it
  moves into the engine unchanged.
- **Metrics** (`tt-s4b-metrics.ts`, pure, `tests/unit/s4b-metrics.test.ts`):
  overlap = time both decks play at realized gain ≥ 0.1, against the IDEAL for
  that threshold, `eff·(1 − (4/π)·asin 0.1) = 0.8725·eff`; a two-point fit of each
  deck to its cos/sin curve; head loss (incoming sound that arrived after its
  fade-in had begun); end guard (outgoing signal end − fade end: negative means
  it stopped while audible), also measured from `ended`, which content cannot
  fool; the 0 s gap a listener hears, net of the files' own silence; clicks — a
  second difference > 10× the preceding 500 ms's p99 and above −50 dBFS within
  −300/+100 ms of something the runner did, or a realized-gain step > 0.25;
  equal-power deviation; clipping; the master fade's own fit.
- **It can fail, and proves it first.** Four broken controls run before anything
  else — B never starts (`corrupt.mp3`), B plays 300 ms late, A stops 400 ms
  before its fade ends, a signal that ends on a peak — and the verdict is
  **HARNESS INVALID** unless every one FAILS. The unit tests also show the old
  gain-readback metric passing all three broken traces.
- **Fixtures** (`pnpm s4b:fixtures`, into git-ignored `test/generated/s4b/`):
  440/660 Hz pairs in WAV, CBR with and without an Info header, VBR with Xing,
  raw ADTS, M4A, FLAC and Opus; header-less VBR whose bitrate changes mid-file in
  both directions; the controls; and `--corpus` adds the corpus's 16 Xing-VBR
  MP3s as shipped and **remuxed without their header** — the corpus holds no
  header-less VBR, exactly the case this spike exists for. True durations and
  silences come from a full ffmpeg decode, into `manifest.json`.
- **The sweep** (`pnpm s4b`, `scripts/s4b-sweep.ts`): `astro dev` in-process,
  Playwright loads the fixtures and presses Unlock with a real click, then runs
  each configuration in sequence. Modes: `inter` (A→B), `loop` (one file, one
  URL, both decks, two transitions), `zero` (Z1 swaps `src` at `ended` — what the
  app does today; Z2 starts a pre-armed idle deck at `ended`; Z3 crosses over in
  10 ms just before the end), `master` (the real `runEndBehavior` 2 s fade lands
  40% into a 5 s crossfade, a `userGain` write at 60%), `pause` (held at 50% for
  1 s with `cancelScheduledValues` + `setValueAtTime` — Firefox has no
  `cancelAndHoldAtTime` — then resumed). `--quick` ≈ 12 min, `--full` ×3 plus
  the corpus. Results go to git-ignored `test/s4b-results/` (they name corpus
  files); this chapter carries labels only. Bundled headed Chromium cannot be
  spawned on the dev box, so it runs in **system Edge** (`--channel msedge`, the
  browser S2 was measured in); the page's own buttons run the same plan in
  Firefox and Safari by hand.
- **Acceptance**, each rule able to fail (`tt-s4b-verdict.ts`): every control
  fails; every test-file crossfade within ±150 ms of the ideal overlap, no
  truncation, head loss ≤ 150 ms, no click, no exception; at least one 0 s switch
  with gap ±150 ms and no click (the verdict names it); the master fade on
  schedule (±10 ms), click-free, the crossfade's overlap within 20 ms of a control
  run without it; header-less VBR kept on time by at least one duration source
  (the verdict names it); real corpus VBR with no truncation and no early cut
  (`ended` − fade end within 0…margin + guard + 150 ms). Playback never starting
  before the gesture, and listening to corpus transitions on speakers, stay
  owner-run lines of the v2.0 live checklist.
- **Timebox:** 0.5–1 day (v1); the v2 harness is a v2.0 deliverable.

### S4b results — quick sweep, 2026-10-20 (Edge 155, Windows 11)

**Quick sweep: PASS** — 46 configurations, 48 runs, 9.1 min. The formal S4b
verdict also needs real music (the acceptance says so), so the full sweep —
three repeats plus the corpus as shipped and remuxed without its header — runs
next, and the Exit row below changes only with its result.

| Criterion | Result |
|---|---|
| Harness can fail | ✅ all four controls FAILED, as they must |
| Test-file crossfades (25 A→B, 4 loop, 2 pause) | ✅ 31/31: overlap −2…+26 ms from ideal, end guard +64…+211 ms, head loss 0…21 ms, incoming start 0…24 ms after `play()`, no click |
| A→B curve fit and power (25 runs) | each deck's measured fade within ±2 ms of its schedule, start and length; equal-power deviation ≤ 0.34 dB |
| 0 s | ✅ **Z2** (start a pre-armed idle deck at `ended`): gap 11–24 ms, no click. Z1 (today's `src` swap) 13–27 ms, also clean. Z3 (10 ms crossover before the end) clicks every time |
| Master fade mid-crossfade | ✅ `fadeGain` fade within −1 / +1 ms of schedule, crossfade overlap identical to its control (0 ms drift), no click, no exception from the `userGain` write |
| Header-less VBR | ✅ on time by the TRUE duration (end guard 240 ms, both directions); ❌ by `element.duration` — the estimate is so wrong the trigger concludes the fade cannot fit (`too-short`) and never starts |

**What the sweeps decided for the engine** (each found by a run that failed first):

- **The trigger runs on the true duration**, the importer's
  `parseBlob({ duration: true })` value, with `element.duration` only as a
  fallback. By the element's estimate, raw ADTS fired 0.2–0.5 s early and
  header-less VBR never crossfaded at all.
- **The incoming deck is armed early** (src set, metadata loaded) — every
  passing run used it; incoming audio then starts 0–24 ms after `play()`.
- **A pause mid-fade holds atomically and de-clicks.** `pause()` on a playing
  element is a step: 6–8 clicks per run. `cancelScheduledValues` on an active
  curve restores the pre-curve value, and the render thread played a quantum of
  it before the next call landed. The pass: `cancelAndHoldAtTime`, a 15 ms ramp
  to zero, and the element paused 45 ms later (the render thread runs ahead of
  `currentTime`; at +5 ms one run in three still clicked). Firefox has no
  `cancelAndHoldAtTime` and falls back — it is a manual line of the v2.0 live
  checklist.
- **Constants:** margin 0.3 s, guard 0.03 s, latency 0, 0 s switch Z2.
- Loop crossfades of a TONE into itself show up to 7 dB of power ripple: the
  two decks carry correlated signals, which no equal-power pair can flatten.
  Music's end and start are uncorrelated; the corpus runs measure it.

### S4b results — full sweep, 2026-10-20 (Edge 155, Windows 11) — ✅ PASS

The quick sweep three times over, plus real music: 57 corpus files — the 16
Xing-VBR masters and the owner's 41 CC0 / YouTube Audio Library tracks (54 MP3,
1 FLAC, 2 WAV) — crossfaded from their tails at 1, 2 and 5 s, and the 16
masters remuxed without their header. 341 configurations, 347 runs, 142 min.

| Criterion | Result |
|---|---|
| Harness can fail | ✅ 12/12 controls FAILED, as they must |
| Test-file crossfades (75 A→B, 12 loop, 6 pause) | ✅ 93/93: overlap −2…+26 ms from ideal (the pause runs carry the +24…26), end guard +67…+219 ms, head loss 0…21 ms, no click |
| 0 s | ✅ **Z2** 6/6, gap 11–24 ms; Z1 6/6, 11–27 ms; both click-free. Z3 clicked 4 times in every run |
| Master fade mid-crossfade | ✅ 3/3 on schedule, overlap drift 0 ms |
| Header-less VBR | ✅ by the TRUE duration 22/22, end guard +109…+291 ms; by `element.duration` 1/22 |
| Real music, as the sweep plays it | ❌ **151/171** — the 151 at +80…+461 ms; the 20 at −448…+971 ms |

**The 20 were the harness, and it was asked before the engine was blamed.**
Every one is an MP3; every FLAC and WAV run passed; the failures spread evenly
over 1, 2 and 5 s (6 / 7 / 7), so the fade length was not it. What they shared
is how the sweep reaches the end of a track: it **seeks** A to its last
seconds, to keep the sweep to hours. In a VBR MP3 Chrome seeks by the Xing
table of contents, whose 1 % steps are seconds wide on a four-minute track,
and `currentTime` stays that far off the audio for the rest of the file — the
trigger fired by a clock the audio did not keep. **The app never seeks:** every
track plays from 0.

So the 20, five passing corpus runs as a check on the method, and the four
controls ran again **from the start of each track**
(`pnpm s4b --full --labels <file> --from-start`, 29 runs, 70 min):

| Run | Result |
|---|---|
| The 4 controls | ✅ all FAILED again — the harness could still fail in that session |
| The 20 that failed after the seek | ✅ **20/20**, end guard **+61…+331 ms** (after the seek: −448…+971) |
| The 5 that passed after the seek | ✅ 5/5, +139…+261 ms (after the seek: +171…+400) |

**Verdict: PASS, as shipped.** Every criterion held, and real music played the
way the app plays it lands its fade 61–331 ms before the media ends — inside
the 0…480 ms the acceptance allows, at every fade length, on every container.
The crossfade loop style and the inter-track crossfade are released, with the
constants above: the trigger on the importer's true duration (`element.duration`
only as a fallback), the incoming deck armed early, margin 0.3 s, guard 0.03 s,
latency 0, the atomic hold and de-click for a pause mid-fade, and Z2 for 0 s.

⚠️ **What the PASS does not cover, written down so nobody assumes it:** a
**seek** in a VBR MP3. If a seek control is ever added, the trigger cannot
trust `currentTime` after it — re-derive the remaining time from the audio
clock, or measure again. Listening to transitions on speakers, Firefox's
pause-mid-fade fallback, and a fresh-profile gesture stay owner lines of the
v2.0 live checklist.

## S5 — Finish notification from a worker, tab hidden (→ `04 §2`)

**The question.** S2 (`§S2`) measured a hidden, silent tab finishing minutes
late and traced the stall to the MAIN THREAD's message processing — which only
*infers* that the worker kept time. If a notification created by the dedicated
worker itself, at the deadline, arrives on time while the tab is hidden, TickTune
can alert the user without a service worker, a push server or any server-side
state. If it is minutes late too, nothing is built.

- **Harness** (`/spike/s5-notify`, dev-only): a worker with the same 200 ms
  derived tick as `tt-timer.worker.ts` records the gaps between its own ticks —
  the number S2 never had — and at the deadline calls `new Notification()` if the
  page last said it was hidden. It writes its record to IndexedDB
  `ticktune-s5` from the worker, so a discarded tab still reports. The page
  records when it saw the fire, its visibility timeline, and whether a
  notification click focused the tab.
- **Automated runs** (`pnpm s5`): Edge, Chrome, Brave and Firefox at once, each
  launched the way a user runs it — a plain process on a fresh profile, nothing
  attached to its pages. Under Playwright the harness reported `visible` however
  it was hidden — a cover tab, a minimised window, a persistent context (measured,
  Edge 155) — so a driven browser cannot answer this question. The Chromium
  family gets `--remote-debugging-port`, used only at the browser level (grant
  notifications, open tabs, close); Firefox gets a `user.js` that allows
  notifications and its tabs on the command line. Per browser, 10 harness tabs of
  25 minutes start themselves from their query and sit in the background, behind
  a visible 30 s control in the front tab that must not notify (a control whose
  window the OS covered anyway is reported inconclusive, not passed). Worker and
  page post every record to the script's own same-origin server. Safari is not on
  the dev box, and the owner runs one confirmation in their everyday browser,
  including the notification click.
- **GO** if, on Chrome and Edge, hidden and silent for ≥ 25 minutes across zero,
  the worker notifies within 2 s of the deadline in ≥ 9 of 10 runs; exactly one
  notification per run; none when the tab is visible. Brave and Firefox are
  recorded against the same bound; click-to-focus per browser; every limit
  written down with its number. **NO-GO:** nothing is built and the numbers go
  to `04 §2`.

### Result — ✅ GO (2026-10-21)

Four browsers launched undriven on fresh profiles, ten 25-minute runs each in
background tabs, all at once on the Windows 11 dev box (2560×1440), silent
throughout:

| Browser | Hidden, notified, ≤ 2 s | Worker late | Shown late | Page saw it | Max tick gap | Ticks > 1 s |
|---|---|---|---|---|---|---|
| Edge 155 | **10/10** | 47–117 ms | 52–122 ms | 50–121 ms | 298 ms | 0 |
| Chrome 155 | **10/10** | 47–106 ms | 51–119 ms | 51–112 ms | 371 ms | 0 |
| Brave (Chromium 155) | **10/10** | 52–80 ms | 63–100 ms | 61–98 ms | 371 ms | 0 |
| Firefox 158 | **10/10** | 9–207 ms | 33–217 ms | 10–210 ms | **3 167 ms** | 3 |

- **The worker keeps time while hidden** — the number S2 never had. On the
  Chromium family its own 200 ms tick never stretched past 371 ms in 25 minutes.
  **Firefox throttles worker timers at times**: three gaps over a second across
  ten runs, the longest 3.2 s. None fell on a deadline here, but one could, so on
  Firefox the notification is good to "a few seconds", not to 2 s.
- **The visible control.** In a 2-run smoke of the same runner, all four
  controls were visible at zero and did not notify. In the full run every
  control window was covered by another window when its 30 s ran out (the
  desktop app was in front), so the runner reported all four inconclusive rather
  than passed. "Visible → silent" rests on the smoke run and on the one branch
  the hidden runs exercise (`hiddenAtFire`).
- **⚠️ S2's stall did not reproduce here.** The page saw the worker's message
  50–210 ms after the deadline in every hidden run. S2 measured the shipping
  app's `done` arriving minutes late (`§S2`); why this harness's main thread was
  prompt is not known. The feature notifies from the worker either way, so
  nothing in it depends on the answer — but `§S2`'s "a worker cannot route
  around it" was about reacting in the page, not about the worker's clock.
- **Still the owner's**: one run in an everyday browser profile, clicking the
  notification (click-to-focus has no automated measurement here), and Safari,
  which has no `Notification` in workers and takes the main-thread path in the
  feature.

Results: `test/s5-results/` (local, git-ignored).

## S6 — Loudness from a reduced-rate decode (→ `05 §1`)

**The question.** Opt-in loudness normalisation needs each local file's
integrated loudness. Playback streams through `MediaElementSource` and
`05 §1` forbids decoding whole tracks *for playback* — so the meter must decode
separately, once, and let go. Is `OfflineAudioContext(…, 16 kHz).decodeAudioData`
plus a BS.1770-4 meter accurate enough and affordable enough?

- **Meter** (`tt-s6-loudness.ts`, pure): K-weighting derived from the analog
  prototype for the actual rate (checked against the published 48 kHz table to
  1e-6), 400 ms blocks with 75 % overlap, −70 LUFS absolute and −10 LU relative
  gates, mono weighted as dual mono, sample peak.
- **Fixtures** (`pnpm s6:fixtures [--corpus] [--extra <dir>]`): EBU Tech
  3341-style signals, 10:02 of music-like noise as MP3 320k, FLAC and WAV — the
  longest track the app accepts — every corpus file in place, and with `--extra`
  any further folder of real masters (the v2.0 sweep added the owner's CC0 and
  YouTube Audio Library set, 41 files the app accepts), each with ffmpeg's
  `ebur128` at the native rate as the reference.
- **Sweep** (`pnpm s6`): every file at 16, 24 and 48 kHz in system Edge;
  loudness, sample peak, decode and compute time from the page, and MEMORY from
  outside — the private bytes of the browser and all its children every 100 ms,
  each analysis's peak over the sample just before it.
- **PASS** at 16 kHz (else 24 kHz): ≥ 95 % of files within 0.5 LU of the
  reference and none beyond 1 LU; a 10:02 file decoded and measured in ≤ 3 s and
  ≤ 400 MB; no decode errors. The p99 peak under-read at the chosen rate becomes
  the boost limit's safety margin. Safari's minimum `OfflineAudioContext` rate
  is a manual check.

### Result — ❌ FAIL (2026-10-21)

153 files on Edge 155: 6 signals, the three 10:02 files, 103 corpus files and 41
of the owner's CC0 / YouTube Audio Library masters — each at three rates,
against ffmpeg `ebur128` at the native rate:

| Rate | Within 0.5 LU — all / music only | Worst error | 10:02 time | 10:02 peak memory | Errors |
|---|---|---|---|---|---|
| 16 kHz | 94.1 % / 95.2 % | **42.5 LU** (the 8 kHz tone); music **1.79 LU** | 942 ms | **495 MB** | 0 |
| 24 kHz | 96.7 % / 97.3 % | music **1.20 LU** | 1 091 ms | 393 MB | 0 |
| 48 kHz | 100 % / 100 % | 0.18 LU | 1 554 ms | **537 MB** | 0 |

Two separate failures, either of them enough:

1. **A reduced rate under-reads bright material, always in the same
   direction.** K-weighting lifts everything above ~1.5 kHz by 4 dB, and a 16 kHz
   decode simply has no energy above 8 kHz (12 kHz at 24 kHz): pink noise reads
   1.7 LU low at 16 kHz, the 8 kHz tone sits exactly at Nyquist and vanishes,
   and the brightest real master read 1.79 LU low (1.20 at 24 kHz). Normalising
   on that number would push exactly the brightest tracks the loudest. At 48 kHz
   the meter is right: every file within 0.18 LU.
2. **The rate does not bound the memory.** Peak private bytes for one 10:02 file
   ran 260–540 MB at every rate, with no ordering by rate — Chrome decodes at the
   file's own rate and resamples afterwards, so the full native-rate PCM exists
   either way. The reduced rate was the plan's lever for memory, and it is not
   one. Time was never the problem: ≤ 1.6 s for 10:02 everywhere.

**So loudness normalisation is not built in v2.0** (the scope rule). The
remedies, for a later spike:

- **Slice and accumulate, at 48 kHz** — decode ≤ 30 s at a time and sum the
  400 ms block energies across slices, which is exactly what BS.1770 gating
  needs; peak memory falls with the slice. WAV, MP3, ADTS, FLAC and Ogg can be
  cut on frame boundaries; M4A needs a demuxer.
- **WebCodecs `AudioDecoder`** — chunk-by-chunk decode with near-constant
  memory, also needing a demuxer per container.
- **Tags only** — ReplayGain / R128 when the file carries them, no decode at all.
  Smaller, but it leaves untagged files unnormalised, and it is inside this
  spike's area, so it is an owner decision, not a fallback.

Results: `test/s6-results/` (local, git-ignored — they name corpus files).

## Exit

Each spike's findings are written back into its target chapter (04 / 05 / 06) and
this file gains a ✅/❌ result table. Per the scope rule above, a spike gates its
own area rather than the whole project: S2's result gates P2 and is recorded
against the P1 timer engine it ran on; S1 gates P4; S3 and S4 gate P2
(`16-ROADMAP.md`).

| Spike | Result | Date | Findings written to |
|-------|--------|------|---------------------|
| S1 | ✅ **PASS — with findings that rewrote `02 §6`, `03 §2`, `06 §3` and `06 §4`** | 2026-07-22 | Harness `/spike/s1-youtube` shipped in v0.4.1; full run in `tests/manual/yt-matrix.md` (10 ids, 6 causes, Chrome 151, **9 hands-free advances from 1 gesture**, no UNKNOWN bucket, no CSP violations). **🔴 `onError` discriminates nothing** — private, age-restricted, region-blocked, deleted, malformed and embed-off all report **150**, and `onError 100` never fired. **✅ oEmbed does discriminate** — 400/401/403/404 are four distinct causes — **but the Worker flattened them to one body and rewrote 401→404**, so the app could not tell them apart — the two Worker changes this owed to P4 both landed (`06 §3`). **🔴 The 2026-07-21 "a deleted video is a 400" finding is RETRACTED**: both samples ended in a character that cannot terminate a base64url id, so they were malformed, not missing; 26-id sweep shows valid-final-char → 404, invalid → 400, no exceptions. **✅ CSP** carries the player (`www-widgetapi.js` comes from `www.youtube.com`, not `s.ytimg.com` — audit prediction refuted). **✅ `i.ytimg.com` sends `ACAO: *`**, so the `03 §5` auto-theme risk does not apply. **Region case answered by inversion** — a VN-only video played from a foreign IP. **Firefox agrees** (user-run). **Controls measured:** 384×216 exactly with all native controls visible — but a **collapsed rail leaves the player 0×0 with audio still playing**, and Focus leaves it at **opacity 0.06 while playing**, so `03 §2`'s carve-out is proven load-bearing rather than precautionary (and `checkVisibility({checkOpacity:true})` returns TRUE at 0.06, so it cannot be P4's guard). **`onError 100` believed unreachable** — cue-only on BOTH hosts, three causes each, 150 six times out of six; `02 §6`'s separate TT-YT-100 path has folded. ⚠️ **One acceptance clause converts into a P4 requirement rather than being verified here:** "controls fully visible in every rail and Focus state" cannot pass against a mock — S1 produced the requirement and the failing measurement, and P4 owes the implementation plus its own assertion. Also owed to P4, and delivered: the two `worker/index.ts` changes in `06 §3` |
| S2 | 🔴 **FAIL — and the contingency failed too** | 2026-07-21 | Hidden+silent: `done` **2m 57s late**. Control run with keep-alive **ON**: still **52.4 s late**, 105× the bound. The audibility exemption does not protect the timer, so `15 §S2`'s contingency is **withdrawn, not adopted**. The stall is in main-thread message processing, so a worker cannot route around it. P2 needs a product decision, not a code fix (`04 §2`) |
| S3 | ✅ **PASS** | 2026-07-21 | Tag matrix + 103-file/598 MB real corpus in **1 362 ms** (budget 10 s); 7.26 MB cover extracted; 0 false positives from the new `onlyV1` rule. The U+FFFD rule was falsified and replaced (`05 §5`). ID3v2.2 and APEv2 found in the wild |
| **S4a** | ✅ **PASS** | 2026-07-21 | Crossfade judged clean by ear on headphones **and** speakers (the criterion no instrument can answer); graph, `createMediaElementSource` reuse and gesture `resume()` all exercised. Gates released for P2's audio graph |
| **S4b** | ✅ **PASS — as shipped** | 2026-10-20 | Harness v2 (`§S4`): measured from the audio on the shipping graph, controls proven to fail. Full sweep on Edge 155, 347 runs: 93/93 test-file crossfades within ±150 ms of the ideal overlap, 0 s via a pre-armed deck (Z2, 11–24 ms), the master fade on schedule, header-less VBR on time by the TRUE duration (22/22). Real music 151/171 after a **seek** — the harness's, not the app's: Chrome seeks a VBR MP3 by its Xing table and `currentTime` stays off the audio. From the start, as the app plays: **25/25**, the 20 failures included, end guard +61…+331 ms. Releases the crossfade loop style and inter-track crossfade (v2.0) |
| **S5** | ✅ **GO** | 2026-10-21 | 40/40 hidden 25-minute runs notified from the worker on time — Edge 155, Chrome 155, Brave and Firefox 158, launched undriven (under Playwright every page reported `visible`, so a driven browser could not answer this). Worker late 9–207 ms; Chromium's tick never past 371 ms, Firefox's up to 3.2 s (three times in ten runs). S2's main-thread stall did not reproduce. Owner's everyday-browser run and click-to-focus outstanding. Releases the finish notification (`04 §2`) |
| **S6** | ❌ **FAIL** | 2026-10-21 | 153 files incl. the owner's 41 masters. A reduced-rate decode under-reads bright material (16 kHz: music 95.2 % within 0.5 LU but worst 1.79 LU; 24 kHz: worst 1.20 LU), and the rate does not bound memory — Chrome decodes at the native rate first, so a 10:02 file peaked at 260–540 MB at every rate. 48 kHz is accurate (≤ 0.18 LU) but 537 MB. Normalisation not built in v2.0; slice-and-accumulate, WebCodecs, or tags-only are the routes (`§S6`, `05 §1`) |
