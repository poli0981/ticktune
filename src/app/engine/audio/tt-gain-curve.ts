/**
 * Equal-power gain curves — docs/05 §2.
 *
 * `gainOut = cos(t·π/2)`, `gainIn = sin(t·π/2)`. The property that makes them
 * "equal power" is `out² + in² = 1` at every point, which is why a crossfade
 * built on them has no volume dip in the middle the way a linear pair does.
 *
 * **Fade-OUT only in P2.** The fade-in half arrives with the crossfade loop
 * style, which `docs/15 §S4b` still gates. Exporting it now would be an unused
 * export (knip fails the build) and an unreachable branch inside the coverage
 * denominator — so it is absent rather than dormant.
 */

/**
 * @param t normalised position through the fade, 0 → 1.
 * @returns the outgoing gain: 1 at t=0, 0 at t=1.
 */
export function equalPowerOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return Math.cos((clamped * Math.PI) / 2);
}

/**
 * Sampled curve for `setValueCurveAtTime`.
 *
 * 64 steps: enough that the ear hears a smooth ramp rather than a stair, cheap
 * enough that it is irrelevant. Web Audio interpolates between the samples, so
 * this is not the resolution of the fade — only of its shape.
 */
export function equalPowerOutCurve(steps = 64): Float32Array {
  const out = new Float32Array(steps);
  for (let i = 0; i < steps; i++) out[i] = equalPowerOut(i / (steps - 1));
  return out;
}
