# 05 — Audio Engine (local modes)

Suite 2.0 · 2026-10-21

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
  **Not even one at a time, for analysis** — `15 §S6` (v2.0) measured a single
  10:02 file peaking at 260–540 MB whatever `OfflineAudioContext` rate it was
  decoded to, because the decode happens at the file's native rate first; and a
  reduced rate under-reads bright material by up to 1.8 LU. Loudness
  normalisation therefore waits for a sliced or streaming decoder.
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
- `AudioContext` is created **lazily** — `playback.#ensure()` builds the driver
  on the first unlock, load, play or cover import, never at boot — and is
  `resume()`d only on a user gesture.
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
safety margin — measured, and the constants fixed, by spike S4b: below).

Two clamps the trigger rule needs and did not state:

- `effectiveFadeMs = min(fadeMs, durationMs / 2)` — a 5 s fade on a 5 s file
  would otherwise start before playback reached steady state.
- No known length — neither the importer's nor the element's — **disables** the
  fade trigger and falls through to `ended`. This is the VBR-MP3 hazard S4b
  measured; the importer's length comes first (below).

Single-mode loop styles (03 §2 rail): **hard** = `element.loop = true` (default,
tightest gap) · **crossfade** = same file loaded on both elements, A↔B fade.

⚠️ **`element.loop = true` fires no `ended` event.** It seeks to 0 and keeps
going, so nothing edge-triggers on a wrap. The Z4 "Loop ×N" counter
(`03 §2`) is therefore derived from a **`currentTime` regression** observed
across the ~4 Hz `timeupdate` — a decrease of more than half the duration counts
as a wrap, which distinguishes it from a user seek. Anything written against
`ended` for the hard-loop path is dead code.

**Shipped in v2.0, released by spike S4b** (`15 §S4b`, PASS 2026-10-20). The
engine is two decks with a state machine (`tt-audio-engine.ts`); the decisions
are pure (`tt-crossfade.ts` — the module S4b measured, moved in unchanged):

- **Trigger** on each `timeupdate` of the ACTIVE deck: fire when
  `remaining ≤ effFade + margin`, `effFade = min(fade, D_out/2, D_in/2)`; the
  curves start at once (latency 0) and run for `min(effFade, remaining − guard)`.
  Margin **0.3 s**, guard **0.03 s**; below **0.25 s** a fade is a hard cut.
- **Duration** is the importer's, `element.duration` only when none is known
  (`triggerDurationS`). The importer scans the whole file when the headers do
  not carry a length (`05 §5`): S4b showed the element's estimate never firing
  on header-less VBR and firing 0.2–0.5 s early on raw ADTS. No length at all →
  no crossfade, **TT-PLY-106** once, `ended` takes over.
- **Armed ahead**: the idle deck loads what comes next 8 s before the trigger,
  silent — every passing S4b run used it. The shell keeps `next` current from
  `session.peekNext()`, whose shuffled wrap is decided once and kept, so the
  track faded into is the track the queue then plays.
- **Exactly one advance.** The transition is real when the incoming deck's
  `play()` resolves: the decks swap roles and the shell hears `onCrossfade`,
  once. Every event — `timeupdate`, `ended`, `error` — names its deck, and any
  but the active deck's is dropped: the fading track's own `ended` would
  otherwise skip one. An incoming deck that will not play leaves the outgoing
  one at full level; `ended` advances, once (**TT-PLY-108**).
- **Pause mid-fade** holds both curves where they are (`cancelAndHoldAtTime`;
  Firefox's two-call fallback), ramps them to zero over 15 ms and pauses the
  elements 45 ms later; resume ramps back and runs the REST of the same curves.
  `pause()` on a playing element is a step — 6–8 clicks a run without the ramp.
- **Every load goes to the deck that is not sounding**, and the old one is
  ramped out the same 15 ms before it pauses: `setSrc` on a playing element was
  the click on every ⏭. With the next track already armed, the switch at `ended`
  is S4b's **Z2**: 11–24 ms. A 0 s setting uses exactly that.
- **The master fade** at zero sits after both decks (`userGain → fadeGain`), so
  a countdown that ends mid-crossfade fades both — S4b measured it on schedule.
- **Zero ends "next".** The shell tells the engine what comes next only while
  the player screen is up, so from zero nothing is armed or faded in under the
  End Behavior's fade-out. Without that gate the next track would begin,
  inaudibly, under the fade, and the engine's track would move while the queue
  — correctly — did not (`crossfade.spec.ts` turns red on exactly that). A loop
  crossfade is the track's own and may still run; it is faded out with
  everything else.
- **Media URLs** go when no deck holds their track any more; a loop crossfade
  is one file, one URL, on both decks (`§3`).

**Single-mode loop styles** (`03 §2` rail, Settings → Audio): `hard` keeps
`element.loop = true`; `crossfade` lets the element reach its end and fades the
track into itself on the other deck, counting the pass at the swap. A loop
crossfade that cannot fade loops by hand at `ended`; at a 0 s setting it is the
hard loop.

> **History — the gate, and the silent fallback before it.** From P2 to v1.1
> the crossfade loop style was not shipped: a stored `'crossfade'` played as a
> hard cut, announced by **TT-SYS-205** and, from P5 slice 2, in words on the
> rail. Through P2 that notice was itself missing — nothing read
> `singleLoopStyle` and the load passed a literal `true` — the same failure
> shape as `coverArtUrl`: a documented behaviour whose absence is
> indistinguishable from correctness. TT-SYS-205 is retired (`12 §6`).

What S4b's PASS does **not** cover: a seek in a VBR MP3 — Chrome places it by
the Xing table and `currentTime` stays up to a second off the audio. The app has
no seek control; adding one means re-deriving the remaining time or measuring
again (`15 §S4b`).

## 3. Object URL lifecycle

`URL.createObjectURL(file)` lazily at first play of a track; revoked on: track
removal, queue clear, `pagehide`, and when a track leaves the A/B pair. Cover-art
blob URLs are created at import (needed by the queue UI) and revoked on removal.

Invariant: at most `queueLength + 2` live object URLs; a debug assert counts them.
`queueLength` is the **local shelf's** (`02 §3.5`): covers belong to files, and
the files stay staged while the YouTube tab shows its links.
The arithmetic, made explicit because the implementation has to reproduce it:
**≤ 2 media URLs** — the A/B pair, and the crossfade-loop style shares *one* URL
across both decks because it is the same file — **plus ≤ `queueLength` cover
URLs**, one per imported track. A media URL is therefore keyed per *track*, not
per deck; keying it per deck breaks the bound the moment a crossfade loop starts.

The fallback duration probe (`§5`) creates a transient URL of its own,
**outside** the ledger: it never outlives the probe, so counting it against the
bound would only blur the leak canary. It is revoked when the probe settles —
on `loadedmetadata`, on `error`, or at its 5 s guard, whichever comes first,
exactly once — so a file that never answers cannot leak one.

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

`music-metadata@12` `parseBlob(file)` in the browser:

- Read: `common.title/artist/album/year/genre/track` + `format.container/codec/
  bitrate/sampleRate/numberOfChannels/duration`.
- **`format.duration` from `parseBlob` is authoritative** — for the `02 §4`
  TT-IMP-002 cap, for display and, since v2.0, for the crossfade trigger
  (`§2`). The `loadedmetadata` element probe is a **fallback**, used only when
  the parse yields no duration. That ordering is the cheap one, not merely the
  tidy one: S3 measured `parseBlob` at a median 11 ms per file, while the probe
  costs an object URL, a media-element load and a network-free but still
  asynchronous decode of the container header.
- **No header, no length — so the file is scanned** (v2.0). A VBR MP3 without a
  Xing/VBRI header and raw ADTS give `parseBlob` nothing to read a length from,
  and the element probe this used to fall to is an estimate — seconds off on
  header-less VBR, which broke the 10:02 cap and, measured by S4b, the
  crossfade trigger. Those files are parsed again with `{ duration: true }`:
  exact on header-less VBR, +21 ms on ADTS, about 3 ms per second of audio
  (S4b's fixtures). A file whose headers carry a length never pays for it.
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
- Canvas sized to CSS px × `min(devicePixelRatio, 2)`, and since v2.0 to no more
  than 1440p's pixel count (`backingScale()`); renders only when visible
  and not reduced-motion; skips frames if the frame budget is exceeded twice
  in a row (adaptive degrade).

  **The pixel cap is the render-cost probe's finding** (`13 §5`). With no GPU,
  every frame of a full-window canvas crosses the CPU, and at 4K that cost
  33 ms a frame under a 6× CPU throttle, and the visualizer still drew every
  frame — the degrade below never saw it, because the cost is in getting the
  canvas to the screen, after the draw calls it times. A background element gains
  nothing from more pixels than a 1440p screen has; at 1440p and below nothing
  changed.

  **Two details P5 slice 4 had to decide, because this line does not:**

  - **What is measured is this component's OWN work**, not the gap between
    frames. The gap is the wrong number: a page running at 30 fps for reasons
    that have nothing to do with the visualizer reports 33 ms every frame, and
    it would degrade itself forever in response to someone else's cost.
  - **Recovery is asymmetric.** Two consecutive overruns to degrade, one frame
    under budget to recover fully. Symmetric hysteresis would leave a machine
    that hiccuped once permanently worse.

  Both live in `tt-visualizer.ts` as a pure function over `(lastFrameMs,
  strikes)`, so the rule is unit-tested rather than eyeballed on a fast laptop.
  **Whether the budget is actually met on real hardware is P7's** (`13 §5`) —
  P5 owes the path, not the number.
- Beat energy (low-band average) also drives the tally-light pulse (03 §1) — so
  even `Visualizer: off` keeps one live beat element. ✅ **Shipped in P5 slice 4**
  (P2 shipped the static two-state dot, as this line promised).

  **That sentence shaped the implementation.** The beat is published by the
  visualizer component on every analyser frame *before* the style is consulted,
  and the component still mounts (drawing nothing) at `Visualizer: off`. Putting
  the publish inside the draw path would have been the obvious arrangement and
  would have made "off" silently kill the tally — a defect nothing else in the
  app would have noticed, because the light would simply have stopped moving.
  The E2E asserts the pulse **at the `off` setting** for that reason.
- **Unavailable in YouTube mode** (cross-origin media, no Analyser access) — a
  hard platform limit, stated in Settings → Visualizer. Z1 shows the generated
  gradient; nothing is derived from the video's thumbnail (`03 §5`, `06 §1`).

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
Safari quirks, chime timing) → Playwright fixtures produced by
`scripts/make-fixtures.ts`, committed: ~5 s generated tones in seven containers
(mp3, flac, opus, m4a, oga, webm, wav) plus tag and cover cases. Full matrix in
`13-TESTING.md`.
