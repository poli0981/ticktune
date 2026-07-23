/**
 * The six gradient presets — docs/03 §6 "Gradient (6 presets + custom)".
 *
 * Pure data plus one string builder, so the palette is unit-testable and the
 * component owns no colour decisions (docs/12 §3.1).
 *
 * ## Why every preset is dark
 *
 * `03 §1` puts legibility first and `03 §8` requires ≥ 4.5:1 for all text. The
 * countdown is `--color-tt-text` (#E7EBF2) and sits directly on this layer when
 * no image is composited over it, so a light preset would either fail contrast
 * outright or force the scrim to its 0.60 ceiling and still fail. Keeping the
 * stops dark means `scrimAuto` (docs/02 §3.1) has room to work rather than being
 * the only thing standing between the user and an unreadable clock.
 */

/** `gradientPreset` is `0 | 1 | 2 | 3 | 4 | 5` in docs/02 §3.1. */
export const TT_GRADIENT_PRESETS: readonly (readonly [string, string])[] = [
  // 0 — the default. Void into surface: the studio wall, barely lit.
  ['#08090c', '#10131a'],
  // 1 — signal cyan, the primary accent pushed down into a near-black blue.
  ['#04101a', '#0a2a3a'],
  // 2 — ember, the warm counterpart (tt-warn's hue at studio brightness).
  ['#140a05', '#2a1608'],
  // 3 — crimson. Related to tt-danger, which the digits themselves turn below
  //     60 s; the stops stay far enough down that the two never compete.
  ['#140406', '#2a0a10'],
  // 4 — violet, the one preset with no token behind it. Included because the
  //     other five are all "a token, darkened", which is a narrow range.
  ['#0b0714', '#1c1030'],
  // 5 — forest.
  ['#05100b', '#0c2418'],
] as const;

/** `#rrggbb`, the same shape `clampSettings` validates `gradientCustom` against. */
const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * The stops actually in force — custom wins over the preset when it is valid.
 *
 * `clampSettings` already nulls a malformed `gradientCustom`, so the HEX test
 * here is belt-and-braces for a caller that did not come through the store. It
 * is cheap and it keeps this module usable on its own.
 */
export function gradientStops(
  preset: number,
  custom: readonly [string, string] | null,
): readonly [string, string] {
  if (custom && HEX.test(custom[0]) && HEX.test(custom[1])) return [custom[0], custom[1]];
  return TT_GRADIENT_PRESETS[preset] ?? TT_GRADIENT_PRESETS[0]!;
}

/**
 * A CSS value for `background-image`.
 *
 * 160deg rather than `to bottom`: the countdown sits centre-left with the rail
 * to its right (`03 §2`), so a diagonal puts the lighter stop behind the rail
 * instead of behind the digits.
 */
export function gradientCss(
  preset: number,
  custom: readonly [string, string] | null = null,
): string {
  const [from, to] = gradientStops(preset, custom);
  return `linear-gradient(160deg, ${from} 0%, ${to} 100%)`;
}
