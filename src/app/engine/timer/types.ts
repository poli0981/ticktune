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

/**
 * One tick's raw clock measurements — the data spike S2 exists to collect
 * (docs/15 §S2: "log every tick's Date.now() AND performance.now() delta").
 *
 * Emitted on every tick when a sampler is attached, which only the `?ttdebug=1`
 * harness does. Nothing in the shipping path subscribes, so this costs a null
 * check per tick in normal use.
 */
export interface TtTickSample {
  /** Wall clock at this tick. */
  wallMs: number;
  /** Elapsed wall time since the previous tick. */
  dWallMs: number;
  /** Elapsed monotonic time since the previous tick. */
  dMonoMs: number;
  /** dWall − dMono. Non-zero means the wall clock moved under us (docs/04 §1). */
  skewMs: number;
  remainingMs: number;
  /** True when this tick came from the visibility/focus recovery latch. */
  late: boolean;
  /** document.hidden at sample time, so hidden and visible runs can be split. */
  hidden: boolean;
}

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
  /**
   * `overshootMs` is how far past the deadline we actually fired — the number
   * docs/15 §S2 bounds at ±500 ms for a hidden tab with audio, and asks us to
   * simply measure for the silent and YouTube cases.
   */
  onDone?: (info: { late: boolean; overshootMs: number }) => void;
  onLog?: (code: TtTimerLogCode, detail: Readonly<Record<string, number>>) => void;
  /** Attached only by the S2 harness. See TtTickSample. */
  onSample?: (sample: TtTickSample) => void;
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
