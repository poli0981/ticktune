/**
 * The six gradient presets — docs/03 §6 "Gradient (6 presets + custom)".
 *
 * Pure data plus one string builder, so the palette is unit-testable and the
 * component owns no colour decisions (docs/12 §3.1).
 *
 * ## Why every preset is dark
 *
 * `03 §1` puts legibility first and `03 §8` requires ≥ 4.5:1 for all text. The
 * countdown is `--color-tt-digit` (`TT_PALETTE.digit`, warm white) and sits
 * directly on this layer when no image is composited over it, so a light preset
 * would either fail contrast outright or force the scrim to its 0.60 ceiling and
 * still fail. Keeping the stops dark means `scrimAuto` (docs/02 §3.1) has room
 * to work rather than being the only thing standing between the user and an
 * unreadable clock.
 *
 * v1.1 ("Rack Unit"): warm graphite first, then five studio-lit variants. Each
 * pair is a colour pushed down to chassis brightness, never a bright hue.
 */

/** `gradientPreset` is `0 | 1 | 2 | 3 | 4 | 5` in docs/02 §3.1. */
export const TT_GRADIENT_PRESETS: readonly (readonly [string, string])[] = [
  // 0 — the default. Chassis into panel: anodised graphite, barely lit.
  ['#0e0d0b', '#1d1a16'],
  // 1 — amber, the signal colour as a warm wash behind the glass.
  ['#120c04', '#2a1a06'],
  // 2 — oxide. Related to the tally red, kept far enough down that the < 60 s
  //     danger digits never compete with it.
  ['#140605', '#2b0e0b'],
  // 3 — control-room teal, the one cool preset: a counterweight to the warm set.
  ['#04100f', '#0b2623'],
  // 4 — midnight indigo.
  ['#08081a', '#17163a'],
  // 5 — moss.
  ['#0a0f06', '#19240f'],
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
