import { describe, expect, it } from 'vitest';
import { isoDurationMs } from '../../src/lib/tt-iso-duration';

/** docs/06 §3 — `contentDetails.duration` → milliseconds, or null. */
describe('isoDurationMs', () => {
  it.each([
    ['PT4M13S', 253_000],
    ['PT59S', 59_000],
    ['PT1H', 3_600_000],
    ['PT1H2M3S', 3_723_000],
    ['PT10M2S', 602_000],
    ['P1DT2H', 93_600_000],
    ['P1W', 604_800_000],
    ['PT1.5S', 1_500],
  ])('%s → %i ms', (text, ms) => {
    expect(isoDurationMs(text)).toBe(ms);
  });

  it.each([
    ['P0D', 'a live stream or an unaired premiere'],
    ['PT0S', 'zero'],
    ['P', 'no designators'],
    ['PT', 'a time marker with nothing after it'],
    ['P1Y', 'years — calendar-dependent, never sent'],
    ['P1M', 'months — calendar-dependent, never sent'],
    ['4:13', 'a clock, not ISO 8601'],
    ['', 'empty'],
    ['pt4m13s', 'lower case'],
  ])('%s → null (%s)', (text) => {
    expect(isoDurationMs(text)).toBeNull();
  });
});
