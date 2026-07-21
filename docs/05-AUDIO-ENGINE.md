# 05 — Audio Engine (local modes)

Suite 1.0 · 2026-07-21

Applies to Single and Playlist modes. YouTube playback is a separate engine
(`06-YOUTUBE-INTEGRATION.md`) — the two never run simultaneously.

## 1. Graph

```
elementA ─ MediaElementSource ─ gainA ─┐
                                       ├─ masterGain ─ Analyser ─ destination
elementB ─ MediaElementSource ─ gainB ─┘
```

- Two `HTMLAudioElement`s (A/B) enable gapless-ish transitions and crossfade.
  Streaming via media elements — **never** `decodeAudioData` full tracks
  (a 10-min stereo track ≈ 200 MB as Float32 AudioBuffer; ×95 is impossible).
- `masterGain` is the single point for volume, mute, and the End-Behavior fade —
  which is why the fade is always correct mid-crossfade (`04 §6`).
- `AudioContext` is created at boot but `resume()`d only on the legal-gate Accept
  click (the autoplay-unlock gesture, `02 §1`). Also `resume()` guard before every
  Play — covers Safari's stricter re-suspension.

## 2. Crossfade

Equal-power curves via `setValueCurveAtTime` (or ramped `linearRampToValueAtTime`
pairs): `gainOut = cos(t·π/2)`, `gainIn = sin(t·π/2)`. Duration 0–5 s, Settings
default **2 s**; `0` = hard cut. Trigger point: `timeupdate` where
`duration - currentTime ≤ fade` (throttled event ≈ 4 Hz → schedule with 300 ms
safety margin; exact behavior validated in Spike S4).

Single-mode loop styles (03 §2 rail): **hard** = `element.loop = true` (default,
tightest gap) · **crossfade** = same file loaded on both elements, A↔B fade.

## 3. Object URL lifecycle

`URL.createObjectURL(file)` lazily at first play of a track; revoked on: track
removal, queue clear, `pagehide`, and when a track leaves the A/B pair. Cover-art
blob URLs are created at import (needed by the queue UI) and revoked on removal.
Invariant: at most `queueLength + 2` live object URLs; a debug assert counts them.

## 4. Format support (accept list × engines)

| Container/codec | Chromium | Firefox | Safari | Notes |
|-----------------|----------|---------|--------|-------|
| MP3 | ✅ | ✅ | ✅ | |
| M4A/AAC | ✅ | ✅ | ✅ | |
| FLAC | ✅ | ✅ | ✅ | |
| WAV | ✅ | ✅ | ✅ | |
| OGG/Vorbis | ✅ | ✅ | ⚠️ recent Safari only | |
| Opus (.opus/.ogg/.webm) | ✅ | ✅ | ⚠️ caf-only historically | |

Import step 1 (`02 §4`) combines the extension allow-list with a live
`canPlayType()` probe, so Safari users get an honest `TT-IMP-001` rejection instead
of a broken track. Matrix re-verified during Spike S3.

## 5. Metadata extraction

`music-metadata@11` `parseBlob(file)` in the browser:

- Read: `common.title/artist/album/year/genre/track` + `format.container/codec/
  bitrate/sampleRate/numberOfChannels/duration`.
- Cover art: first `common.picture` → `Blob` → object URL (§3 lifecycle).
- "Composition date" (spec) does not exist as a reliable tag — `year` (release) is
  what tags carry; absent → `N/A` per the fallback rule.
- **Vietnamese tags** — measured 2026-07-21 by spike S3 (`/spike/s3-metadata`,
  Chromium, generated fixture matrix):

  | Tag container | Vietnamese round-trip |
  |---------------|-----------------------|
  | ID3v2.3, encoding byte `0x01` (UTF-16 + BOM) | ✅ exact, diacritics intact |
  | ID3v2.4, encoding byte `0x03` (UTF-8) | ✅ exact |
  | Vorbis comment | ✅ exact |
  | MP4 / iTunes atom | ✅ exact |
  | **ID3v1** | ❌ corrupted, and **silently** — see below |

  Prefer v2 frames when both exist; music-metadata already does.

  ### ⚠️ The U+FFFD detection rule does not work — replaced

  This section used to say: "if the decoded string contains U+FFFD replacement
  chars, fall back to the file name and log `TT-IMP-007`". **S3 falsified that.**

  `Nắng ấm xa dần — Đường về nhà` written into an ID3v1 tag comes back as
  `N¯ng ¥m xa d§n  °Ýng vÁ nhà` — wrong, but containing **zero** U+FFFD. ID3v1
  has no charset field, so music-metadata decodes it as ISO-8859-1, where every
  byte 0x00–0xFF maps to *some* valid character. A replacement char is never
  produced, the rule never fires, and the mojibake reaches the UI looking like a
  legitimately odd title.

  **Normative rule instead** — a tag is unreliable when *both* hold:

  ```ts
  const onlyV1 = tagTypes.length > 0 && tagTypes.every((t) => t === 'ID3v1');
  const nonAscii = (v?: string) => !!v && [...v].some((c) => c.codePointAt(0)! > 0x7f);
  const unreliable = onlyV1 && (nonAscii(title) || nonAscii(artist));
  ```

  Pure-ASCII ID3v1 is unambiguous and must be **kept** — most Western files are
  exactly that, and discarding their titles would be a regression. Only the
  non-ASCII case is unrecoverable, because the original encoding is recorded
  nowhere. When `unreliable`: fall back to the file name and log `TT-IMP-007`.

  Keep the U+FFFD check too — it still catches genuinely broken UTF-8 in v2
  frames, which is a different failure with the same symptom.

  Fixture caveat worth remembering: ffmpeg's mp3 muxer writes an empty ID3v2 tag
  unless given `-id3v2_version 0`, which made the first "ID3v1-only" fixture
  report `['ID3v2.4','ID3v1']`. A rule keyed on `tagTypes` would have silently
  never fired against it (`scripts/make-fixtures.ts`).

- **Parse cost — measured on the real corpus, S3 PASS.** 103 files / 598 MB
  (1–15 MB each, mostly 320 kbps) in **1 362 ms** total on Edge 151, against the
  `13 §1` budget of 10 s for 95 files. Per file: median 11 ms, p95 16 ms.

  The 246 ms outlier is the *first* file — one-time engine warm-up, not size:
  the 15 MB file with 7.26 MB of embedded art parsed in 24 ms. Excluding it,
  102 files took 1 116 ms. Worth knowing because a naive reading blames file
  size and starts optimising the wrong thing.

  Sequential parsing, as `02 §4` specifies. No need to parallelise.

- **Cover art:** extracted from 25/103 files, largest **7.26 MB** — comfortably
  above the ~5 MB `15 §S3` asked about, on a real file rather than a synthetic
  one. No failures.

- **Tag containers found in the wild** (103-file corpus), which is wider than
  this chapter previously assumed:

  | tagTypes | Files |
  |----------|-------|
  | `ID3v2.3` | 46 |
  | `ID3v2.3` + `ID3v1` | 27 |
  | *(none at all)* | 14 |
  | `ID3v2.4` | 12 |
  | **`ID3v2.2`** | 2 |
  | `ID3v2.3` + **`APEv2`** + `ID3v1` | 1 |
  | `ID3v1` only | 1 |

  **ID3v2.2** (3-character frame ids) and **APEv2** both occur and were never
  mentioned here. music-metadata handles both transparently, so no code change
  follows — but the `onlyV1` rule above is written against `tagTypes` and must
  keep treating any non-ID3v1 entry as sufficient reason to trust the tag.

  14 files carry **no tags at all** and 17 have no title: the file-name fallback
  is the common path, not an edge case. It gets exercised on ~16% of a real
  library.

- **The `onlyV1` rule does not false-positive.** Across all 103 real files:
  0 U+FFFD, 0 flagged unreliable, 0 parse errors. Non-ASCII titles round-tripped
  correctly through ID3v2.3 in Chinese (`梦中的你`), Korean
  (`안녕, 스타벅스`) and Cyrillic (`Маланхит`) — so the v2 path is sound for
  non-Latin scripts generally, not just Vietnamese.
- Parse failure ≠ import failure: file-name title, `N/A` elsewhere (`TT-IMP-006`).

## 6. Visualizer

- `AnalyserNode` `fftSize 2048`, `smoothingTimeConstant 0.8`;
  `getByteFrequencyData` per frame.
- Styles: **bars** (64 log-spaced bins, mirrored), **wave** (time-domain polyline),
  **ring** (radial bars orbiting the countdown — the signature look).
- Canvas sized to CSS px × `min(devicePixelRatio, 2)`; renders only when visible
  and not reduced-motion; skips frames if the frame budget is exceeded twice
  in a row (adaptive degrade).
- Beat energy (low-band average) also drives the tally-light pulse (03 §1) — so
  even `Visualizer: off` keeps one live beat element.
- **Unavailable in YouTube mode** (cross-origin media, no Analyser access) —
  UI substitutes thumbnail-blur + slow gradient drift; this is a hard platform
  limit, documented to the user in the FAQ.

## 7. End-behavior chime

`public/audio/chime.opus` — a self-made two-note synth chime (generated in the
repo by `scripts/make-chime.ts`, committed as CC0) so no third-party audio rights
enter the project. Played through a separate one-shot element at fixed −6 dB,
bypassing `masterGain` (which is mid-fade at that moment).

## 8. Test strategy

Pure logic (crossfade curve math, trigger scheduling, URL-lifecycle accounting,
fallback rules) → Vitest with mocked elements. Real-audio behavior (gapless-ness,
Safari quirks, chime timing) → Playwright fixtures: three ~5 s generated tones
(mp3/flac/opus) produced by `scripts/make-fixtures.ts`, committed. Full matrix in
`13-TESTING.md`.
