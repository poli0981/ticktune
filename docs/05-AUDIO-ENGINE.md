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
- **Vietnamese tags:** ID3v2.3/2.4 with UTF-16/UTF-8 render correctly; legacy ID3v1
  is charset-less and Vietnamese text is frequently mojibake. Policy: prefer v2
  frames when both exist (music-metadata does by default); if the decoded string
  contains U+FFFD replacement chars, fall back to the file name and log
  `TT-IMP-007`. Real-file validation is Spike S3's core.
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
