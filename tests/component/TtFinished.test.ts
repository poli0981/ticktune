import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import TtFinished from '../../src/app/components/TtFinished.svelte';
import type { TtFinishReport } from '../../src/app/engine/timer/types';

/**
 * docs/13 §2 — the Finished screen, both variants (docs/03 §3.5).
 *
 * The late variant is the whole visible deliverable of the S2 decision
 * (docs/04 §2 option 3), so what it must NOT say is as much the subject here as
 * what it must.
 */

afterEach(cleanup);

const ZERO_AT = new Date('2026-07-21T14:32:07+07:00').getTime();

/**
 * The component formats in the VIEWER's timezone, which is correct behaviour —
 * so the expected string has to be derived, not hardcoded. Hardcoding "14:32"
 * passed on a UTC+7 dev box and failed in CI, which runs UTC, and the failure
 * was the test's fault rather than the component's.
 *
 * Deriving it keeps the real assertion intact: the screen shows the clock time
 * of `zeroAtEpoch` — the instant the countdown actually reached zero — and not
 * the current time, which is the whole point of the late variant.
 */
const EXPECTED_CLOCK = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(ZERO_AT));

function report(over: Partial<TtFinishReport> = {}): TtFinishReport {
  return {
    variant: 'normal',
    overshootMs: 28,
    zeroAtEpoch: ZERO_AT,
    firedByLatch: false,
    ...over,
  };
}

describe('normal variant', () => {
  it('renders the plain screen and no when-clause', () => {
    render(TtFinished, { report: report(), onrestart: vi.fn(), onback: vi.fn() });

    expect(screen.getByTestId('tt-finished')).toHaveProperty('dataset.variant', 'normal');
    expect(screen.getByRole('heading').textContent).toBe('HẾT GIỜ');
    // The common case is untouched: nothing about when, nothing to explain.
    expect(screen.queryByTestId('tt-finished-late')).toBeNull();
  });

  it('offers exactly the two moves docs/02 §1 allows', () => {
    const onrestart = vi.fn();
    const onback = vi.fn();
    render(TtFinished, { report: report(), onrestart, onback });

    void fireEvent.click(screen.getByTestId('tt-finished-restart'));
    void fireEvent.click(screen.getByTestId('tt-finished-back'));
    expect(onrestart).toHaveBeenCalledOnce();
    expect(onback).toHaveBeenCalledOnce();
  });
});

describe('late variant', () => {
  const late = report({ variant: 'late', overshootMs: 177_509, firedByLatch: true });

  it('states the clock time zero was reached and how long ago', () => {
    render(TtFinished, { report: late, onrestart: vi.fn(), onback: vi.fn() });

    const el = screen.getByTestId('tt-finished-late');
    expect(el.textContent).toContain(EXPECTED_CLOCK);
    expect(el.textContent).toMatch(/2 phút/);
    expect(el.textContent).toMatch(/57 giây/);
    expect(el.textContent).toMatch(/trước/);
  });

  it('makes no bare present-tense claim about the moment', () => {
    render(TtFinished, { report: late, onrestart: vi.fn(), onback: vi.fn() });
    const text = screen.getByTestId('tt-finished').textContent ?? '';

    // The failure this whole variant exists to prevent: a screen that reads as
    // if the countdown ended just now. "trước" (ago) must be present and the
    // when-clause must carry a specific time, not a relative nothing.
    expect(text).toContain('trước');
    expect(text).toMatch(new RegExp(`lúc\\s*${EXPECTED_CLOCK}`));
    // And that time must be the instant zero was reached, not the present one.
    const nowClock = new Intl.DateTimeFormat('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
    if (nowClock !== EXPECTED_CLOCK) expect(text).not.toContain(nowClock);
  });

  it('explains why, without blaming the countdown', () => {
    render(TtFinished, { report: late, onrestart: vi.fn(), onback: vi.fn() });
    const text = screen.getByTestId('tt-finished').textContent ?? '';
    // docs/04 §2: the elapsed time IS correct; only the reaction was delayed.
    expect(text).toContain('chính xác');
  });

  it('drops seconds past an hour rather than implying false precision', () => {
    const hours = report({ variant: 'late', overshootMs: 3_723_000 });
    render(TtFinished, { report: hours, onrestart: vi.fn(), onback: vi.fn() });

    const el = screen.getByTestId('tt-finished-late');
    expect(el.textContent).toMatch(/1 giờ/);
    expect(el.textContent).toMatch(/2 phút/);
    expect(el.textContent).not.toMatch(/giây/);
  });

  it('keeps the elapsed phrase fresh from the stored zero instant', async () => {
    vi.useFakeTimers();
    try {
      // A clock the component reads through its injected `now`, so the 1 Hz
      // refresh is observable without waiting a real second.
      let clock = ZERO_AT + 177_509;
      render(TtFinished, {
        report: late,
        onrestart: vi.fn(),
        onback: vi.fn(),
        now: () => clock,
      });
      expect(screen.getByTestId('tt-finished-late').textContent).toMatch(/2 phút/);

      // Sixty seconds pass while the screen sits there.
      clock += 60_000;
      vi.advanceTimersByTime(1_000);
      await tick();

      // Derived from zeroAtEpoch, not incremented — so it now reads 3 minutes.
      expect(screen.getByTestId('tt-finished-late').textContent).toMatch(/3 phút/);
    } finally {
      vi.useRealTimers();
    }
  });
});
