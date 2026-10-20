/**
 * Spike S4b — the crossfade trigger and curves under test (docs/15 §S4).
 *
 * Pure: no DOM, no Web Audio. On a PASS this module moves into the audio
 * engine UNCHANGED, so what the sweep measured is what ships (docs/05 §2).
 */

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
