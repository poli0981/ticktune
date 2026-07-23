/**
 * Auto-theme's colour half — docs/03 §5.
 *
 * "sample the embedded cover art via a 16×16 canvas median-cut → derive one
 * dominant hue → tint the gradient background and digit glow (never the digit
 * core color; legibility first)".
 *
 * Takes the RGBA bytes rather than an image, so the whole decision is pure and
 * unit-testable; the component owns the 16×16 canvas draw. One number comes
 * back — a hue — and never a full colour, because tinting with a sampled colour
 * is how a dark UI ends up with a pale background nobody asked for. The
 * saturation and lightness of the result are ours.
 */

/** Hue in degrees, or null when the art has no colour worth borrowing. */
export type TtHue = number | null;

/** Pixels this close to grey carry no usable hue and are dropped. */
const MIN_CHROMA = 24;
/** Album art is full of black bars and blown highlights; neither is the theme. */
const MIN_VALUE = 24;
const MAX_VALUE = 242;
/** Below this share of the sample, the "dominant" hue is noise. */
const MIN_SHARE = 0.08;

interface Box {
  pixels: [number, number, number][];
}

function longestAxis(box: Box): 0 | 1 | 2 {
  const lo: [number, number, number] = [255, 255, 255];
  const hi: [number, number, number] = [0, 0, 0];
  for (const p of box.pixels) {
    for (const c of [0, 1, 2] as const) {
      lo[c] = Math.min(lo[c], p[c]);
      hi[c] = Math.max(hi[c], p[c]);
    }
  }
  const spread = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const max = Math.max(...spread);
  return (spread.indexOf(max) as 0 | 1 | 2) ?? 0;
}

/** RGB → hue in degrees. Returns null for an achromatic pixel. */
export function hueOf(r: number, g: number, b: number): TtHue {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma < 1) return null;
  let h: number;
  if (max === r) h = ((g - b) / chroma) % 6;
  else if (max === g) h = (b - r) / chroma + 2;
  else h = (r - g) / chroma + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/**
 * The dominant hue of an RGBA sample, or null.
 *
 * Null is a real answer and the caller must handle it: `03 §5` says auto-theme
 * is "skipped when no cover art", and a greyscale sleeve is the same situation
 * arriving by a different route. Returning an arbitrary hue for a black-and-white
 * cover would tint the whole app off a rounding error.
 *
 * @param depth median-cut splits; 3 gives 8 boxes, which is what a 256-pixel
 *   sample supports without boxes becoming single pixels.
 */
export function dominantHue(rgba: ArrayLike<number>, depth = 3): TtHue {
  const total = Math.floor(rgba.length / 4);
  if (total === 0) return null;

  const pixels: [number, number, number][] = [];
  for (let i = 0; i < total; i++) {
    const r = rgba[i * 4] ?? 0;
    const g = rgba[i * 4 + 1] ?? 0;
    const b = rgba[i * 4 + 2] ?? 0;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < MIN_CHROMA) continue;
    if (max < MIN_VALUE || max > MAX_VALUE) continue;
    pixels.push([r, g, b]);
  }
  if (pixels.length / total < MIN_SHARE) return null;

  let boxes: Box[] = [{ pixels }];
  for (let d = 0; d < depth; d++) {
    const next: Box[] = [];
    for (const box of boxes) {
      if (box.pixels.length < 2) {
        next.push(box);
        continue;
      }
      const axis = longestAxis(box);
      const sorted = [...box.pixels].sort((a, b) => a[axis] - b[axis]);
      const mid = Math.floor(sorted.length / 2);
      next.push({ pixels: sorted.slice(0, mid) }, { pixels: sorted.slice(mid) });
    }
    boxes = next;
  }

  /*
   * Population ALONE picks the wrong box on most sleeves — the largest cluster
   * is usually a desaturated background. Weighting by chroma asks for "the most
   * colour", which is what a human means by a cover's colour.
   */
  let best: { score: number; hue: number } | null = null;
  for (const box of boxes) {
    if (box.pixels.length === 0) continue;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const p of box.pixels) {
      r += p[0];
      g += p[1];
      b += p[2];
    }
    const n = box.pixels.length;
    r /= n;
    g /= n;
    b /= n;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const hue = hueOf(r, g, b);
    if (hue === null) continue;
    const score = n * chroma;
    if (!best || score > best.score) best = { score, hue };
  }
  return best?.hue ?? null;
}
