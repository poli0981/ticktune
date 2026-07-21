import { describe, expect, it, vi } from 'vitest';
import { CHIME_NOTES_HZ, CHIME_PEAK_GAIN, planChime } from '../../src/app/engine/audio/tt-chime';
import {
  planEndBehavior,
  runEndBehavior,
  type TtEndConfig,
} from '../../src/app/engine/audio/tt-end-behavior';
import type { TtAudioPorts, TtGainPort } from '../../src/app/engine/audio/types';

/** docs/02 §5 and §3.3 — what happens at zero. */

function fakeGain(): TtGainPort & { calls: string[] } {
  const calls: string[] = [];
  let value = 1;
  return {
    calls,
    get value() {
      return value;
    },
    setValue: (v, t) => {
      value = v;
      calls.push(`set:${v}@${t}`);
    },
    setCurve: (values, t, d) => calls.push(`curve:${values.length}@${t}+${d}`),
    cancelScheduled: (t) => calls.push(`cancel@${t}`),
  };
}

function ports(state: 'running' | 'suspended' = 'running') {
  const fadeGain = fakeGain();
  const userGain = fakeGain();
  const p = {
    ctx: { nowS: 100, state, resume: vi.fn() },
    deck: () => ({}) as never,
    deckGain: () => fakeGain(),
    userGain,
    fadeGain,
    createUrl: () => 'blob:x',
    revokeUrl: vi.fn(),
  } as unknown as TtAudioPorts;
  return { p, fadeGain, userGain };
}

const cfg = (over: Partial<TtEndConfig> = {}): TtEndConfig => ({
  endFadeMs: 2_000,
  endChime: true,
  endFlash: false,
  endAction: 'stay',
  ...over,
});

describe('planChime (docs/05 §7)', () => {
  it('is two notes at a fixed peak, not scaled by volume', () => {
    const plan = planChime(10, 2);
    expect(plan.notes).toHaveLength(2);
    expect(plan.notes.map((n) => n.hz)).toEqual([...CHIME_NOTES_HZ]);
    // ≈ −6 dB. Fixed: an attention signal, not program material.
    expect(plan.notes.every((n) => n.peak === CHIME_PEAK_GAIN)).toBe(true);
  });

  it('starts after the fade, so it lands as the music finishes', () => {
    const plan = planChime(10, 2);
    expect(plan.notes[0]!.startS).toBe(12);
    expect(plan.endsAtS).toBeGreaterThan(plan.notes[1]!.startS);
  });

  it('is bounded — this is not the withdrawn keep-alive source', () => {
    // docs/04 §2: a near-zero-gain source kept alive to make the tab audible
    // was measured twice and withdrawn. A chime that never ended would be that
    // design by accident.
    const plan = planChime(0, 0);
    expect(plan.endsAtS).toBeLessThan(2);
  });

  it('never schedules in the past', () => {
    expect(planChime(50, -10).notes[0]!.startS).toBe(50);
  });
});

describe('planEndBehavior', () => {
  it('omits the chime when muted, and when it is turned off', () => {
    // docs/05 §7: respects mute, does not scale with volume.
    expect(planEndBehavior(cfg(), true, 0).chime).toBeNull();
    expect(planEndBehavior(cfg({ endChime: false }), false, 0).chime).toBeNull();
    expect(planEndBehavior(cfg(), false, 0).chime).not.toBeNull();
  });

  it('clamps the fade to the docs/02 §3.1 range', () => {
    expect(planEndBehavior(cfg({ endFadeMs: 9_000 }), false, 0).fadeMs).toBe(5_000);
    expect(planEndBehavior(cfg({ endFadeMs: -1 }), false, 0).fadeMs).toBe(0);
  });

  it('is a SNAPSHOT — later settings changes cannot alter it', () => {
    // The property that makes a mid-fade settings change harmless.
    const live = cfg({ endFadeMs: 2_000, endAction: 'stay' });
    const plan = planEndBehavior(live, false, 0);

    live.endFadeMs = 0;
    live.endAction = 'loop';
    live.endChime = false;

    expect(plan.fadeMs).toBe(2_000);
    expect(plan.action).toBe('stay');
    expect(plan.chime).not.toBeNull();
  });

  it('carries all three endAction values through (docs/02 §3.3)', () => {
    for (const action of ['stay', 'restart', 'loop'] as const) {
      expect(planEndBehavior(cfg({ endAction: action }), false, 0).action).toBe(action);
    }
  });
});

describe('runEndBehavior', () => {
  const io = () => ({ scheduleChime: vi.fn(), onLog: vi.fn() });

  it('fades on fadeGain and never touches userGain', () => {
    const { p, fadeGain, userGain } = ports();
    runEndBehavior(planEndBehavior(cfg(), false, 100), p, io());

    expect(fadeGain.calls.some((c) => c.startsWith('curve:'))).toBe(true);
    // The split exists so a volume write mid-fade cannot collide with the
    // curve; the fade must therefore stay off userGain entirely.
    expect(userGain.calls).toEqual([]);
  });

  it('cancels scheduled values BEFORE writing', () => {
    const { p, fadeGain } = ports();
    runEndBehavior(planEndBehavior(cfg(), false, 100), p, io());

    const cancelIdx = fadeGain.calls.findIndex((c) => c.startsWith('cancel@'));
    const writeIdx = fadeGain.calls.findIndex((c) => c.startsWith('curve:'));
    expect(cancelIdx).toBe(0);
    expect(writeIdx).toBeGreaterThan(cancelIdx);
  });

  it('endFadeMs: 0 emits a single setValue, NEVER a zero-duration curve', () => {
    // `setValueCurveAtTime` with duration 0 throws RangeError, and 0 is a
    // documented reachable value — half of docs/02 §3.3's "silence-only".
    const { p, fadeGain } = ports();
    runEndBehavior(planEndBehavior(cfg({ endFadeMs: 0 }), false, 100), p, io());

    expect(fadeGain.calls.some((c) => c.startsWith('curve:'))).toBe(false);
    expect(fadeGain.calls).toContain('set:0@100');
  });

  it('schedules the chime when the context is running', () => {
    const { p } = ports('running');
    const hooks = io();
    runEndBehavior(planEndBehavior(cfg(), false, 100), p, hooks);

    expect(hooks.scheduleChime).toHaveBeenCalledOnce();
    expect(hooks.onLog).not.toHaveBeenCalled();
  });

  it('logs TT-PLY-103 and schedules NOTHING on a suspended context', () => {
    // docs/01 §2 principle 5: the failure the audit found silent is now coded.
    const { p } = ports('suspended');
    const hooks = io();
    runEndBehavior(planEndBehavior(cfg(), false, 100), p, hooks);

    expect(hooks.onLog).toHaveBeenCalledWith('TT-PLY-103');
    expect(hooks.scheduleChime).not.toHaveBeenCalled();
  });

  it('still fades when the chime is off — "silence-only" is not a fourth mode', () => {
    const { p, fadeGain } = ports();
    const hooks = io();
    runEndBehavior(planEndBehavior(cfg({ endChime: false }), false, 100), p, hooks);

    expect(fadeGain.calls.some((c) => c.startsWith('curve:'))).toBe(true);
    expect(hooks.scheduleChime).not.toHaveBeenCalled();
  });

  it('is synchronous — nothing is deferred to a later frame', () => {
    // The property exit criterion 2 rests on: after `done` the main thread may
    // be throttled immediately, so everything must already be committed.
    const { p, fadeGain } = ports();
    const hooks = io();
    runEndBehavior(planEndBehavior(cfg(), false, 100), p, hooks);

    expect(fadeGain.calls.length).toBeGreaterThan(0);
    expect(hooks.scheduleChime).toHaveBeenCalledOnce();
  });
});
