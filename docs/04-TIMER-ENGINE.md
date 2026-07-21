# 04 — Timer Engine

Suite 1.0 · 2026-07-21

The countdown is the product. It must be correct after hours in a background tab,
under CPU throttling, across pause/resume, and it must render milliseconds smoothly
under 60 s. Design rule: **time is always derived, never accumulated.**

## 1. Core model

```ts
// engine/timer/tt-timer.ts — pure TS, no DOM assumptions beyond Worker/rAF hooks
interface TimerState {
  durationMs: number;
  endAtEpoch: number | null;   // Date.now()-based, authoritative
  remainingAtPauseMs: number | null;
  phase: 'idle' | 'running' | 'paused' | 'done';
}

start(durationMs)  → endAtEpoch = Date.now() + durationMs
tick()             → remaining = max(0, endAtEpoch - Date.now())
pause()            → remainingAtPauseMs = remaining; endAtEpoch = null
resume()           → endAtEpoch = Date.now() + remainingAtPauseMs
```

Why `Date.now()` and not `performance.now()` for the **deadline**: the
authoritative clock is shared between the main thread and the Worker, and
`performance.now()` has a different `timeOrigin` in each context, so an absolute
`endAt` expressed in it would mean two different instants. Trade-off: a system
wall-clock jump (NTP correction, manual change) shifts the deadline.

**Distinguishing a clock jump from a throttling gap.** Comparing only
`Date.now()` deltas cannot tell them apart — both look like "more time passed
than the interval". The fix is to sample **both** clocks on every tick, within
the same context:

```
dWall = Date.now()        - prevWall          // moves with NTP / manual changes
dMono = performance.now() - prevMono          // monotonic, immune to them
skew  = dWall - dMono
```

`performance.now()` is used here **only as a per-context monotonic delta**, never
as a shared absolute — which is exactly what its `timeOrigin` caveat permits.

| Observation | Meaning | Action |
|-------------|---------|--------|
| `dMono` ≫ interval, `\|skew\|` small | Throttling / suspension. Real time genuinely passed | Normal derived tick. **No** `TT-SYS-201` |
| `\|skew\| > 2 s` | Wall clock moved under us | Log `TT-SYS-201`, re-anchor `endAtEpoch` by `skew` so the *remaining* duration is preserved, and the deadline does not jump on screen |

A user who sets the clock forward 5 minutes mid-countdown should still get the
countdown they asked for; re-anchoring by `skew` is what delivers that. Spike S2
case 7 exercises both branches explicitly — `TT-SYS-201` must fire for the clock
change and must **not** fire for a throttling gap of comparable size.

## 2. Tick sources (two, cooperating)

| Source | Interval | Role |
|--------|----------|------|
| **Worker** `tt-timer.worker.ts` | 200 ms `setInterval` | Authoritative progression. Workers are far less throttled than main-thread timers in background tabs (and an actively playing audio element further reduces throttling). Posts `{remaining}`; posts `done` exactly once when it hits 0. |
| **Main thread rAF** | display refresh | Rendering only. Recomputes `remaining` from `endAtEpoch` each frame for smooth ms display. Stops when `document.hidden`; on `visibilitychange` → immediate resync render (derived time makes this exact, not corrective). |

The `done` event (→ End Behavior, `02 §5`) is fired by the Worker so it triggers
even when the tab is hidden; media fade-out runs on the audio graph clock and works
in background.

**Honest caveat — worker throttling is not unconditional.** Chromium's intensive
wake-up throttling of hidden pages reaches their dedicated workers too; the
reliable exemption is the tab being **audible**, not merely having a worker. The
app has documented states that are hidden *and* silent for long stretches:
`02 §5` TT-PLY-102 (repeat off, playlist exhausted → "silence, countdown
continues"), the `endChime: false` / `endFadeMs: 0` combination (`02 §3.3`), and
YouTube mode, where audio comes from a cross-origin iframe and no page-owned
media element exists at all. **Spike S2 cases 3–4 measure exactly these**, and
the number they produce is written back into this section as a stated guarantee.

If that number proves unacceptable, the mitigation is to keep an inaudible
near-zero-gain looping buffer alive whenever the app is in a silent-but-running
state, making the tab audible to the throttler. That would become an engine
invariant here and moves ownership of the silence state to the audio engine —
which is why S2 must settle before P2 begins.

As a defence-in-depth latch independent of worker scheduling, `visibilitychange
→ visible` and `focus` both recompute `remaining` immediately and fire `done` if
it has reached 0 (single-fire, shared with the `§6` sleep path). A late `done` is
recoverable; a missed one is not.

### 🔴 S2 measurements — the silent hidden tab FAILS (Edge 151, Windows 11)

| Case | Hidden for | Worst tick gap | Overshoot at `done` | Verdict |
|------|-----------|----------------|---------------------|---------|
| 2 — hidden **with** audio | 1.4 min | 280 ms | 28 ms | ✅ but too short to reach throttling |
| **3 — hidden and SILENT** | **24.9 min** | **13 min 19 s** | **2 min 57 s** | 🔴 **FAIL — 355× over the ±500 ms bound** |

Case 3 is the measurement this section was written to obtain, and it is bad. A
200 ms worker interval stretched to **798 786 ms** — 3 994× nominal. The mean
hidden interval was only 428 ms, so the worker is not uniformly dead: it runs
fine, then freezes hard for minutes. That is the signature of Chromium's
*intensive* wake-up throttling, which the run confirms it reached.

`|skew|` stayed ≤ 1.7 ms throughout, so this is genuinely lost wall-clock time,
not a clock-jump artefact the `§1` rule should have caught.

**The Wake Lock was granted** — no TT-SYS-202 — and the screen stayed awake
anyway. Wake Lock keeps the display on; it does nothing for timer throttling.
Do not reach for it as a fix.

#### What held, and what did not

The countdown **completed correctly**. `done` fired with `late: true` and logged
TT-SYS-203, and because time is derived rather than accumulated, the value on
return was exact — not 3 minutes wrong, just 3 minutes *late*. The
`visibilitychange`/`focus` latch is what caught it; without that, the worker
would still have been asleep and the user would have found a countdown sitting
at ~3 minutes remaining, never finishing.

So the correctness design held. **Timeliness did not**, and for this product
timeliness is the point: a countdown that announces "Time's up" three minutes
after the fact has failed, and the End Behavior — fade, chime, Finished screen
(`02 §5`) — fires three minutes late with it.

#### Consequence: the keep-alive is now an engine invariant, not a contingency

`15 §S2`'s contingency is promoted to a requirement. **Whenever the app is in a
running-but-silent state, the audio engine must keep an inaudible, near-zero-gain
looping source alive** so the tab counts as audible and keeps its throttling
exemption. The states that need it are already enumerated: `02 §5` TT-PLY-102
(repeat off, playlist exhausted), the `endChime: false` + `endFadeMs: 0`
combination (`02 §3.3`), and YouTube mode, where audio comes from a cross-origin
iframe and there is no page-owned element at all.

This moves ownership of the silent-but-running state into the audio engine, so it
**must be settled before P2 begins** — it is a P2 design input, not a later
optimisation.

⚠️ **Not yet proven: that the keep-alive actually fixes it.** Two variables
changed between the passing and failing runs — audio on→off *and* 1.4→24.9 min
hidden. The failure is established; the remedy is not. The control run is
**case 2 repeated for 30+ minutes with keep-alive ON**. If that also degrades,
the exemption is not what we think it is and the design needs rethinking rather
than a keep-alive bolted on.

Keep the visibility/focus latch regardless. Even with a working keep-alive it is
the only thing standing between a throttled worker and a countdown that never
finishes.

## 3. Wake Lock

`navigator.wakeLock.request('screen')` on entering `playing`; released on
`paused`/`finished`/`setup`. Locks are auto-released when the page hides —
re-acquire on `visibilitychange → visible` while `playing`. Unsupported browser or
rejection → log `TT-SYS-202` once + one-time toast "Your screen may sleep during
the countdown." Never fatal.

## 4. Display formats — **single source of truth**

This table is the only place countdown formats are defined, the way `12 §6` is
the only place log codes are defined. No other chapter restates it; `03 §2` Z3
defers here by reference. `tt-format.ts` implements exactly this and `13 §1`
tests exactly this.

| Remaining | Format | Ghost (03 §1) | Update | Example |
|-----------|--------|---------------|--------|---------|
| ≥ 1 h | `H:MM:SS` | `8:88:88` | 1 Hz, aligned to the second boundary (next timeout = `remaining % 1000`) | `1:24:07` |
| 60 s – 1 h | `MM:SS` | `88:88` | 1 Hz aligned | `09:41` |
| **< 60 s** | `SS.mmm` | `88.888` | every rAF frame | `42.183` |
| 0 | `0.000` held on Finished screen | `88.888` | — | |

Boundaries are **inclusive at the lower edge**: `3_600_000` renders `1:00:00`,
`3_599_999` renders `59:59`, `60_000` renders `01:00`, `59_999` renders `59.999`.
These four values are the unit-test truth table in `§7`.

- Transition into `< 60 s` also switches digit color to `tt-danger` (03 §2).
- DSEG7 is inherently monospaced. The 6%-opacity ghost layer under the digits
  (03 §1) guarantees zero layout shift **within** a format; because the three
  formats differ in glyph count (7 / 5 / 6), the ghost string is **derived per
  format** from the table above — `tt-format.ts` returns the formatted value and
  its ghost together so they cannot drift apart. An `H` hour digit widens past 9
  hours (`10:00:00`, 8 glyphs); the ghost widens with it.
- Countdown input range: 1 s – 24 h. Presets + `Match queue length` in Setup.

## 5. Interaction with media

The timer never drives media position and media never drives the timer. They meet
at exactly two points: `start()` is issued to both on Play, and the Worker's `done`
triggers the media fade. This isolation is what makes both engines independently
unit-testable (Vitest fake timers for the timer; no audio needed).

## 6. Edge cases

| Case | Behavior |
|------|----------|
| Tab hidden across the zero point | Worker fires `done`; fade+chime execute; on return the Finished screen is already correct |
| Worker **throttled** across the zero point (hidden + silent, §2 caveat) | `done` fires late from the worker, or from the `visibilitychange`/`focus` latch on return — whichever is first. Single-fire, so never both. Logged `TT-SYS-203` when the late path wins |
| Wall clock changed mid-countdown | `remaining` is preserved, the deadline is re-anchored by `skew`, `TT-SYS-201` logged (`§1`). The displayed value does not jump |
| System sleep/suspend across zero | On wake, first tick sees `remaining ≤ 0` → immediate `done` (single-fire latch) + `TT-SYS-203` log |
| Pause during `< 60 s` | Frozen `SS.mmm` value displayed; rAF loop idles |
| Countdown longer than total media (Single/Playlist) | Media loops per mode rules (`02 §5`); timer unaffected |
| `done` while media between crossfades | Fade applies to master gain — always correct regardless of A/B element state (`05 §2`) |

## 7. Test hooks

`TtTimer` accepts three injected functions — `now()` (wall, stands in for
`Date.now()`), `mono()` (monotonic, stands in for `performance.now()`) and
`schedule()`. Injecting the two clocks **separately** is what makes `§1`'s
disambiguation testable: a throttling gap advances both by the same amount, a
clock jump advances only `now()`. A suite that drove a single clock would pass
against an implementation that cannot tell them apart.

Unit suite covers: derived remaining under simulated throttle gaps; pause/resume
exactness (±0 ms); single-fire `done` across every path that can emit it (worker,
`visibilitychange` latch, `focus` latch); `TT-SYS-201` fires on skew and **not**
on a same-sized throttling gap; `TT-SYS-203` on sleep-across-zero; and the format
truth table at the `§4` boundaries 3 600 000 / 3 599 999 / 60 000 / 59 999 / 0,
asserting the ghost string alongside the value.
