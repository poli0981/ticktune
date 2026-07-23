/**
 * The adaptive scrim — docs/03 §2 Z1 and docs/03 §8.
 *
 * `03 §2`: "scrim auto-raises if contrast sampling under digits < 4.5:1".
 * `02 §3.1`: `scrimAuto` "may RAISE scrimStrength; it never lowers it".
 *
 * Pure WCAG arithmetic, so the rule is a solved number rather than a slider
 * someone nudged until it looked fine. The DOM half — sampling the pixels that
 * are actually under the digits — belongs to the component; everything here
 * takes numbers and returns numbers.
 */

/** docs/03 §8: "all text >= 4.5:1 against effective background". */
export const TT_MIN_CONTRAST = 4.5;

/** docs/02 §3.1 clamps `scrimStrength` to this range. */
export const TT_SCRIM_MIN = 0.35;
export const TT_SCRIM_MAX = 0.6;

/** `#rrggbb` → `[r, g, b]` in 0–255. Returns null on anything malformed. */
export function parseHex(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** WCAG 2.1 relative luminance. Channels in 0–255, result 0–1. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (v: number): number => {
    const s = Math.min(255, Math.max(0, v)) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two luminances, 1–21. Order does not matter. */
export function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Mean luminance of an RGBA sample — what the component hands over after
 * drawing the composited background into a small canvas.
 *
 * Alpha is ignored on purpose: the sample comes from a canvas the background
 * was drawn onto opaquely, so every pixel is already the colour the user sees.
 * Weighting by alpha would quietly discount pixels that are fully visible.
 */
export function meanLuminance(rgba: ArrayLike<number>): number {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pixels; i++) {
    sum += relativeLuminance(rgba[i * 4] ?? 0, rgba[i * 4 + 1] ?? 0, rgba[i * 4 + 2] ?? 0);
  }
  return sum / pixels;
}

/**
 * The scrim alpha that brings `backgroundLuminance` to `TT_MIN_CONTRAST`
 * against the digits — never below the user's own setting.
 *
 * The scrim is black at alpha `a` over the background, so the composited
 * luminance is `bg * (1 - a)`. Solving `ratio(text, bg * (1 - a)) >= 4.5` for
 * `a` gives the closed form below; there is no search loop, and the result is
 * the same number every time for the same input, which is what makes the E2E
 * assertion about it meaningful.
 *
 * ⚠️ **It returns `floor` when the background is already dark enough.** That is
 * `02 §3.1`'s "never lowers it" expressed as arithmetic rather than as a
 * comment: a user who asked for 0.60 keeps 0.60 over a black background, and
 * auto only ever adds.
 *
 * @param floor the user's `scrimStrength` (docs/02 §3.1, 0.35–0.60)
 * @returns alpha in `[floor, TT_SCRIM_MAX]`
 */
export function scrimFor(
  backgroundLuminance: number,
  textLuminance: number,
  floor: number,
): number {
  const clampedFloor = Math.min(TT_SCRIM_MAX, Math.max(TT_SCRIM_MIN, floor));
  const bg = Math.max(0, backgroundLuminance);

  // Already legible at the user's own level? Then auto has nothing to add.
  if (contrastRatio(textLuminance, bg * (1 - clampedFloor)) >= TT_MIN_CONTRAST) {
    return clampedFloor;
  }

  // ratio = (text + .05) / (bg(1-a) + .05) = 4.5  =>  a = 1 - target/bg
  const target = (textLuminance + 0.05) / TT_MIN_CONTRAST - 0.05;
  if (bg <= 0) return clampedFloor;
  const needed = 1 - target / bg;

  /*
   * Capped at TT_SCRIM_MAX, and the cap can lose — docs/02 §3.1 fixes the range
   * at 0.35–0.60 and a background bright enough to need more than 0.60 cannot
   * be rescued by a scrim that is not allowed to reach it. Returning the cap is
   * honest; silently exceeding the documented range would not be, and the
   * remaining legibility is what the digit glow (03 §1) is for.
   */
  return Math.min(TT_SCRIM_MAX, Math.max(clampedFloor, needed));
}
