# 05 — Audio Engine (local modes)

Suite 1.0 · 2026-07-21

Applies to Single and Playlist modes. YouTube playback is a separate engine
(`06-YOUTUBE-INTEGRATION.md`) — the two never run simultaneously.

## 1. Graph

```
elementA ─ MediaElementSource ─ gainA ─┐
                                       ├─ userGain ─ fadeGain ─ Analyser ─ destination
elementB ─ MediaElementSource ─ gainB ─┘

chimeOsc ×2 ─ chimeGain ─────────────────────────────► destination   (§7, bypasses both)
```

- Two `HTMLAudioElement`s (A/B) enable gapless-ish transitions and crossfade.
  Streaming via media elements — **never** `decodeAudioData` full tracks
  (a 10-min stereo track ≈ 200 MB as Float32 AudioBuffer; ×95 is impossible).
- **Two master-stage nodes, not one.** `userGain` owns volume and mute;
  `fadeGain` owns the End-Behavior fade and nothing else.

  This was a single `masterGain` until P2, and that is a **runtime crash**, not a
  style preference: Web Audio rejects any automation event scheduled inside an
  active `setValueCurveAtTime` window with `NotSupportedError`, and
  `AudioParam.value = x` is specified as `setValueAtTime(x, currentTime)` — so it
  throws too. With the default `endFadeMs: 2_000` (`02 §3.1`), a user pressing
  `M` or `↑` during the end fade would crash the End Behavior. Separate nodes
  make the collision impossible rather than something to remember to handle.

  `04 §6`'s guarantee is unchanged — *"the fade applies to the master stage,
  always correct regardless of A/B element state"* — because `fadeGain` is still
  downstream of both deck gains.
- `cancelScheduledValues(ctx.currentTime)` precedes every `fadeGain` write, which
  Restart / Back-during-fade needs anyway (`02 §3.3`).
- `AudioContext` is created at boot but `resume()`d only on a user gesture.
  **Three call sites, not one:** the legal-gate Accept click (`02 §1`), the Setup
  Start button, and the bottom-bar play button. The gate alone is not enough —
  it only renders when the stored `legalAccepted.version` differs
  (`02 §3.1`), so every *returning* user would otherwise reach playback with a
  suspended context. `resume()` must be called **synchronously inside** the
  gesture handler, before any `await`, or WebKit does not count it as a gesture.
  `play()` additionally guards `ctx.state !== 'running'` — Safari re-suspends.
- A `play()` rejected by the autoplay policy logs **TT-PLY-100** and leaves the
  engine in a `blocked` state that the UI shows. It never reports "playing".

## 2. Crossfade

Equal-power curves via `setValueCurveAtTime` (or ramped `linearRampToValueAtTime`
pairs): `gainOut = cos(t·π/2)`, `gainIn = sin(t·π/2)`. Duration 0–5 s, Settings
default **2 s**; `0` = hard cut. Trigger point: `timeupdate` where
`duration - currentTime ≤ fade` (throttled event ≈ 4 Hz → schedule with 300 ms
safety margin; exact behavior validated in Spike S4).

Two clamps the trigger rule needs and did not state:

- `effectiveFadeMs = min(fadeMs, durationMs / 2)` — a 5 s fade on a 5 s file
  would otherwise start before playback reached steady state.
- A non-finite or unknown `element.duration` **disables** the fade trigger and
  falls through to `ended`. This is the VBR-MP3 hazard S4 exists to measure.

Single-mode loop styles (03 §2 rail): **hard** = `element.loop = true` (default,
tightest gap) · **crossfade** = same file loaded on both elements, A↔B fade.

⚠️ **`element.loop = true` fires no `ended` event.** It seeks to 0 and keeps
going, so nothing edge-triggers on a wrap. The Z4 "Loop ×N" counter
(`03 §2`) is therefore derived from a **`currentTime` regression** observed
across the ~4 Hz `timeupdate` — a decrease of more than half the duration counts
as a wrap, which distinguishes it from a user seek. Anything written against
`ended` for the hard-loop path is dead code.

**Crossfade status:** as of 2026-07-21 the crossfade loop style is **not
shipped** — `15 §S4b` has not recorded overlap timing, so the scheduling above is
unvalidated. P2 ships `hard` only; the toggle renders disabled, and a stored
`singleLoopStyle: 'crossfade'` (which `clampSettings` accepts) falls back to
`hard` with a one-time notice rather than silently.

## 3. Object URL lifecycle

`URL.createObjectURL(file)` lazily at first play of a track; revoked on: track
removal, queue clear, `pagehide`, and when a track leaves the A/B pair. Cover-art
blob URLs are created at import (needed by the queue UI) and revoked on removal.

Invariant: at most `queueLength + 2` live object URLs; a debug assert counts them.
The arithmetic, made explicit because the implementation has to reproduce it:
**≤ 2 media URLs** — the A/B pair, and the crossfade-loop style shares *one* URL
across both decks because it is the same file — **plus ≤ `queueLength` cover
URLs**, one per imported track. A media URL is therefore keyed per *track*, not
per deck; keying it per deck breaks the bound the moment a crossfade loop starts.

The fallback duration probe (`§5`) creates a transient URL of its own. It goes
through the same ledger and is released in a `finally`, so a probe that throws
cannot leak one.

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
- **`format.duration` from `parseBlob` is authoritative** — for the `02 §4`
  TT-IMP-002 cap and for display. The `loadedmetadata` element probe is a
  **fallback**, used only when the parse yields no duration. That ordering is
  the cheap one, not merely the tidy one: S3 measured `parseBlob` at a median
  11 ms per file, while the probe costs an object URL, a media-element load and
  a network-free but still asynchronous decode of the container header.
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
  even `Visualizer: off` keeps one live beat element. **Deferred to P5 with the
  rest of the visualizer:** P2 ships the tally as a static two-state dot (idle
  `tt-muted` / playing `tt-danger`). Stated here so the P2 Player screen does not
  read as having dropped it.
- **Unavailable in YouTube mode** (cross-origin media, no Analyser access) —
  UI substitutes thumbnail-blur + slow gradient drift; this is a hard platform
  limit, documented to the user in the FAQ.

## 7. End-behavior chime

**Synthesised at runtime — TickTune ships no audio file at all.** Two
`OscillatorNode`s with a decaying envelope, through a dedicated `chimeGain`
straight to `destination`, bypassing both `userGain` and `fadeGain` (the latter
is mid-fade at that moment, §1). Fixed peak gain **0.501 linear (≈ −6 dB)**. It
**respects `muted`** — a muted app stays silent — but does **not** scale with
`volume`, because it is an attention signal, not program material.

Fires at zero + `endFadeMs`, scheduled on the audio clock in the same synchronous
block as the fade (`02 §5`). Failure — the only realistic one being a context
that is not `running` — logs **TT-PLY-103** and schedules nothing. It is never
silent-and-unreported (`01 §2` principle 5).

This replaces `public/audio/chime.opus` + `scripts/make-chime.ts`, which were
specified but never built. Four reasons converged, recorded so the asset does not
come back:

1. `05 §4` marks Opus ⚠️ on Safari, a supported target, and no spike exercises
   opus *playback* — S3 is `parseBlob` only, S4 is mp3+flac. That is the open
   🟡 audit finding, and synthesis closes it by deleting its subject.
2. `scripts/guard-no-corpus.mjs` rejects **any** tracked audio outside
   `tests/e2e/fixtures/`. Shipping the asset meant widening the one script whose
   banner says "widen deliberately — do not bypass".
3. `16 §P2`'s exit criterion is "fade+chime works with the tab **hidden**". A
   network fetch at the instant the tab is most likely throttled is the weakest
   link in that chain; scheduled oscillators have no such link.
4. It removes the CC0 provenance paragraph from
   `legal/THIRD-PARTY-NOTICES.md` and lets it make the stronger, simpler claim.

⚠️ **This is not, and must never become, the keep-alive source of `04 §2`.** That
remedy was measured — twice — and withdrawn. The chime is a bounded two-note
one-shot at zero; anything that keeps a source alive to make the tab audible is
the withdrawn design wearing this section as a disguise.

## 8. Test strategy

Pure logic (crossfade curve math, trigger scheduling, URL-lifecycle accounting,
fallback rules) → Vitest with mocked elements. The pure/impure split is a naming
**contract**, not a convention: `vitest.config.ts` excludes exactly
`*.worker.ts` and `*-driver.ts` from the `src/app/engine/` coverage gate, so a
module under `engine/` that reaches for a browser global is misnamed rather than
untestable, and every *decision* a driver makes belongs in a pure sibling.

⚠️ Two acceptance properties are **not** reachable from Playwright and must be
unit tests against fakes: "playback never starts before the gesture" and the
TT-PLY-100 blocked path. Measured 2026-07-21 — Playwright's default Chromium
launches with `--autoplay-policy=no-user-gesture-required`, so the context is
already `running` before any click. What Playwright *can* prove, and what the
`13 §3` single-mode spec therefore asserts, is that the graph carries signal:
peak Analyser RMS > 0. (Headless Chromium's `--mute-audio` mutes the output
device only; the graph still runs — also measured.)

 Real-audio behavior (gapless-ness,
Safari quirks, chime timing) → Playwright fixtures: three ~5 s generated tones
(mp3/flac/opus) produced by `scripts/make-fixtures.ts`, committed. Full matrix in
`13-TESTING.md`.
