import type { TtEndAction } from '../../../lib/tt-domain-types';
import { planChime, type TtChimePlan } from './tt-chime';
import { equalPowerOutCurve } from './tt-gain-curve';
import type { TtAudioPorts } from './types';

/**
 * The End Behavior — docs/02 §5 and §3.3, fired when the countdown reaches zero.
 *
 * Two properties this module exists to guarantee:
 *
 * 1. **The plan is snapshotted at `done` and then immutable.** Settings changed
 *    mid-fade cannot alter what was scheduled, which is what keeps a 2 s fade
 *    from turning into a 0 s one halfway through.
 * 2. **Everything is scheduled in ONE synchronous block on the audio clock.**
 *    That is what makes exit criterion 2 reachable at all given spike S2: the
 *    main thread may be throttled the moment after `done`, so the fade and the
 *    chime must already be committed to the audio hardware by then, needing no
 *    further frame.
 */

export interface TtEndConfig {
  endFadeMs: number;
  endChime: boolean;
  endFlash: boolean;
  endAction: TtEndAction;
}

export interface TtEndPlan {
  readonly fadeMs: number;
  readonly flash: boolean;
  readonly action: TtEndAction;
  /** Null when muted, or when the user turned the chime off. */
  readonly chime: TtChimePlan | null;
  readonly startedAtS: number;
}

/**
 * @param muted docs/05 §7 — the chime respects mute (a muted app stays silent)
 *   but does NOT scale with volume, because it is an attention signal.
 */
export function planEndBehavior(cfg: TtEndConfig, muted: boolean, audioNowS: number): TtEndPlan {
  const fadeMs = Math.min(5_000, Math.max(0, cfg.endFadeMs));
  return {
    fadeMs,
    flash: cfg.endFlash,
    action: cfg.endAction,
    chime: cfg.endChime && !muted ? planChime(audioNowS, fadeMs / 1000) : null,
    startedAtS: audioNowS,
  };
}

export interface TtEndIo {
  /** Schedules the chime's oscillators. Impure; the driver supplies it. */
  scheduleChime: (plan: TtChimePlan) => void;
  onLog: (code: 'TT-PLY-103') => void;
}

/**
 * Commit the plan to the audio clock. Synchronous by construction — nothing
 * here awaits, and nothing is deferred to a later frame.
 */
export function runEndBehavior(plan: TtEndPlan, ports: TtAudioPorts, io: TtEndIo): void {
  const now = ports.ctx.nowS;

  // Always cancel first: Restart and Back can both land mid-fade, and a second
  // run whose fadeGain still carries the previous ramp starts silent.
  ports.fadeGain.cancelScheduled(now);

  if (plan.fadeMs === 0) {
    // ⚠️ `setValueCurveAtTime` with a zero duration throws RangeError, and
    // `endFadeMs: 0` is a documented, reachable value — it is half of what
    // docs/02 §3.3 calls "silence-only". So the no-fade case is an explicit
    // branch, not a degenerate curve.
    ports.fadeGain.setValue(0, now);
  } else {
    ports.fadeGain.setCurve(equalPowerOutCurve(), now, plan.fadeMs / 1000);
  }

  if (plan.chime) {
    if (ports.ctx.state !== 'running') {
      // docs/01 §2 principle 5: never silent-and-unreported.
      io.onLog('TT-PLY-103');
    } else {
      io.scheduleChime(plan.chime);
    }
  }
}
