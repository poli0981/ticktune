import { describe, expect, it } from 'vitest';
import {
  TT_BAR_COUNT,
  TT_FRAME_BUDGET_MS,
  barHeights,
  beatEnergy,
  nextDegrade,
  wavePoints,
} from '../../src/app/engine/visuals/tt-visualizer';
import { milestoneFor } from '../../src/app/engine/timer/tt-milestones';

/**
 * P5 slice 4's pure half — docs/13 §1.
 *
 * The visualizer's maths and the milestone rule. Both exist as modules rather
 * than as component code for the same reason: every interesting case is a
 * boundary, and none of them need a canvas or a screen reader to check.
 */

/** An analyser frame with energy only in the given bin range. */
function frame(length: number, from: number, to: number, value = 255): Uint8Array {
  const f = new Uint8Array(length);
  for (let i = from; i < to && i < length; i++) f[i] = value;
  return f;
}

describe('bar heights — docs/05 §6', () => {
  it('returns the documented 64 bins by default', () => {
    expect(barHeights(frame(1024, 0, 1024)).length).toBe(TT_BAR_COUNT);
    expect(TT_BAR_COUNT).toBe(64);
  });

  it('normalises to 0–1', () => {
    const full = barHeights(frame(1024, 0, 1024, 255));
    expect(Math.max(...full)).toBeLessThanOrEqual(1);
    expect(Math.min(...full)).toBeGreaterThanOrEqual(0);
    // A silent frame is all zeroes, not NaN — the shape a division by an empty
    // bin range would produce.
    expect(barHeights(frame(1024, 0, 0)).every((v) => v === 0)).toBe(true);
  });

  it('is LOG-spaced, so the bass gets its own bars', () => {
    /*
     * The whole point of the mapping. With linear bins, energy confined to the
     * bottom 1% of the spectrum lights up the first bar and nothing else;
     * log spacing spreads that same octave across many. Asserted as "several
     * low bars respond", which is what a listener sees.
     */
    const low = barHeights(frame(1024, 1, 10));
    const lit = low.filter((v) => v > 0).length;
    expect(lit).toBeGreaterThan(3);
    // ...and the top of the display stays dark, because nothing up there rang.
    expect(low[TT_BAR_COUNT - 1]).toBe(0);
  });

  it('ignores the empty top half of the spectrum', () => {
    // At 44.1 kHz an fftSize of 2048 spans to 22 kHz and the top half is
    // almost always silent. Mapping it gives a display whose right side never
    // moves, which reads as broken rather than as quiet.
    const high = barHeights(frame(1024, 900, 1024));
    expect(high.every((v) => v === 0)).toBe(true);
  });

  it('takes the peak of each bin range, not the mean', () => {
    // A mean over a wide high bin averages transients away, and transients are
    // what the eye is following. One hot bin in a wide range must show.
    const spike = new Uint8Array(1024);
    spike[300] = 255;
    expect(Math.max(...barHeights(spike))).toBe(1);
  });

  it('scales with sensitivity and still clamps', () => {
    const half = frame(1024, 1, 512, 128);
    const quiet = barHeights(half, TT_BAR_COUNT, 0.5);
    const loud = barHeights(half, TT_BAR_COUNT, 2);
    expect(Math.max(...loud)).toBeGreaterThan(Math.max(...quiet));
    // 128/255 × 2 is over 1 and must not overflow the drawing range.
    expect(Math.max(...loud)).toBeLessThanOrEqual(1);
  });

  it('returns nothing for a zero bar count rather than dividing by it', () => {
    expect(barHeights(frame(1024, 0, 1024), 0)).toEqual([]);
  });
});

describe('wave points — docs/05 §6', () => {
  it('centres silence on 0.5', () => {
    // getByteTimeDomainData encodes silence as 128, not 0.
    const silence = new Uint8Array(2048).fill(128);
    expect(wavePoints(silence, 32).every((v) => Math.abs(v - 0.5) < 1e-9)).toBe(true);
  });

  it('keeps a full-scale excursion inside 0–1', () => {
    const loud = new Uint8Array(2048);
    for (let i = 0; i < loud.length; i++) loud[i] = i % 2 === 0 ? 255 : 0;
    const pts = wavePoints(loud, 32);
    expect(Math.max(...pts)).toBeLessThanOrEqual(1);
    expect(Math.min(...pts)).toBeGreaterThanOrEqual(0);
  });

  it('down-samples by extreme, not by every nth sample', () => {
    /*
     * nth-sample decimation aliases: a steady tone whose period lines up with
     * the stride reads as a flat line or a slow wobble. Taking the extreme in
     * each window preserves the envelope, so a signal with one big excursion
     * per window still shows it.
     */
    const sparse = new Uint8Array(2048).fill(128);
    sparse[500] = 255; // a lone peak, missed by any stride that skips it
    const pts = wavePoints(sparse, 16);
    expect(Math.max(...pts)).toBeGreaterThan(0.9);
  });

  it('returns nothing for a zero point count or an empty frame', () => {
    expect(wavePoints(new Uint8Array(2048), 0)).toEqual([]);
    expect(wavePoints(new Uint8Array(0), 32)).toEqual([]);
  });
});

describe('beat energy — the element that survives Visualizer: off', () => {
  it('reads the low band and ignores the highs', () => {
    // docs/05 §6: the tally pulse follows kick and bass. A cymbal-only frame
    // must not pulse it, or the light is a level meter wearing a beat's name.
    expect(beatEnergy(frame(1024, 0, 12))).toBeGreaterThan(0.9);
    expect(beatEnergy(frame(1024, 200, 1024))).toBe(0);
  });

  it('is 0 for silence and clamps at 1', () => {
    expect(beatEnergy(new Uint8Array(1024))).toBe(0);
    expect(beatEnergy(frame(1024, 0, 1024), 5)).toBe(1);
  });

  it('never divides by zero on a tiny frame', () => {
    expect(Number.isFinite(beatEnergy(new Uint8Array(4)))).toBe(true);
  });
});

describe('adaptive degrade — docs/05 §6', () => {
  it('does not degrade on a single long frame', () => {
    /*
     * One long frame is a garbage collection or a tab switch. Degrading on it
     * would leave the visualizer permanently worse after one hiccup, which is
     * the failure mode a naive "if slow, skip" has.
     */
    const s = nextDegrade(TT_FRAME_BUDGET_MS + 10, { strikes: 0, skip: false });
    expect(s.skip).toBe(false);
    expect(s.strikes).toBe(1);
  });

  it('skips after two consecutive overruns', () => {
    const one = nextDegrade(50, { strikes: 0, skip: false });
    const two = nextDegrade(50, one);
    expect(two.skip).toBe(true);
  });

  it('alternates once degraded, so it halves the work and stays animated', () => {
    let s = nextDegrade(50, { strikes: 0, skip: false });
    s = nextDegrade(50, s);
    expect(s.skip).toBe(true);
    s = nextDegrade(50, s);
    expect(s.skip).toBe(false);
    s = nextDegrade(50, s);
    expect(s.skip).toBe(true);
  });

  it('recovers immediately on the first frame under budget', () => {
    // Asymmetric on purpose: a machine that recovers gets its full frame rate
    // back at once, while one that is genuinely struggling keeps skipping.
    let s = nextDegrade(50, { strikes: 0, skip: false });
    s = nextDegrade(50, s);
    expect(s.skip).toBe(true);
    s = nextDegrade(5, s);
    expect(s).toEqual({ strikes: 0, skip: false });
  });

  it('treats exactly the budget as within it', () => {
    expect(nextDegrade(TT_FRAME_BUDGET_MS, { strikes: 1, skip: true })).toEqual({
      strikes: 0,
      skip: false,
    });
  });
});

describe('milestone announcements — docs/03 §8', () => {
  it('fires each of the five thresholds on a downward crossing', () => {
    expect(milestoneFor(600_001, 600_000)).toBe('min10');
    expect(milestoneFor(300_001, 300_000)).toBe('min5');
    expect(milestoneFor(60_001, 60_000)).toBe('min1');
    expect(milestoneFor(10_001, 10_000)).toBe('sec10');
    expect(milestoneFor(1, 0)).toBe('zero');
  });

  it('says nothing between thresholds', () => {
    expect(milestoneFor(500_000, 499_000)).toBeNull();
    expect(milestoneFor(30_000, 29_000)).toBeNull();
  });

  it('does not fire on a countdown that STARTS below a threshold', () => {
    /*
     * The rule that makes this a crossing rather than a comparison. A
     * 30-second countdown is already under a minute when the user presses
     * Start, and "one minute remaining" at that moment would be nonsense.
     */
    expect(milestoneFor(30_000, 30_000)).toBeNull();
    expect(milestoneFor(30_000, 29_999)).toBeNull();
  });

  it('says nothing when time does not move — a paused timer is silent', () => {
    expect(milestoneFor(60_000, 60_000)).toBeNull();
    // ...and nothing when it goes UP, which is what a restart looks like.
    expect(milestoneFor(10_000, 600_000)).toBeNull();
  });

  it('announces only the LOWEST threshold when a stall crosses several', () => {
    /*
     * docs/04 §2: a backgrounded tab can be throttled for minutes, so a tick
     * really can go from 12 minutes to 30 seconds. Four announcements back to
     * back would talk over each other and the only one still true would arrive
     * last.
     */
    expect(milestoneFor(720_000, 30_000)).toBe('min1');
    expect(milestoneFor(720_000, 5_000)).toBe('sec10');
    expect(milestoneFor(720_000, 0)).toBe('zero');
  });

  it('fires zero for an overshoot, not only for exactly 0', () => {
    // The timer overshoots by design (docs/04 §2) — routinely by a whole
    // throttled interval. Equality would silently never fire the one
    // announcement that matters most.
    expect(milestoneFor(500, -3_000)).toBe('zero');
    expect(milestoneFor(200_000, -177_000)).toBe('zero');
  });
});
