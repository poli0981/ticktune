import { describe, expect, it } from 'vitest';
import { integratedLoudness, kWeighting } from '../../src/spike/s6/tt-s6-loudness';

/**
 * Spike S6's loudness core — ITU-R BS.1770-4 (docs/15 §S6).
 *
 * The filters are derived for any sample rate, so the 48 kHz case is checked
 * against the coefficients the standard publishes, and the meter against the
 * reference levels EBU Tech 3341 builds its tests from.
 */

function sine(hz: number, dbfs: number, seconds: number, fs: number, channels = 2): Float32Array[] {
  const a = 10 ** (dbfs / 20);
  const n = Math.round(seconds * fs);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = a * Math.sin((2 * Math.PI * hz * i) / fs);
  return Array.from({ length: channels }, () => Float32Array.from(ch));
}

describe('K-weighting', () => {
  it('reproduces the BS.1770-4 table at 48 kHz to 1e-6', () => {
    const [shelf, hp] = kWeighting(48_000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 6);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 6);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 6);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 6);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 6);
    expect(hp.a1).toBeCloseTo(-1.99004745483398, 6);
    expect(hp.a2).toBeCloseTo(0.99007225036621, 6);
  });
});

describe('integrated loudness', () => {
  it.each([48_000, 16_000])('1 kHz stereo at −23 dBFS reads −23.0 LUFS at %i Hz', (fs) => {
    // EBU Tech 3341 test 1's premise: −23 dBFS per channel, 1 kHz, stereo.
    const { lufs } = integratedLoudness(sine(1000, -23, 20, fs), fs);
    expect(lufs).toBeGreaterThan(-23.1);
    expect(lufs).toBeLessThan(-22.9);
  });

  it('weights a MONO file as dual mono — it plays on both speakers', () => {
    const fs = 48_000;
    const stereo = integratedLoudness(sine(1000, -23, 10, fs, 2), fs).lufs;
    const mono = integratedLoudness(sine(1000, -23, 10, fs, 1), fs).lufs;
    expect(Math.abs(mono - stereo)).toBeLessThan(0.05);
  });

  it('the absolute gate ignores near-silence', () => {
    const fs = 16_000;
    const tone = sine(1000, -23, 10, fs);
    const quiet = sine(1000, -80, 10, fs);
    const both = tone.map((ch, i) => Float32Array.from([...ch, ...quiet[i]!]));
    // Within 0.1 LU: the blocks that straddle the edge carry part of the tone
    // and pass the gate — correct BS.1770 behaviour, worth a few hundredths.
    const diff = integratedLoudness(both, fs).lufs - integratedLoudness(tone, fs).lufs;
    expect(Math.abs(diff)).toBeLessThan(0.1);
  });

  it('the relative gate ignores a much quieter half', () => {
    // −23 for 10 s, then −40 for 10 s: the quiet half is 17 LU down, below the
    // −10 LU relative gate, so it does not drag the result to ~−26.
    const fs = 16_000;
    const loud = sine(1000, -23, 10, fs);
    const soft = sine(1000, -40, 10, fs);
    const mix = loud.map((ch, i) => Float32Array.from([...ch, ...soft[i]!]));
    expect(integratedLoudness(mix, fs).lufs).toBeGreaterThan(-23.2);
  });

  it('silence is −Infinity, not NaN', () => {
    const r = integratedLoudness([new Float32Array(16_000), new Float32Array(16_000)], 16_000);
    expect(r.lufs).toBe(Number.NEGATIVE_INFINITY);
    expect(r.peakDb).toBe(Number.NEGATIVE_INFINITY);
  });

  it('reports the sample peak', () => {
    const { peakDb } = integratedLoudness(sine(997, -6, 2, 48_000), 48_000);
    expect(peakDb).toBeGreaterThan(-6.1);
    expect(peakDb).toBeLessThanOrEqual(-6);
  });
});
