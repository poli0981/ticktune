import { describe, expect, it } from 'vitest';
import {
  TT_GRADIENT_PRESETS,
  gradientCss,
  gradientStops,
} from '../../src/app/engine/visuals/tt-gradient';
import {
  TT_MIN_CONTRAST,
  TT_SCRIM_MAX,
  TT_SCRIM_MIN,
  contrastRatio,
  meanLuminance,
  parseHex,
  relativeLuminance,
  scrimFor,
} from '../../src/app/engine/visuals/tt-contrast';
import { dominantHue, hueOf } from '../../src/app/engine/visuals/tt-dominant-hue';

/**
 * P5 slice 3's pure half — docs/13 §1.
 *
 * These three modules exist so the Z1 stack decides nothing in a component:
 * the palette, the WCAG arithmetic behind the adaptive scrim, and auto-theme's
 * hue extraction are all numbers in, numbers out.
 */

const TEXT = relativeLuminance(0xe7, 0xeb, 0xf2); // --color-tt-text

describe('gradient presets — docs/03 §6', () => {
  it('has exactly the six the spec promises', () => {
    // `gradientPreset` is typed `0 | 1 | 2 | 3 | 4 | 5` in docs/02 §3.1, and
    // clampSettings bounds it to 0–5. A seventh would be unreachable.
    expect(TT_GRADIENT_PRESETS).toHaveLength(6);
  });

  it('keeps every stop dark enough for the digits to clear 4.5:1', () => {
    /*
     * The reason all six are dark, asserted rather than commented. The digits
     * sit directly on this layer when no image is composited over it, and
     * docs/03 §8 requires >= 4.5:1. Checked at the MINIMUM scrim, because a
     * preset that only passes at the maximum leaves the user no room.
     */
    for (const [from, to] of TT_GRADIENT_PRESETS) {
      for (const stop of [from, to]) {
        const rgb = parseHex(stop);
        expect(rgb, stop).not.toBeNull();
        const scrimmed = relativeLuminance(...rgb!) * (1 - TT_SCRIM_MIN);
        expect(contrastRatio(TEXT, scrimmed), stop).toBeGreaterThanOrEqual(TT_MIN_CONTRAST);
      }
    }
  });

  it('lets a valid custom pair win over the preset', () => {
    expect(gradientStops(2, ['#112233', '#445566'])).toEqual(['#112233', '#445566']);
  });

  it('falls back to the preset when the custom pair is malformed', () => {
    // clampSettings already nulls these, so this is the module standing on its
    // own — it must not emit `linear-gradient(160deg, red 0%, ...)`.
    expect(gradientStops(1, ['nonsense', '#445566'])).toEqual(TT_GRADIENT_PRESETS[1]);
    expect(gradientStops(1, ['#4455', '#445566'])).toEqual(TT_GRADIENT_PRESETS[1]);
  });

  it('falls back to preset 0 for an out-of-range index', () => {
    expect(gradientStops(99, null)).toEqual(TT_GRADIENT_PRESETS[0]);
  });

  it('builds a CSS gradient carrying both stops', () => {
    const css = gradientCss(0, null);
    expect(css).toContain(TT_GRADIENT_PRESETS[0]![0]);
    expect(css).toContain(TT_GRADIENT_PRESETS[0]![1]);
    expect(css.startsWith('linear-gradient(')).toBe(true);
  });
});

describe('WCAG arithmetic', () => {
  it('parses #rrggbb and rejects everything else', () => {
    expect(parseHex('#4FD1FF')).toEqual([0x4f, 0xd1, 0xff]);
    expect(parseHex('#4fd1ff')).toEqual([0x4f, 0xd1, 0xff]);
    expect(parseHex('4fd1ff')).toBeNull();
    expect(parseHex('#4fd1f')).toBeNull();
    expect(parseHex('#4fd1fff')).toBeNull();
    expect(parseHex('')).toBeNull();
  });

  it('matches the WCAG reference points', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 5);
    // Black on white is the definitional 21:1.
    expect(contrastRatio(0, 1)).toBeCloseTo(21, 4);
    // A colour against itself is 1:1, in either argument order.
    expect(contrastRatio(0.3, 0.3)).toBeCloseTo(1, 6);
    expect(contrastRatio(1, 0)).toBeCloseTo(contrastRatio(0, 1), 6);
  });

  it('averages luminance across an RGBA buffer, ignoring alpha', () => {
    // Two black pixels and two white ones: the mean sits between them, and a
    // zero alpha on one of the whites must not discount it — the sample comes
    // from an opaque canvas.
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 0,
    ]);
    expect(meanLuminance(rgba)).toBeCloseTo(0.5, 5);
  });

  it('returns 0 for an empty sample rather than dividing by zero', () => {
    expect(meanLuminance(new Uint8ClampedArray([]))).toBe(0);
  });
});

describe('the adaptive scrim — docs/02 §3.1 "never lowers it"', () => {
  it('leaves a dark background at the user’s own level', () => {
    // Void (#08090C) is already far past 4.5:1; auto has nothing to add, so the
    // user's 0.35 survives untouched.
    const bg = relativeLuminance(0x08, 0x09, 0x0c);
    expect(scrimFor(bg, TEXT, 0.35)).toBeCloseTo(0.35, 6);
  });

  it('never returns less than the floor, however dark the background', () => {
    // The property that IS the rule. A user who chose 0.60 keeps 0.60 over pure
    // black — auto is allowed to add and never to subtract.
    for (const floor of [0.35, 0.45, 0.5, 0.6]) {
      expect(scrimFor(0, TEXT, floor)).toBeCloseTo(floor, 6);
      expect(scrimFor(0.02, TEXT, floor)).toBeGreaterThanOrEqual(floor - 1e-9);
    }
  });

  it('raises the scrim on a bright background until 4.5:1 is reached', () => {
    // A mid-grey photo is the case this exists for.
    const bg = relativeLuminance(150, 150, 150);
    const a = scrimFor(bg, TEXT, TT_SCRIM_MIN);
    expect(a).toBeGreaterThan(TT_SCRIM_MIN);
    // And it lands ON the target rather than near it, unless the cap intervened.
    if (a < TT_SCRIM_MAX) {
      expect(contrastRatio(TEXT, bg * (1 - a))).toBeCloseTo(TT_MIN_CONTRAST, 3);
    }
  });

  it('caps at 0.60 and reports the cap rather than exceeding the range', () => {
    /*
     * A white background needs more than the documented maximum. docs/02 §3.1
     * fixes the range at 0.35–0.60, so returning 0.8 would be this module
     * quietly overruling the schema. The cap is honest; the digit glow
     * (docs/03 §1) is what covers the remainder.
     */
    const a = scrimFor(relativeLuminance(255, 255, 255), TEXT, TT_SCRIM_MIN);
    expect(a).toBe(TT_SCRIM_MAX);
  });

  it('clamps a floor that arrives outside the documented range', () => {
    expect(scrimFor(0, TEXT, 0)).toBeCloseTo(TT_SCRIM_MIN, 6);
    expect(scrimFor(0, TEXT, 9)).toBeCloseTo(TT_SCRIM_MAX, 6);
  });

  it('is monotonic in background brightness', () => {
    // Brighter background can never need LESS scrim. Cheap property, and it is
    // the shape of the bug a sign error would produce.
    let previous = 0;
    for (let v = 0; v <= 255; v += 15) {
      const a = scrimFor(relativeLuminance(v, v, v), TEXT, TT_SCRIM_MIN);
      expect(a).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = a;
    }
  });
});

describe('dominant hue — docs/03 §5', () => {
  /** Build an RGBA buffer from a repeated colour list. */
  const sample = (colours: [number, number, number][], each = 16): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(colours.length * each * 4);
    let i = 0;
    for (const [r, g, b] of colours) {
      for (let n = 0; n < each; n++) {
        out[i++] = r;
        out[i++] = g;
        out[i++] = b;
        out[i++] = 255;
      }
    }
    return out;
  };

  it('reads primaries off the colour wheel', () => {
    expect(hueOf(255, 0, 0)).toBeCloseTo(0, 3);
    expect(hueOf(0, 255, 0)).toBeCloseTo(120, 3);
    expect(hueOf(0, 0, 255)).toBeCloseTo(240, 3);
    // Negative wrap: magenta is 300, not -60.
    expect(hueOf(255, 0, 255)).toBeCloseTo(300, 3);
  });

  it('calls a grey pixel achromatic instead of inventing a hue', () => {
    expect(hueOf(128, 128, 128)).toBeNull();
  });

  it('finds the hue of a strongly coloured cover', () => {
    const hue = dominantHue(sample([[220, 40, 40]]));
    expect(hue).not.toBeNull();
    // Red sits at 0°, so "near red" has to be measured around the wrap rather
    // than as a plain range — 359 is as red as 1.
    expect(Math.min(hue!, 360 - hue!)).toBeLessThan(20);
  });

  it('returns null for a greyscale sleeve — auto-theme must skip, not guess', () => {
    /*
     * docs/03 §5 skips auto-theme "when no cover art". A black-and-white cover
     * is the same situation reached differently, and tinting the whole app off
     * a rounding error in a grey gradient is worse than not tinting.
     */
    expect(
      dominantHue(
        sample([
          [20, 20, 20],
          [128, 128, 128],
          [230, 230, 230],
        ]),
      ),
    ).toBeNull();
  });

  it('returns null for an empty sample', () => {
    expect(dominantHue(new Uint8ClampedArray([]))).toBeNull();
  });

  it('ignores letterbox black and blown highlights', () => {
    // Half the sample is black bars, a quarter is clipped white, and only a
    // quarter carries the artwork. The artwork still wins.
    const hue = dominantHue(
      sample([
        [0, 0, 0],
        [0, 0, 0],
        [255, 255, 255],
        [40, 90, 220],
      ]),
    );
    expect(hue).not.toBeNull();
    expect(hue!).toBeGreaterThan(200);
    expect(hue!).toBeLessThan(260);
  });

  it('prefers the most COLOURFUL cluster over the merely largest', () => {
    /*
     * The choice that makes this useful. Most sleeves are mostly a desaturated
     * background; picking by population returns that wash every time, which is
     * why the score is population x chroma.
     */
    const muted: [number, number, number] = [96, 100, 104];
    const vivid: [number, number, number] = [220, 60, 30];
    const colours: [number, number, number][] = [];
    for (let i = 0; i < 6; i++) colours.push(muted);
    colours.push(vivid);
    const hue = dominantHue(sample(colours));
    expect(hue).not.toBeNull();
    // Orange-red, not the near-grey's incidental blue.
    expect(hue!).toBeLessThan(40);
  });
});
