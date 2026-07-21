# 15 — P0 Validation Spikes

Suite 1.0 · 2026-07-21 · Rule: **no feature code before all four spikes pass.**
Each spike is a throwaway branch `spike/s<N>-…` with findings written back into
the referenced doc section. Total budget: ~4 working days.

## S1 — YouTube error matrix & playback chain (→ `06 §2, §4`)

- **Goal:** confirm real-world mapping of onError codes (esp. age-restricted vs
  region-blocked vs embed-disabled), controls rendering at 384×216, and the
  gesture→playVideo chain.
- **Method:** minimal page with one `YT.Player` on youtube-nocookie; curated
  video list (normal / deleted / embed-off / age-restricted / region-blocked-VN);
  drive `loadVideoById` sequence; log every event; test Chromium + Firefox.
  Also probe `/oembed` responses for each id (server-side curl is fine here).
- **Acceptance:** every list entry maps to a documented overlay type with no
  "unknown" bucket; queue of 3 advances hands-free after one initial gesture;
  native controls fully visible at 384×216.
- **Timebox:** 1 day. **Risk if failed:** overlay taxonomy in `06 §4` is
  restructured before any YT UI work.

## S2 — Timer drift, background throttling, Wake Lock (→ `04`)

- **Goal:** measure countdown accuracy with tab hidden for long periods, with
  and without audio playing; verify Worker `done` fires while hidden; verify
  Wake Lock reacquisition.
- **Method:** harness page with the real `tt-timer` core; 30-min and 90-min runs
  in Chromium + Firefox on Windows 11 (i7-14700KF box): tab hidden, window
  minimized, laptop-style sleep/resume simulation (manual sleep on a spare
  machine if available); log tick deltas + drift histogram.
- **Acceptance:** visible-tab error ≤ ±50 ms sustained; hidden-tab error at the
  moment of `done` ≤ ±500 ms with audio playing; sleep-across-zero fires the
  latch on wake (TT-SYS-203 path); no double-`done`.
- **Timebox:** 1 day (long runs can run unattended).

## S3 — music-metadata coverage & Vietnamese tags (→ `05 §4–5`)

- **Goal:** validate `parseBlob` across the real accept-list and the mojibake
  policy against actual Vietnamese-tagged files.
- **Method:** corpus: mp3 (ID3v1-only, v2.3 UTF-16, v2.4 UTF-8), flac, m4a, ogg,
  opus, wav — including files tagged in Vietnamese (own library) and files with
  embedded cover art up to ~5 MB; run through the importer pipeline prototype in
  Chromium + Firefox + (if reachable) Safari; record parse time per file.
- **Acceptance:** all v2/vorbis/mp4 tags render Vietnamese correctly; ID3v1-only
  mojibake triggers the U+FFFD → filename fallback (TT-IMP-007); cover art
  extracted; 95-file batch parses < 10 s total on the dev box.
- **Timebox:** 0.5–1 day.

## S4 — Crossfade + AudioContext unlock (→ `05 §1–2`)

- **Goal:** prove the A/B element crossfade sounds clean (no click/gap), the
  gate-click `resume()` reliably unlocks autoplay, and `timeupdate` scheduling
  margins hold.
- **Method:** two-element graph prototype; fade durations 0 / 1 / 2 / 5 s across
  mp3+flac fixtures; measure actual overlap via Analyser RMS; test
  suspend/resume cycles (Safari included if reachable); verify master-gain fade
  mid-crossfade.
- **Acceptance:** no audible click at any duration; overlap timing within
  ±150 ms of target; playback never starts before the gesture; master fade
  behaves mid-crossfade.
- **Timebox:** 0.5–1 day.

## Exit

Findings PR updates docs 04/05/06 + this file gets a ✅/❌ result table; then P1
begins (`16-ROADMAP.md`).
