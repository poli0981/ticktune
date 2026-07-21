import { describe, expect, it } from 'vitest';
import {
  LATE_THRESHOLD_MS,
  finishReport,
  isLateFinish,
  splitDuration,
} from '../../src/app/engine/timer/tt-late';

/**
 * docs/04 §2 option 3 — the late-finish arithmetic behind docs/03 §3.5.
 *
 * The trap this suite exists to guard is the two meanings of "late": the timer's
 * payload calls the visibility-latch path `late`, while the screen's question is
 * whether the overshoot is big enough to be worth mentioning. They disagree
 * routinely, and reaching for the wrong one is the likeliest bug in the phase.
 */
describe('isLateFinish', () => {
  it('is strictly greater than the threshold', () => {
    expect(LATE_THRESHOLD_MS).toBe(2_000);
    expect(isLateFinish(1_999)).toBe(false);
    // Exactly at the threshold is NOT late — docs/04 §2 says "exceeds".
    expect(isLateFinish(2_000)).toBe(false);
    expect(isLateFinish(2_001)).toBe(true);
  });

  it('treats a normal visible finish as not late', () => {
    // One worker interval. Mentioning it would be noise (docs/04 §2 item 2).
    expect(isLateFinish(28)).toBe(false);
    expect(isLateFinish(202)).toBe(false);
  });

  it('flags the S2 measurements', () => {
    expect(isLateFinish(52_351)).toBe(true); // the keep-alive control run
    expect(isLateFinish(177_509)).toBe(true); // hidden + silent, 2 m 57 s
  });
});

describe('finishReport', () => {
  it('reconstructs the instant zero was reached', () => {
    const now = 1_700_000_000_000;
    const r = finishReport({ late: true, overshootMs: 177_509 }, now);
    expect(r.zeroAtEpoch).toBe(now - 177_509);
    expect(r.variant).toBe('late');
    expect(r.firedByLatch).toBe(true);
  });

  it('renders the NORMAL screen for a latch-fired finish under the threshold', () => {
    // The whole point: `late: true` means the visibility latch beat the worker,
    // which happens constantly on a tab the user clicked back to. A 300 ms
    // discrepancy must not produce a screen announcing when zero was reached.
    const r = finishReport({ late: true, overshootMs: 300 }, 1_700_000_000_000);
    expect(r.variant).toBe('normal');
    expect(r.firedByLatch).toBe(true);
  });

  it('renders the LATE screen for a worker-fired finish over the threshold', () => {
    // And the converse: `late: false` with a large overshoot is exactly what
    // Playwright's page.clock produces, because the worker keeps ticking on the
    // real clock. Measured 2026-07-21 (docs/13 §3).
    const r = finishReport({ late: false, overshootMs: 390_001 }, 1_700_000_000_000);
    expect(r.variant).toBe('late');
    expect(r.firedByLatch).toBe(false);
  });

  it('never reports a negative overshoot', () => {
    // A wall-clock re-anchor (docs/04 §1) can in principle leave the deadline
    // marginally ahead of `now`. "Finished −4 ms ago" is not a thing to render.
    const r = finishReport({ late: false, overshootMs: -4 }, 1_700_000_000_000);
    expect(r.overshootMs).toBe(0);
    expect(r.zeroAtEpoch).toBe(1_700_000_000_000);
    expect(r.variant).toBe('normal');
  });

  it('rounds sub-millisecond overshoot', () => {
    const r = finishReport({ late: false, overshootMs: 27.6 }, 1_000);
    expect(r.overshootMs).toBe(28);
  });
});

describe('splitDuration', () => {
  it('splits the S2 headline figure', () => {
    // 2 m 57 s — the number docs/03 §3.5's example is built from.
    expect(splitDuration(177_509)).toEqual({ h: 0, m: 2, s: 57 });
  });

  it('floors rather than rounds', () => {
    expect(splitDuration(1_999)).toEqual({ h: 0, m: 0, s: 1 });
    expect(splitDuration(59_999)).toEqual({ h: 0, m: 0, s: 59 });
  });

  it('carries into hours', () => {
    expect(splitDuration(3_600_000)).toEqual({ h: 1, m: 0, s: 0 });
    expect(splitDuration(3_723_000)).toEqual({ h: 1, m: 2, s: 3 });
  });

  it('clamps negatives to zero', () => {
    expect(splitDuration(-5_000)).toEqual({ h: 0, m: 0, s: 0 });
  });
});
