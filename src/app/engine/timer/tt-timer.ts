import type { TimerState, TtTimerHooks, TtTimerPhase } from './types';

/**
 * The countdown core — docs/04.
 *
 * Pure TypeScript: no DOM, no Svelte, no globals beyond the two injected
 * clocks. That is what lets the whole of docs/13 §1 run in Node under Vitest
 * with no browser (docs/01 §3), and the ESLint zone rule in docs/12 §3.1
 * enforces it.
 *
 * The one rule everything else follows from: **time is derived, never
 * accumulated** (CLAUDE.md invariant 3). `remaining` is always
 * `endAtEpoch - now()`. No counter is ever incremented by an interval, so a
 * throttled, suspended or simply late tick cannot make the countdown wrong —
 * it can only make it update later.
 */

/** Wall-clock movement beyond this is treated as a clock change, docs/04 §1. */
export const DRIFT_THRESHOLD_MS = 2_000;

export class TtTimer {
  #durationMs = 0;
  #endAtEpoch: number | null = null;
  #remainingAtPauseMs: number | null = null;
  #phase: TtTimerPhase = 'idle';

  /** Previous samples of both clocks, for the §1 skew comparison. */
  #prevWall: number | null = null;
  #prevMono: number | null = null;

  /** docs/04 §6 — `done` must fire exactly once, from whichever path is first. */
  #doneFired = false;

  readonly #now: () => number;
  readonly #mono: () => number;
  readonly #hooks: TtTimerHooks;

  constructor(hooks: TtTimerHooks = {}) {
    this.#hooks = hooks;
    this.#now = hooks.now ?? (() => Date.now());
    this.#mono =
      hooks.mono ??
      (typeof performance !== 'undefined' ? () => performance.now() : () => Date.now());
  }

  get state(): Readonly<TimerState> {
    return {
      durationMs: this.#durationMs,
      endAtEpoch: this.#endAtEpoch,
      remainingAtPauseMs: this.#remainingAtPauseMs,
      phase: this.#phase,
    };
  }

  get phase(): TtTimerPhase {
    return this.#phase;
  }

  /** Derived on every call — never read from a counter. */
  get remainingMs(): number {
    if (this.#phase === 'paused') return this.#remainingAtPauseMs ?? 0;
    if (this.#phase === 'done') return 0;
    if (this.#endAtEpoch === null) return this.#durationMs;
    return Math.max(0, this.#endAtEpoch - this.#now());
  }

  start(durationMs: number): void {
    this.#durationMs = durationMs;
    this.#endAtEpoch = this.#now() + durationMs;
    this.#remainingAtPauseMs = null;
    this.#phase = 'running';
    this.#doneFired = false;
    this.#prevWall = null;
    this.#prevMono = null;
  }

  pause(): void {
    if (this.#phase !== 'running') return;
    this.#remainingAtPauseMs = this.remainingMs;
    this.#endAtEpoch = null;
    this.#phase = 'paused';
    this.#prevWall = null;
    this.#prevMono = null;
  }

  resume(): void {
    if (this.#phase !== 'paused') return;
    // Re-anchored from the stored remainder, so pause/resume is exact to the
    // millisecond regardless of how long the pause lasted (docs/04 §7).
    this.#endAtEpoch = this.#now() + (this.#remainingAtPauseMs ?? 0);
    this.#remainingAtPauseMs = null;
    this.#phase = 'running';
  }

  reset(): void {
    this.#endAtEpoch = null;
    this.#remainingAtPauseMs = null;
    this.#phase = 'idle';
    this.#doneFired = false;
    this.#prevWall = null;
    this.#prevMono = null;
  }

  /**
   * Advance one step. Safe to call at any cadence, from any context, as often
   * or as rarely as you like — the result is derived, so a 10-minute gap
   * produces the same answer a 200 ms one would.
   *
   * @param late marks a tick known to be a recovery path (visibility/focus
   *   latch, or the first tick after a suspend), so a `done` fired here is
   *   reported as late and logged TT-SYS-203.
   */
  tick(late = false): number {
    if (this.#phase !== 'running') return this.remainingMs;

    this.#detectClockJump();

    const remaining = this.remainingMs;
    this.#hooks.onTick?.(remaining);

    if (remaining <= 0) this.#fireDone(late);
    return remaining;
  }

  /**
   * Distinguishes a wall-clock change from a throttling gap — docs/04 §1.
   *
   * Both look identical through `Date.now()` alone: "more time passed than
   * expected". Sampling a monotonic clock alongside it separates them, because
   * only the wall clock moves when the user or NTP changes the time.
   *
   * On a real clock change the *remaining duration* is preserved by shifting
   * the deadline, so a user who set their clock forward five minutes still gets
   * the countdown they asked for, and the digits do not jump.
   */
  #detectClockJump(): void {
    const wall = this.#now();
    const mono = this.#mono();

    if (this.#prevWall !== null && this.#prevMono !== null) {
      const dWall = wall - this.#prevWall;
      const dMono = mono - this.#prevMono;
      const skew = dWall - dMono;

      if (Math.abs(skew) > DRIFT_THRESHOLD_MS && this.#endAtEpoch !== null) {
        this.#endAtEpoch += skew;
        this.#hooks.onLog?.('TT-SYS-201', { skewMs: Math.round(skew), dWallMs: Math.round(dWall) });
      }
    }

    this.#prevWall = wall;
    this.#prevMono = mono;
  }

  /** Single-fire latch shared by every path that can reach zero (docs/04 §6). */
  #fireDone(late: boolean): void {
    if (this.#doneFired) return;
    this.#doneFired = true;
    this.#phase = 'done';
    this.#endAtEpoch = null;
    if (late) this.#hooks.onLog?.('TT-SYS-203', {});
    this.#hooks.onDone?.({ late });
  }
}
