import { describe, it, expect, vi } from 'vitest';
import { TtTimer, DRIFT_THRESHOLD_MS } from '../../src/app/engine/timer/tt-timer';
import type { TtTimerLogCode } from '../../src/app/engine/timer/types';

/**
 * docs/13 §1 row 1, and docs/04 §7's reason for injecting BOTH clocks
 * separately: a suite that drove a single clock would pass against an
 * implementation that cannot tell a wall-clock jump from a throttling gap.
 */

function harness(startWall = 1_000_000, startMono = 0) {
  let wall = startWall;
  let mono = startMono;
  const logs: Array<{ code: TtTimerLogCode; detail: Record<string, number> }> = [];
  const done = vi.fn();

  const timer = new TtTimer({
    now: () => wall,
    mono: () => mono,
    onDone: done,
    onLog: (code, detail) => logs.push({ code, detail: { ...detail } }),
  });

  return {
    timer,
    logs,
    done,
    /** The wall clock a caller would read, for the §2 reconstruction check. */
    wallNow: () => wall,
    /** Real time passing: both clocks advance together. */
    advance(ms: number) {
      wall += ms;
      mono += ms;
    },
    /** NTP correction or the user editing the clock: only the wall moves. */
    jumpWallClock(ms: number) {
      wall += ms;
    },
    /**
     * Throttled/suspended: real time passed and BOTH clocks observed it. This is
     * the case that must NOT be mistaken for a clock change.
     */
    throttleGap(ms: number) {
      wall += ms;
      mono += ms;
    },
  };
}

describe('tick samples (spike S2 instrumentation, docs/15 §S2)', () => {
  it('emits both clock deltas per tick so hidden/visible runs can be compared', () => {
    const samples: Array<{ dWallMs: number; dMonoMs: number; skewMs: number }> = [];
    let wall = 1_000_000;
    let mono = 0;
    const timer = new TtTimer({
      now: () => wall,
      mono: () => mono,
      onSample: (s) => samples.push(s),
    });

    timer.start(60_000);
    timer.tick(); // primes the clocks — nothing to diff yet
    wall += 200;
    mono += 200;
    timer.tick();
    wall += 5_000; // clock jump: wall only
    timer.tick();

    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({ dWallMs: 200, dMonoMs: 200, skewMs: 0 });
    expect(samples[1]?.skewMs).toBe(5_000);
  });

  it('costs nothing when no sampler is attached', () => {
    const h = harness();
    h.timer.start(1_000);
    expect(() => h.timer.tick()).not.toThrow();
  });
});

describe('derived time (CLAUDE.md invariant 3)', () => {
  it('is computed from the deadline, so a huge tick gap is still correct', () => {
    const h = harness();
    h.timer.start(90_000);

    h.throttleGap(75_000); // one tick, 75 s late
    expect(h.timer.tick()).toBe(15_000);
  });

  it('never goes negative', () => {
    const h = harness();
    h.timer.start(1_000);
    h.throttleGap(60_000);
    expect(h.timer.tick()).toBe(0);
  });

  it('reports the full duration before start', () => {
    const h = harness();
    expect(h.timer.remainingMs).toBe(0);
    h.timer.start(5_000);
    expect(h.timer.remainingMs).toBe(5_000);
  });
});

describe('pause / resume', () => {
  it('is exact to the millisecond regardless of pause length', () => {
    const h = harness();
    h.timer.start(90_000);
    h.advance(30_000);

    h.timer.pause();
    expect(h.timer.remainingMs).toBe(60_000);

    h.advance(3_600_000); // paused for an hour
    expect(h.timer.remainingMs).toBe(60_000);

    h.timer.resume();
    expect(h.timer.remainingMs).toBe(60_000);
    h.advance(10_000);
    expect(h.timer.remainingMs).toBe(50_000);
  });

  it('freezes the value while paused (docs/04 §6)', () => {
    const h = harness();
    h.timer.start(30_000);
    h.advance(5_000);
    h.timer.pause();
    h.advance(1_000);
    expect(h.timer.tick()).toBe(25_000);
  });

  it('ignores pause when not running and resume when not paused', () => {
    const h = harness();
    h.timer.pause();
    expect(h.timer.phase).toBe('idle');
    h.timer.resume();
    expect(h.timer.phase).toBe('idle');
  });
});

describe('single-fire done (docs/04 §6)', () => {
  it('fires exactly once no matter how many ticks follow', () => {
    const h = harness();
    h.timer.start(1_000);
    h.advance(1_000);

    h.timer.tick();
    h.timer.tick();
    h.timer.tick();

    expect(h.done).toHaveBeenCalledTimes(1);
    expect(h.timer.phase).toBe('done');
  });

  it('marks a recovery-path finish late and logs TT-SYS-203', () => {
    const h = harness();
    h.timer.start(1_000);
    h.throttleGap(600_000); // slept through zero

    h.timer.tick(true); // the visibility/focus latch

    expect(h.done).toHaveBeenCalledWith({ late: true, overshootMs: 599_000 });
    expect(h.logs.map((l) => l.code)).toContain('TT-SYS-203');
  });

  it('does not mark an on-time finish late', () => {
    const h = harness();
    h.timer.start(1_000);
    h.advance(1_000);
    h.timer.tick();
    expect(h.done).toHaveBeenCalledWith({ late: false, overshootMs: 0 });
    expect(h.logs.map((l) => l.code)).not.toContain('TT-SYS-203');
  });

  it('reports how far past the deadline it fired — the number S2 bounds', () => {
    // docs/15 §S2 caps hidden-tab-with-audio overshoot at ±500 ms and asks for a
    // measured figure in the silent and YouTube cases. That measurement is only
    // meaningful if overshootMs is the real lateness, so pin it.
    const h = harness();
    h.timer.start(10_000);
    h.throttleGap(10_350); // tick arrived 350 ms after zero
    h.timer.tick();
    expect(h.done.mock.calls[0]?.[0]?.overshootMs).toBe(350);
  });

  it('a restart re-arms the latch', () => {
    const h = harness();
    h.timer.start(1_000);
    h.advance(1_000);
    h.timer.tick();

    h.timer.start(1_000);
    h.advance(1_000);
    h.timer.tick();

    expect(h.done).toHaveBeenCalledTimes(2);
  });
});

describe('clock jump vs throttling gap (docs/04 §1) — the disambiguation', () => {
  it('does NOT log TT-SYS-201 for a large throttling gap', () => {
    const h = harness();
    h.timer.start(600_000);
    h.timer.tick(); // prime both clock samples

    h.throttleGap(120_000); // two minutes of genuine, throttled time
    h.timer.tick();

    expect(h.logs.map((l) => l.code)).not.toContain('TT-SYS-201');
    expect(h.timer.remainingMs).toBe(480_000); // time really did pass
  });

  it('logs TT-SYS-201 and preserves the REMAINING duration on a clock jump', () => {
    const h = harness();
    h.timer.start(600_000);
    h.timer.tick();

    h.advance(60_000);
    h.timer.tick();
    expect(h.timer.remainingMs).toBe(540_000);

    h.jumpWallClock(300_000); // user sets the clock 5 minutes forward
    h.timer.tick();

    expect(h.logs.map((l) => l.code)).toContain('TT-SYS-201');
    // The countdown the user asked for survives: still 9 minutes left, not 4.
    expect(h.timer.remainingMs).toBe(540_000);
  });

  it('handles a backwards clock jump too', () => {
    const h = harness();
    h.timer.start(600_000);
    h.timer.tick();

    h.jumpWallClock(-300_000);
    h.timer.tick();

    expect(h.logs.map((l) => l.code)).toContain('TT-SYS-201');
    expect(h.timer.remainingMs).toBe(600_000);
  });

  it('ignores skew at or below the threshold', () => {
    const h = harness();
    h.timer.start(600_000);
    h.timer.tick();

    h.jumpWallClock(DRIFT_THRESHOLD_MS - 1);
    h.timer.tick();

    expect(h.logs.map((l) => l.code)).not.toContain('TT-SYS-201');
  });

  it('reports the measured skew, not just that something happened', () => {
    const h = harness();
    h.timer.start(600_000);
    h.timer.tick();
    h.jumpWallClock(300_000);
    h.timer.tick();

    const entry = h.logs.find((l) => l.code === 'TT-SYS-201');
    expect(entry?.detail['skewMs']).toBe(300_000);
  });

  it('does not fire on the very first tick, when there is nothing to compare', () => {
    const h = harness();
    h.timer.start(600_000);
    h.timer.tick();
    expect(h.logs).toHaveLength(0);
  });
});

describe('overshoot reconstruction (docs/04 §2)', () => {
  /**
   * The Finished screen does not receive the instant zero was reached — it
   * subtracts `overshootMs` from the wall clock read at the top of the done
   * handler (tt-late.ts). That is only exact if `overshootMs` is measured
   * against the deadline with the same clock, so pin the property here: if
   * anyone later makes `done` asynchronous, or measures the overshoot from
   * somewhere else, this fails rather than the screen quietly reporting a wrong
   * finish time in the one case it exists for.
   */
  it('now − overshootMs equals the original deadline, on a throttled finish', () => {
    const h = harness();
    const deadline = h.wallNow() + 60_000;
    h.timer.start(60_000);
    expect(h.timer.state.endAtEpoch).toBe(deadline);

    // Hidden and throttled straight past zero — the S2 shape.
    h.throttleGap(60_000 + 177_509);
    h.timer.tick(true);

    const { overshootMs } = h.done.mock.calls[0]![0] as { overshootMs: number };
    expect(overshootMs).toBe(177_509);
    // Read as the handler would, synchronously after the fire.
    expect(h.wallNow() - overshootMs).toBe(deadline);
  });

  it('holds on the ordinary visible path too', () => {
    const h = harness();
    const deadline = h.wallNow() + 5_000;
    h.timer.start(5_000);
    h.advance(5_000 + 202); // one worker interval late
    h.timer.tick(false);

    const { late, overshootMs } = h.done.mock.calls[0]![0] as {
      late: boolean;
      overshootMs: number;
    };
    expect(late).toBe(false);
    expect(overshootMs).toBe(202);
    expect(h.wallNow() - overshootMs).toBe(deadline);
  });
});

describe('reset', () => {
  it('returns to idle and clears the done latch', () => {
    const h = harness();
    h.timer.start(1_000);
    h.advance(1_000);
    h.timer.tick();
    expect(h.timer.phase).toBe('done');

    h.timer.reset();
    expect(h.timer.phase).toBe('idle');
    expect(h.timer.state.endAtEpoch).toBeNull();
  });

  it('a tick after reset does nothing', () => {
    const h = harness();
    h.timer.start(1_000);
    h.timer.reset();
    h.advance(5_000);
    h.timer.tick();
    expect(h.done).not.toHaveBeenCalled();
  });
});
