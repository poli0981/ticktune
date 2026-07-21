import type { TtFinishInfo, TtFinishReport, TtSplitDuration } from './types';

/**
 * Late-finish arithmetic — docs/04 §2 option 3, decided 2026-07-21.
 *
 * Spike S2 measured a hidden, silent tab finishing its countdown 2 m 57 s late,
 * and the keep-alive remedy still 52.4 s late. The stall is in main-thread
 * message processing, so no amount of worker code routes around it. The promise
 * was re-scoped instead: the countdown is accurate while visible, best-effort
 * while hidden — the elapsed time is always computed correctly, but the browser
 * may not let the app react until the user returns.
 *
 * The consequence this module exists for: when the app finally reacts, the
 * Finished screen must not imply the moment is now. It states when zero was
 * actually reached, and how long ago.
 *
 * **Deliberately string-free.** It returns numbers and a variant; the component
 * composes the Vietnamese wording and runs Intl (docs/03 §3.5 owns the strings).
 * That keeps the one-way data rule intact (docs/12 §3.3) and lets P5 translate
 * without touching an engine.
 */

/**
 * docs/04 §2 item 2. A judgement call, stated so it can be argued with: one
 * worker interval (200 ms) is invisible and mentioning it would be noise, while
 * anything past a couple of seconds is a discrepancy a user could notice against
 * a wall clock.
 */
export const LATE_THRESHOLD_MS = 2_000;

/**
 * Strictly greater — 2 000 ms exactly is not late.
 *
 * Note what this does NOT consult: `TtFinishInfo.late`. That flag answers a
 * different question — "did the visibility/focus latch fire this instead of the
 * worker?" — and it is routinely true with a sub-second overshoot, on a tab the
 * user simply clicked back to. Keying the screen on it would announce a
 * discrepancy that does not exist. docs/04 §2 says overshoot, only.
 */
export function isLateFinish(overshootMs: number): boolean {
  return overshootMs > LATE_THRESHOLD_MS;
}

/** Whole hours/minutes/seconds of a duration, for "2 phút 57 giây trước". */
export function splitDuration(ms: number): TtSplitDuration {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

/**
 * What the Finished screen renders from.
 *
 * `zeroAtEpoch` is **derived, not carried**: `overshootMs` is already
 * `now() − endAtEpoch`, captured before the deadline is cleared (tt-timer.ts),
 * and `done` propagates synchronously through the driver — so subtracting it
 * from the wall clock read at the top of the handler reconstructs the instant
 * zero was reached, exact to the tick. Adding a field to the timer's payload
 * would change an interface, its whole-object test assertions and the debug
 * panel's props to carry a number two others already imply.
 *
 * @param nowEpoch wall clock read at the START of the done handler. Passed in
 *   rather than read here so the arithmetic stays pure and testable.
 */
export function finishReport(info: TtFinishInfo, nowEpoch: number): TtFinishReport {
  const overshootMs = Math.max(0, Math.round(info.overshootMs));
  return {
    variant: isLateFinish(overshootMs) ? 'late' : 'normal',
    overshootMs,
    zeroAtEpoch: nowEpoch - overshootMs,
    firedByLatch: info.late,
  };
}
