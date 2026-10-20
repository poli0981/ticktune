import { describe, expect, it } from 'vitest';
import {
  findClicks,
  fitFade,
  idealOverlapS,
  judgeTestXfade,
  judgeZero,
  allPass,
  measureRun,
  type TtBlock,
  type TtRunEvent,
  type TtRunTrace,
} from '../../src/spike/s4/tt-s4b-metrics';
import { crossfadePlan, curve, gainIn, gainOut } from '../../src/app/engine/audio/tt-crossfade';
import { quickPlan, type TtS4bFixture } from '../../src/spike/s4/tt-s4b-sweep-plan';
import { judgeRun, verdict } from '../../src/spike/s4/tt-s4b-verdict';

/**
 * Spike S4b's measurement, on synthetic traces — docs/15 §S4.
 *
 * The old harness read back the `gain.value` it had scheduled, so its overlap
 * agreed with the schedule by construction. These tests build what the probe
 * would report for an ideal fade and for three broken ones, and show the new
 * metrics separating them — and the OLD metric passing all three.
 */

const SR = 48_000;
const BLOCK = 128;
const LEVEL = 0.125; // mean square of a −9 dBFS signal

/** Blocks over [fromS, toS): `fn` gives the deck's gain, or null when no media plays. */
function deck(fromS: number, toS: number, fn: (t: number) => number | null): TtBlock[] {
  const out: TtBlock[] = [];
  for (let f = Math.round((fromS * SR) / BLOCK) * BLOCK; f / SR < toS; f += BLOCK) {
    const g = fn(f / SR);
    out.push({
      f,
      pre: g === null ? 0 : LEVEL,
      post: g === null ? 0 : LEVEL * g * g,
      d2: g === null ? 0 : 0.001,
      clip: 0,
    });
  }
  return out;
}

const START = 10;
const EFF = 2;
const fadeOut = (t: number) => (t < START ? 1 : t > START + EFF ? 0 : gainOut((t - START) / EFF));
const fadeIn = (t: number) => (t < START ? 0 : t > START + EFF ? 1 : gainIn((t - START) / EFF));

function trace(
  over: Partial<TtRunTrace> & { outEndS?: number; inStartS?: number } = {},
): TtRunTrace {
  const outEnd = over.outEndS ?? START + EFF + 0.3;
  const inStart = over.inStartS ?? START;
  const events: TtRunEvent[] = over.events ?? [
    { kind: 'play-out', atS: 5 },
    { kind: 'curve-start', atS: START },
    { kind: 'curve-end', atS: START + EFF },
    { kind: 'play-in', atS: START },
    { kind: 'ended-out', atS: outEnd },
  ];
  return {
    sampleRate: SR,
    out: over.out ?? deck(5, 15, (t) => (t < outEnd ? fadeOut(t) : null)),
    in: over.in ?? deck(5, 15, (t) => (t >= inStart ? fadeIn(t) : null)),
    master: over.master ?? deck(5, 15, () => 1),
    events,
    schedule: over.schedule === undefined ? { startS: START, effS: EFF } : over.schedule,
    masterFade: over.masterFade ?? null,
    outTrailSilenceS: 0,
    inLeadSilenceS: 0,
  };
}

const TIMING = { marginS: 0.3, guardS: 0.03 };

/** The metric this harness replaced: both SCHEDULED gains above 0.02. */
function oldOverlapMs(effS: number): number {
  const steps = 10_000;
  let n = 0;
  for (let i = 0; i < steps; i++) {
    const u = i / steps;
    if (gainOut(u) > 0.02 && gainIn(u) > 0.02) n++;
  }
  return Math.round((n / steps) * effS * 1000);
}

describe('crossfadePlan — the trigger under test (docs/05 §2)', () => {
  const base = {
    durationS: 200,
    currentTimeS: 100,
    nowS: 50,
    fadeMs: 2000,
    incomingDurationS: 180,
    marginS: 0.3,
    latencyS: 0,
    guardS: 0.03,
  };

  it('waits while more than fade + margin remains', () => {
    expect(crossfadePlan(base)).toEqual({ kind: 'wait' });
  });

  it('starts once remaining ≤ fade + margin, ending before the media does', () => {
    const p = crossfadePlan({ ...base, currentTimeS: 200 - 2.2 });
    expect(p).toEqual({ kind: 'start', startS: 50, effS: 2 });
  });

  it('shortens the fade so the outgoing media never runs out while audible', () => {
    const p = crossfadePlan({ ...base, currentTimeS: 200 - 1.5 });
    expect(p.kind).toBe('start');
    if (p.kind === 'start') expect(p.effS).toBeCloseTo(1.47, 5);
  });

  it('caps the fade at half of either track', () => {
    const p = crossfadePlan({ ...base, durationS: 3, currentTimeS: 1.8, incomingDurationS: 2 });
    expect(p.kind === 'start' && p.effS).toBe(1);
  });

  it.each([
    [{ fadeMs: 0 }, 'off'],
    [{ durationS: Number.NaN }, 'unknown-duration'],
    [{ durationS: Number.POSITIVE_INFINITY }, 'unknown-duration'],
    [{ durationS: 0.4, currentTimeS: 0.1 }, 'too-short'],
    [{ currentTimeS: 200 - 0.2 }, 'too-short'],
  ] as const)('%o → never (%s)', (over, reason) => {
    expect(crossfadePlan({ ...base, ...over })).toEqual({ kind: 'never', reason });
  });

  it('a resumed curve continues from where it was held', () => {
    expect(curve('out', 0.5)[0]).toBeCloseTo(gainOut(0.5), 6);
    expect(curve('in', 0.5)[0]).toBeCloseTo(gainIn(0.5), 6);
    expect(curve('out').at(-1)).toBeCloseTo(0, 6);
  });
});

describe('the metrics separate a good fade from three broken ones', () => {
  it('an ideal fade: overlap matches 0.8725·eff, fits within a block', () => {
    expect(idealOverlapS(EFF)).toBeCloseTo(1.745, 3);
    const m = measureRun(trace());
    expect(Math.abs(m.overlapErrMs ?? 99)).toBeLessThanOrEqual(6);
    expect(Math.abs(m.outFit?.startErrMs ?? 99)).toBeLessThanOrEqual(6);
    expect(Math.abs(m.inFit?.lenErrMs ?? 99)).toBeLessThanOrEqual(6);
    expect(m.headLossMs).toBe(0);
    expect(m.endGuardSignalMs).toBeGreaterThanOrEqual(0);
    expect(allPass(judgeTestXfade(m, TIMING))).toBe(true);
  });

  const broken = {
    'B starts 300 ms late': trace({ inStartS: START + 0.3 }),
    'B never starts': trace({ in: deck(5, 15, () => null) }),
    'A stops 400 ms before its fade ends': trace({ outEndS: START + EFF - 0.4 }),
  };

  it.each(Object.entries(broken))('%s → FAILS', (_, t) => {
    expect(allPass(judgeTestXfade(measureRun(t), TIMING))).toBe(false);
  });

  it('…while the OLD gain-readback metric PASSES all three — why it was replaced', () => {
    // It never looked at the audio, so the three traces are identical to it.
    const old = oldOverlapMs(EFF);
    expect(Math.abs(old - EFF * 1000)).toBeLessThanOrEqual(150);
    // And at 5 s a PERFECT fade already spends most of the tolerance.
    expect(EFF * 1000 * 2.5 - oldOverlapMs(EFF * 2.5)).toBeGreaterThan(120);
  });

  it('fitFade recovers a known start and length', () => {
    const t = trace();
    const out = fitFade(t, t.out, 'out', START - 0.5);
    expect(out?.startS).toBeCloseTo(START, 2);
    expect(out?.lenS).toBeCloseTo(EFF, 2);
  });
});

describe('clicks', () => {
  const at = (t: number): TtRunEvent => ({ kind: 'play-in', atS: t });

  it('flags a step discontinuity near a transition', () => {
    const t = trace();
    const i = t.in.findIndex((b) => b.f / SR >= START);
    t.in[i] = { ...t.in[i]!, d2: 0.3 };
    expect(findClicks(t).some((c) => c.where === 'in' && c.kind === 'discontinuity')).toBe(true);
  });

  it('ignores the same step far from anything the runner did', () => {
    const t = trace({ events: [at(START)] });
    const i = t.in.findIndex((b) => b.f / SR >= START + 3);
    t.in[i] = { ...t.in[i]!, d2: 0.3 };
    expect(findClicks(t)).toEqual([]);
  });

  it('flags an instant gain step but not a smooth fade', () => {
    expect(findClicks(trace())).toEqual([]);
    const cut = trace({
      in: deck(5, 15, (t) => (t >= START ? 1 : null)),
      out: deck(5, 15, (t) => (t < START ? 1 : t < START + 0.3 ? 0.2 : null)),
    });
    expect(findClicks(cut).some((c) => c.kind === 'gain-step')).toBe(true);
  });
});

describe('0 s: the gap a listener hears, net of the files own silence', () => {
  it('measures the silence between the last outgoing and first incoming sound', () => {
    const t = trace({
      schedule: null,
      out: deck(5, 15, (t) => (t < 12 ? 1 : null)),
      in: deck(5, 15, (t) => (t >= 12.08 ? 1 : null)),
      events: [
        { kind: 'ended-out', atS: 12 },
        { kind: 'play-in', atS: 12.05 },
      ],
    });
    const m = measureRun(t);
    expect(m.gapMs).toBeGreaterThanOrEqual(78);
    expect(m.gapMs).toBeLessThanOrEqual(86);
    expect(allPass(judgeZero(m))).toBe(true);
  });
});

describe('the verdict', () => {
  const fx: TtS4bFixture[] = ['wav', 'cbr'].flatMap((family) =>
    (['a', 'b'] as const).map((role) => ({
      name: `s4b-${family}-${role}`,
      family,
      role,
      exactS: 20,
      leadSilenceS: 0,
      trailSilenceS: 0,
      fromStart: false,
      kind: 'test' as const,
    })),
  );
  const good = measureRun(trace());
  const bad = measureRun(trace({ inStartS: START + 0.3 }));

  it('is HARNESS INVALID when a control run passes', () => {
    const plan = quickPlan(fx);
    const runs = plan.map((cfg) => judgeRun({ label: cfg.label, cfg, metrics: good }));
    expect(verdict(runs).outcome).toBe('HARNESS INVALID');
  });

  it('every control failing makes the harness valid', () => {
    const plan = quickPlan(fx).filter((c) => c.judge === 'control');
    const runs = plan.map((cfg) => judgeRun({ label: cfg.label, cfg, metrics: bad }));
    expect(runs.every((r) => r.ok)).toBe(true);
  });
});
