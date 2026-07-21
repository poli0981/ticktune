import { describe, it, expect } from 'vitest';
import {
  formatRemaining,
  ghostFor,
  nextTickDelayMs,
  regimeFor,
  HOUR_MS,
  MINUTE_MS,
} from '../../src/app/engine/timer/tt-format';

/** docs/13 §1 — "format function truth table incl. boundary values". */

describe('format truth table (docs/04 §4)', () => {
  const CASES: Array<[number, string, string]> = [
    // [remainingMs, text, ghost]
    [0, '00.000', '88.888'],
    [1, '00.001', '88.888'],
    [999, '00.999', '88.888'],
    [1_000, '01.000', '88.888'],
    [42_183, '42.183', '88.888'],
    [59_999, '59.999', '88.888'], // last ms of the seconds regime
    [60_000, '01:00', '88:88'], // first ms of the minutes regime
    [581_000, '09:41', '88:88'],
    [3_599_999, '59:59', '88:88'], // last ms below an hour
    [3_600_000, '1:00:00', '8:88:88'], // first ms of the hours regime
    [5_047_000, '1:24:07', '8:88:88'],
    [86_400_000, '24:00:00', '88:88:88'], // 24 h — the documented maximum
  ];

  it.each(CASES)('%i ms → %s', (ms, text, ghost) => {
    const f = formatRemaining(ms);
    expect(f.text).toBe(text);
    expect(f.ghost).toBe(ghost);
  });

  it('the four documented boundaries land in the right regime', () => {
    expect(regimeFor(HOUR_MS)).toBe('hours');
    expect(regimeFor(HOUR_MS - 1)).toBe('minutes');
    expect(regimeFor(MINUTE_MS)).toBe('minutes');
    expect(regimeFor(MINUTE_MS - 1)).toBe('seconds');
  });

  it('flips to danger exactly at 60 s, not near it', () => {
    expect(formatRemaining(60_000).danger).toBe(false);
    expect(formatRemaining(59_999).danger).toBe(true);
  });

  it('clamps negatives rather than rendering a minus sign', () => {
    expect(formatRemaining(-5_000).text).toBe('00.000');
  });
});

describe('ghost layer (docs/03 §1)', () => {
  it('always matches the live string width — the whole point of it', () => {
    for (const ms of [0, 59_999, 60_000, 3_599_999, 3_600_000, 86_400_000, 36_000_000]) {
      const f = formatRemaining(ms);
      expect(f.ghost, `width mismatch at ${ms} ms`).toHaveLength(f.text.length);
    }
  });

  it('preserves separators so the glyph advance matches', () => {
    expect(ghostFor('1:24:07')).toBe('8:88:88');
    expect(ghostFor('42.183')).toBe('88.888');
  });

  it('widens with the hour digit past 9 h', () => {
    const f = formatRemaining(10 * HOUR_MS);
    expect(f.text).toBe('10:00:00');
    expect(f.ghost).toBe('88:88:88');
  });
});

describe('1 Hz alignment (docs/04 §4)', () => {
  it('wakes on the second boundary, not a flat 1000 ms', () => {
    // 90_500 ms remaining → the display flips in 500 ms, not 1000.
    expect(nextTickDelayMs(90_500)).toBe(500);
    expect(nextTickDelayMs(90_001)).toBe(1);
  });

  it('uses a full second when already exactly on a boundary', () => {
    expect(nextTickDelayMs(90_000)).toBe(1000);
  });

  it('defers to rAF below 60 s', () => {
    expect(nextTickDelayMs(59_999)).toBe(0);
  });
});
