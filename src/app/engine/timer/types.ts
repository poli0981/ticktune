/** Timer engine public types — docs/04 §1. Pure TS, no DOM, no Svelte. */

export type TtTimerPhase = 'idle' | 'running' | 'paused' | 'done';

export interface TimerState {
  durationMs: number;
  /** `Date.now()`-based and authoritative. null while paused or idle. */
  endAtEpoch: number | null;
  remainingAtPauseMs: number | null;
  phase: TtTimerPhase;
}

/** Codes the timer can emit. Registered in docs/12 §6 before use. */
export type TtTimerLogCode =
  | 'TT-SYS-201' // wall-clock drift re-anchored
  | 'TT-SYS-203'; // zero crossed while suspended — late finish fired

export interface TtTimerHooks {
  /**
   * Wall clock. Authoritative for the deadline because it is the ONE clock
   * shared between the main thread and the worker (docs/04 §1).
   */
  now?: () => number;
  /**
   * Monotonic clock, used only as a per-context delta to tell a wall-clock jump
   * apart from a throttling gap. Never compared across contexts — its
   * timeOrigin differs per context, which is exactly why it cannot carry the
   * deadline.
   */
  mono?: () => number;
  onTick?: (remainingMs: number) => void;
  onDone?: (info: { late: boolean }) => void;
  onLog?: (code: TtTimerLogCode, detail: Readonly<Record<string, number>>) => void;
}

/** docs/04 §4 — the single source of truth for display formats. */
export type TtFormatRegime = 'hours' | 'minutes' | 'seconds';

export interface TtFormatted {
  /** e.g. "1:24:07", "09:41", "42.183" */
  text: string;
  /** All-lit ghost of the SAME width, e.g. "8:88:88" (docs/03 §1). */
  ghost: string;
  regime: TtFormatRegime;
  /** True below 60 s — the digits switch to tt-danger (docs/03 §2). */
  danger: boolean;
}
