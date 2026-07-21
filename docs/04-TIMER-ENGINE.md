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

Why `Date.now()` and not `performance.now()`: the authoritative clock is shared
between the main thread and the Worker, and `performance.now()` has a different
`timeOrigin` in each context. Trade-off: a system wall-clock jump (NTP correction,
manual change) shifts the deadline. Mitigation: each tick compares expected vs
actual delta; if `|drift| > 2 s` between consecutive ticks, log `TT-SYS-201` and
re-anchor smoothly. Spike S2 quantifies real-world behavior.

## 2. Tick sources (two, cooperating)

| Source | Interval | Role |
|--------|----------|------|
| **Worker** `tt-timer.worker.ts` | 200 ms `setInterval` | Authoritative progression. Workers are far less throttled than main-thread timers in background tabs (and an actively playing audio element further reduces throttling). Posts `{remaining}`; posts `done` exactly once when it hits 0. |
| **Main thread rAF** | display refresh | Rendering only. Recomputes `remaining` from `endAtEpoch` each frame for smooth ms display. Stops when `document.hidden`; on `visibilitychange` → immediate resync render (derived time makes this exact, not corrective). |

The `done` event (→ End Behavior, `02 §5`) is fired by the Worker so it triggers
even when the tab is hidden; media fade-out runs on the audio graph clock and works
in background.

## 3. Wake Lock

`navigator.wakeLock.request('screen')` on entering `playing`; released on
`paused`/`finished`/`setup`. Locks are auto-released when the page hides —
re-acquire on `visibilitychange → visible` while `playing`. Unsupported browser or
rejection → log `TT-SYS-202` once + one-time toast "Your screen may sleep during
the countdown." Never fatal.

## 4. Display formats (spec)

| Remaining | Format | Update | Example |
|-----------|--------|--------|---------|
| ≥ 1 h | `H:MM:SS` | 1 Hz, aligned to the second boundary (next timeout = `remaining % 1000`) | `1:24:07` |
| 60 s – 1 h | `MM:SS` | 1 Hz aligned | `09:41` |
| **< 60 s** | `SS.mmm` | every rAF frame | `42.183` |
| 0 | `0.000` held on Finished screen | — | |

- Transition into `< 60 s` also switches digit color to `tt-danger` (03 §2).
- DSEG7 is inherently monospaced; the 6%-opacity "888" ghost layer under the digits
  (03 §1) guarantees zero layout shift across all formats.
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
| System sleep/suspend across zero | On wake, first tick sees `remaining ≤ 0` → immediate `done` (single-fire latch) + `TT-SYS-203` log |
| Pause during `< 60 s` | Frozen `SS.mmm` value displayed; rAF loop idles |
| Countdown longer than total media (Single/Playlist) | Media loops per mode rules (`02 §5`); timer unaffected |
| `done` while media between crossfades | Fade applies to master gain — always correct regardless of A/B element state (`05 §2`) |

## 7. Test hooks

`TtTimer` accepts injected `now()` and `schedule()` fns. Unit suite covers: derived
remaining under simulated throttle gaps, pause/resume exactness (±0 ms), single-fire
`done`, drift re-anchor logging, format function truth table (including boundary
values 3 600 000, 60 000, 59 999, 0).
