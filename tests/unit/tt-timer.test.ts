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

    expect(h.done).toHaveBeenCalledWith({ late: true });
    expect(h.logs.map((l) => l.code)).toContain('TT-SYS-203');
  });

  it('does not mark an on-time finish late', () => {
    const h = harness();
    h.timer.start(1_000);
    h.advance(1_000);
    h.timer.tick();
    expect(h.done).toHaveBeenCalledWith({ late: false });
    expect(h.logs.map((l) => l.code)).not.toContain('TT-SYS-203');
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
