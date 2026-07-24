/**
 * The visualizer's arithmetic — docs/05 §6, P5 slice 4.
 *
 * Everything here takes an analyser frame (a plain byte array) and returns
 * numbers to draw. No canvas, no `AudioContext`, no `requestAnimationFrame`:
 * the component owns those, this owns the decisions, and the split is what
 * lets `05 §6`'s "64 log-spaced bins" and "adaptive degrade" be asserted
 * rather than eyeballed.
 */

/** docs/05 §6: "bars (64 log-spaced bins, mirrored)". */
export const TT_BAR_COUNT = 64;

/**
 * Bins above this fraction of the spectrum are dropped before mapping.
 *
 * At the usual 44.1 kHz an `fftSize` of 2048 gives 1024 bins spanning
 * 0–22 050 Hz, and the top half is almost always silent — mapping it anyway
 * produces a display whose right half never moves, which reads as broken
 * rather than as quiet. 0.5 keeps everything up to ~11 kHz.
 */
const SPECTRUM_USED = 0.5;

/**
 * Low band for the beat — docs/05 §6, "beat energy (low-band average) also
 * drives the tally-light pulse (03 §1)".
 *
 * ~0–250 Hz at 44.1 kHz, which is kick and bass. Wider than that and the pulse
 * follows the whole mix, which is a level meter rather than a beat.
 */
const BEAT_BAND = 0.012;

/**
 * Map an analyser frame onto `count` log-spaced bins, 0–1.
 *
 * **Log-spaced, not linear**, and that is the difference between a visualizer
 * and a graph: pitch is logarithmic, so linear bins give an octave of bass two
 * bars and the top octave five hundred. Each output bin takes the MAX of the
 * input bins it covers rather than the mean — a mean over a wide high bin
 * averages a transient away, and transients are what the eye is following.
 *
 * @param freq `getByteFrequencyData` output, 0–255 per bin
 * @param sensitivity docs/02 §3.1 `visualizerSensitivity`, 0.5–2.0
 */
export function barHeights(
  freq: ArrayLike<number>,
  count = TT_BAR_COUNT,
  sensitivity = 1,
): number[] {
  const usable = Math.max(1, Math.floor(freq.length * SPECTRUM_USED));
  const out: number[] = [];
  if (count <= 0) return out;

  for (let i = 0; i < count; i++) {
    // Geometric spacing from bin 1 (bin 0 is DC and carries no pitch).
    const lo = Math.floor(usable ** (i / count));
    const hi = Math.max(lo + 1, Math.floor(usable ** ((i + 1) / count)));
    let peak = 0;
    for (let b = lo; b < hi && b < freq.length; b++) peak = Math.max(peak, freq[b] ?? 0);
    out.push(clamp01((peak / 255) * sensitivity));
  }
  return out;
}

/**
 * Time-domain samples as a polyline in 0–1, centred on 0.5 — docs/05 §6 "wave".
 *
 * Down-sampled to `points` by taking the extreme excursion in each window
 * rather than every nth sample: nth-sample decimation aliases a waveform badly
 * enough to make a steady tone look like it is wobbling.
 */
export function wavePoints(time: ArrayLike<number>, points: number, sensitivity = 1): number[] {
  const out: number[] = [];
  if (points <= 0 || time.length === 0) return out;
  const per = time.length / points;

  for (let i = 0; i < points; i++) {
    const lo = Math.floor(i * per);
    const hi = Math.max(lo + 1, Math.floor((i + 1) * per));
    let extreme = 0;
    for (let s = lo; s < hi && s < time.length; s++) {
      const d = ((time[s] ?? 128) - 128) / 128;
      if (Math.abs(d) > Math.abs(extreme)) extreme = d;
    }
    out.push(clamp01(0.5 + (extreme * sensitivity) / 2));
  }
  return out;
}

/**
 * Low-band energy, 0–1 — the tally pulse and the ring's breathing radius.
 *
 * This is the one number that keeps working with `visualizer: 'off'`, which is
 * `05 §6`'s point: "even Visualizer: off keeps one live beat element".
 */
export function beatEnergy(freq: ArrayLike<number>, sensitivity = 1): number {
  const end = Math.max(1, Math.floor(freq.length * BEAT_BAND));
  let sum = 0;
  for (let i = 0; i < end; i++) sum += freq[i] ?? 0;
  return clamp01((sum / end / 255) * sensitivity);
}

/**
 * The adaptive degrade decision — docs/05 §6, "skips frames if the frame budget
 * is exceeded twice in a row".
 *
 * Pure so the rule is testable without a slow machine: the component feeds it
 * the last frame's duration and the current strike count, and gets back what to
 * do. Two consecutive overruns, not one — a single long frame is a garbage
 * collection or a tab switch, and degrading on it would make the visualizer
 * permanently worse after one hiccup.
 *
 * Recovery is deliberately asymmetric: strikes reset to zero on the first frame
 * that comes in under budget, so a machine that recovers gets its full frame
 * rate back immediately, while one that is genuinely struggling keeps skipping.
 */
export interface TtDegradeState {
  /** Consecutive over-budget frames seen so far. */
  strikes: number;
  /** True when this frame should be skipped rather than drawn. */
  skip: boolean;
}

/** 60 fps leaves ~16.7 ms; over 20 ms the visualizer is costing the page. */
export const TT_FRAME_BUDGET_MS = 20;

export function nextDegrade(
  lastFrameMs: number,
  previous: TtDegradeState,
  budgetMs = TT_FRAME_BUDGET_MS,
): TtDegradeState {
  if (lastFrameMs <= budgetMs) return { strikes: 0, skip: false };
  const strikes = previous.strikes + 1;
  // Skip every OTHER frame once degraded — halving the work is the cheapest
  // intervention that actually changes the load, and it stays visibly animated.
  return { strikes, skip: strikes >= 2 ? !previous.skip : false };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
