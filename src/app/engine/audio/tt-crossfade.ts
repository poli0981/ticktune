/**
 * The crossfade trigger and curves — docs/05 §2.
 *
 * Pure: no DOM, no Web Audio. This is the module spike S4b measured, moved in
 * UNCHANGED when it passed (docs/15 §S4b), so what the sweep measured is what
 * ships; the spike's runner now imports it from here. The constants below are
 * the sweep's, each decided by a run that failed first.
 */

/** Fire this much earlier than the ideal moment: `timeupdate` comes at ~4 Hz. */
export const TT_XFADE_MARGIN_S = 0.3;
/** Kept between the end of the curves and the end of the outgoing media. */
export const TT_XFADE_GUARD_S = 0.03;
/** Curves start at once: S4b measured no gain from waiting on `play()`. */
export const TT_XFADE_LATENCY_S = 0;
/** Load the incoming track on the idle deck this long before the trigger. */
export const TT_XFADE_ARM_LEAD_S = 8;
/**
 * A pause mid-fade: hold the curves, ramp to zero over this, then pause the
 * elements this much later — `pause()` on a playing element is a step, and the
 * render thread runs ahead of `currentTime` (S4b: at +5 ms one run in three
 * still clicked).
 */
export const TT_DECLICK_S = 0.015;
export const TT_PAUSE_MARGIN_S = 0.045;

/**
 * Which duration the trigger trusts — S4b's decision, exactly.
 *
 * The importer's length first: `parseBlob`, which scans the whole file when
 * the headers do not say (`tt-import-driver.ts`). `element.duration` only when
 * no such length is known: it is an estimate on header-less VBR (the trigger
 * concluded no fade could fit and never fired) and on raw ADTS (0.2–0.5 s
 * early — inside any "close enough" tolerance, which is why there is none).
 * Neither known → null: no crossfade, `ended` takes over.
 */
export function triggerDurationS(elementS: number, exactMs: number | null): number | null {
  if (exactMs !== null && exactMs > 0) return exactMs / 1000;
  return Number.isFinite(elementS) && elementS > 0 ? elementS : null;
}

/** docs/05 §2: below this a "crossfade" is a click with extra steps. */
const MIN_FADE_S = 0.25;

export interface TtXfadeInput {
  /** The outgoing track's duration, from whichever source the run trusts. */
  durationS: number;
  /** The outgoing element's `currentTime`. */
  currentTimeS: number;
  /** `AudioContext.currentTime` now — the clock the curves are scheduled on. */
  nowS: number;
  /** The configured fade; 0 means a hard cut. */
  fadeMs: number;
  /** The incoming track's duration, if known: a fade may not exceed half of it. */
  incomingDurationS: number | null;
  /** How much earlier than the ideal moment the trigger may fire. */
  marginS: number;
  /** Delay between the decision and the curves' start, to absorb `play()` latency. */
  latencyS: number;
  /** Kept between the end of the curves and the end of the outgoing media. */
  guardS: number;
}

export type TtXfadePlan =
  | { kind: 'wait' }
  | { kind: 'never'; reason: 'off' | 'unknown-duration' | 'too-short' }
  | { kind: 'start'; startS: number; effS: number };

/**
 * Decide, on one `timeupdate`, whether the crossfade starts now.
 *
 * `effFade = min(fade, D_out/2, D_in/2)` (docs/05 §2). It fires once
 * `remaining ≤ effFade + margin`, and the curves run for
 * `min(effFade, remaining − latency − guard)` so the outgoing media never runs
 * out while it is still audible.
 */
export function crossfadePlan(i: TtXfadeInput): TtXfadePlan {
  if (i.fadeMs <= 0) return { kind: 'never', reason: 'off' };
  if (!Number.isFinite(i.durationS) || i.durationS <= 0) {
    return { kind: 'never', reason: 'unknown-duration' };
  }
  const incoming = i.incomingDurationS ?? Number.POSITIVE_INFINITY;
  const eff = Math.min(i.fadeMs / 1000, i.durationS / 2, incoming / 2);
  if (eff < MIN_FADE_S) return { kind: 'never', reason: 'too-short' };

  const remaining = i.durationS - i.currentTimeS;
  if (remaining > eff + i.marginS) return { kind: 'wait' };

  const effS = Math.min(eff, remaining - i.latencyS - i.guardS);
  if (effS < MIN_FADE_S) return { kind: 'never', reason: 'too-short' };
  return { kind: 'start', startS: i.nowS + i.latencyS, effS };
}

/** docs/05 §2's equal-power pair at normalised position `t` ∈ [0, 1]. */
export function gainOut(t: number): number {
  return Math.cos((Math.min(1, Math.max(0, t)) * Math.PI) / 2);
}

export function gainIn(t: number): number {
  return Math.sin((Math.min(1, Math.max(0, t)) * Math.PI) / 2);
}

/**
 * The curve from `fromT` to 1, sampled for `setValueCurveAtTime`. A full fade
 * is `fromT = 0`; a resumed one starts at the value it was held at, so a pause
 * mid-fade continues the same curve instead of restarting it.
 */
export function curve(kind: 'out' | 'in', fromT = 0, steps = 64): Float32Array {
  const f = kind === 'out' ? gainOut : gainIn;
  const c = new Float32Array(steps);
  for (let k = 0; k < steps; k++) c[k] = f(fromT + ((1 - fromT) * k) / (steps - 1));
  return c;
}
