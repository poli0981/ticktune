/**
 * Spike S6 — integrated loudness and sample peak, ITU-R BS.1770-4 (docs/15 §S6).
 *
 * Pure. On a PASS this moves into the audio engine unchanged, so what the S6
 * sweep measured against ffmpeg's `ebur128` is what ships.
 *
 * K-weighting is two biquads — a high-shelf "pre-filter" and the RLB
 * high-pass — whose coefficients the standard tabulates at 48 kHz only. Here
 * they are derived from the analog prototype for the ACTUAL sample rate (the
 * construction libebur128 and pyloudnorm use), because the whole point of S6 is
 * analysing at 16 kHz to bound memory; tests/unit/s6-loudness.test.ts checks
 * the 48 kHz case against the published table.
 *
 * Gating per BS.1770-4: 400 ms blocks with 75 % overlap, an absolute gate at
 * −70 LUFS, then a relative gate 10 LU below the absolutely-gated level.
 */

export interface TtBiquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The two K-weighting stages for sample rate `fs`. */
export function kWeighting(fs: number): [TtBiquad, TtBiquad] {
  // Stage 1 — high shelf, +4 dB above ~1.7 kHz.
  const f0 = 1681.974450955533;
  const g = 3.999843853973347;
  const q = 0.7071752369554196;
  const k1 = Math.tan((Math.PI * f0) / fs);
  const vh = 10 ** (g / 20);
  const vb = vh ** 0.4996667741545416;
  const a01 = 1 + k1 / q + k1 * k1;
  const shelf: TtBiquad = {
    b0: (vh + (vb * k1) / q + k1 * k1) / a01,
    b1: (2 * (k1 * k1 - vh)) / a01,
    b2: (vh - (vb * k1) / q + k1 * k1) / a01,
    a1: (2 * (k1 * k1 - 1)) / a01,
    a2: (1 - k1 / q + k1 * k1) / a01,
  };

  // Stage 2 — RLB high-pass at ~38 Hz. Its numerator stays [1, −2, 1].
  const f1 = 38.13547087602444;
  const q1 = 0.5003270373238773;
  const k2 = Math.tan((Math.PI * f1) / fs);
  const a02 = 1 + k2 / q1 + k2 * k2;
  const highpass: TtBiquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k2 * k2 - 1)) / a02,
    a2: (1 - k2 / q1 + k2 * k2) / a02,
  };
  return [shelf, highpass];
}

/** Direct form I, in place over `x`. */
function filter(x: Float32Array, c: TtBiquad): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let n = 0; n < x.length; n++) {
    const x0 = x[n]!;
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    x[n] = y0;
  }
}

export interface TtLoudness {
  /** Integrated loudness, LUFS; −Infinity for digital silence. */
  lufs: number;
  /** Largest |sample| across channels, dBFS (sample peak, not true peak). */
  peakDb: number;
}

const BLOCK_S = 0.4;
const HOP_S = 0.1;
const ABS_GATE = -70;
const REL_GATE = 10;
const loud = (power: number) => -0.691 + 10 * Math.log10(power);

/**
 * BS.1770-4 integrated loudness of planar channels at `fs`.
 *
 * A MONO input is weighted as dual mono (+3.01 dB): TickTune plays a mono file
 * on both speakers, and that is what the listener hears.
 */
export function integratedLoudness(channels: readonly Float32Array[], fs: number): TtLoudness {
  let peak = 0;
  for (const ch of channels) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  const [shelf, hp] = kWeighting(fs);
  const weighted = channels.map((ch) => {
    const y = Float32Array.from(ch);
    filter(y, shelf);
    filter(y, hp);
    return y;
  });
  const gain = channels.length === 1 ? 2 : 1;

  const block = Math.round(BLOCK_S * fs);
  const hop = Math.round(HOP_S * fs);
  const len = weighted[0]?.length ?? 0;
  // Mean square per 100 ms hop, then each 400 ms block is four of them.
  const hops: number[] = [];
  for (let start = 0; start + hop <= len; start += hop) {
    let s = 0;
    for (const y of weighted) for (let n = start; n < start + hop; n++) s += y[n]! * y[n]!;
    hops.push((gain * s) / hop);
  }
  const per = Math.round(block / hop);
  const blocks: number[] = [];
  for (let i = 0; i + per <= hops.length; i++) {
    let s = 0;
    for (let k = 0; k < per; k++) s += hops[i + k]!;
    blocks.push(s / per);
  }

  const peakDb = peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY;
  const absGated = blocks.filter((p) => p > 0 && loud(p) > ABS_GATE);
  if (absGated.length === 0) return { lufs: Number.NEGATIVE_INFINITY, peakDb };
  const relGate = loud(absGated.reduce((a, b) => a + b, 0) / absGated.length) - REL_GATE;
  const gated = absGated.filter((p) => loud(p) > relGate);
  return { lufs: loud(gated.reduce((a, b) => a + b, 0) / gated.length), peakDb };
}
