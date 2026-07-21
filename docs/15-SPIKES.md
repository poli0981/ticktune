# 15 — P0 Validation Spikes

Suite 1.0 · 2026-07-21 (scope rule amended 2026-07-21) · Total budget: ~4 working
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
| S1 | **P4** (YouTube) | throwaway `spike/s1-yt` |
| S2 | **P2** (audio) — but runs *on* the P1 timer engine | the shipping countdown page under `?ttdebug=1` |
| S3 | **P2** (audio/import) | throwaway `spike/s3-metadata` |
| S4 | **P2** (audio) | throwaway `spike/s4-crossfade` |

P1 (scaffold, mobile gate, timer engine, countdown display, settings/Dexie, log)
touches no area a spike covers except the timer, which S2 measures directly. No
audio-engine, importer, or YouTube code is written before S1/S3/S4 pass.

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
- **Contingency if #3/#4 drift is unacceptable:** keep an inaudible
  near-zero-gain looping buffer alive during silence states and declare it an
  engine invariant in `04`. That moves ownership of the silent-but-running state
  into the audio engine and **must be settled before P2** starts.
- **Timebox:** 1 day (long runs can run unattended).

### S2 results

Paste one row per run. `keepAlive` records the oscillator state, since case 3 is
meaningless without it.

| Date | Browser | Case | keepAlive | render gap | tick gap | \|skew\| | overshoot | Verdict |
|------|---------|------|-----------|-----------|----------|--------|-----------|---------|
| 2026-07-21 | Chromium (headless) | 1 visible, 4 s | off | **18 ms** | 202 ms | 0.7 ms | **29 ms** | ✅ smoke — confirms the harness reports sane numbers; not a real S2 run |

Everything below case 1 is still to run — the hidden, minimised, suspended and
clock-change cases all need a human driving a real browser window, which is
exactly why they were never going to be automated.

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
- **Prerequisite:** `scripts/make-fixtures.ts` and ffmpeg. Run
  `scripts/audit-corpus.mjs` first — it reports which acceptance rows the corpus
  on disk can actually exercise.
- **Timebox:** 0.5–1 day.

## S4 — Crossfade + AudioContext unlock (→ `05 §1–2`)

- **Goal:** prove the A/B element crossfade sounds clean (no click/gap), the
  gate-click `resume()` reliably unlocks autoplay, and `timeupdate` scheduling
  margins hold.
- **Method:** two-element graph prototype; fade durations 0 / 1 / 2 / 5 s across
  mp3+flac fixtures; measure actual overlap via Analyser RMS; test
  suspend/resume cycles (Safari included if reachable); verify master-gain fade
  mid-crossfade.
  **Also:** run the same fade schedule against **real VBR MP3s from the `test/`
  corpus**, not only generated fixtures. `05 §2` schedules the crossfade off
  `duration - currentTime ≤ fade`, and `element.duration` is least reliable on
  exactly the kind of file the app targets — VBR MP3s without an Xing/VBRI header,
  where browsers estimate from bitrate and can revise mid-playback. A fixture-only
  spike would never see it.
- **Acceptance:** no audible click at any duration; overlap timing within
  ±150 ms of target **on both generated fixtures and real VBR MP3s**; playback
  never starts before the gesture; master fade behaves mid-crossfade; any
  `duration` revision observed mid-playback is recorded with its magnitude.
- **Timebox:** 0.5–1 day.

## Exit

Each spike's findings are written back into its target chapter (04 / 05 / 06) and
this file gains a ✅/❌ result table. Per the scope rule above, a spike gates its
own area rather than the whole project: S2's result gates P2 and is recorded
against the P1 timer engine it ran on; S1 gates P4; S3 and S4 gate P2
(`16-ROADMAP.md`).

| Spike | Result | Date | Findings written to |
|-------|--------|------|---------------------|
| S1 | 🟡 partial | 2026-07-21 | oEmbed half done — see `tests/manual/yt-matrix.md`. Player/onError half still needs a browser, and the region case needs Vietnam |
| S2 | ⬜ not run | — | `04 §1–2, §6` |
| S3 | ⬜ not run | — | `05 §4–5` |
| S4 | ⬜ not run | — | `05 §1–2` |
