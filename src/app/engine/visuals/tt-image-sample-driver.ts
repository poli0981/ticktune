import type { TtSamplePorts } from './tt-image-sample';

/**
 * The browser half of `sampleImage` — docs/03 §2's scrim, docs/03 §5's hue.
 *
 * Named `*-driver.ts` so the coverage gate skips it (docs/13 §1): happy-dom
 * neither decodes images nor rasterises a canvas, so "unit testing" this would
 * be asserting the mocks. What it decides is pinned by `tt-image-sample.test.ts`
 * against stubs — above all that it never fetches.
 *
 * 🔴 **Never `fetch(url)` here.** The URL is a `blob:`, a fetch is checked
 * against `connect-src`, and `connect-src` does not allow `blob:` and must not
 * start to (docs/09 §4). That is exactly how both samplers were dead in
 * production from v0.7.0 to v2.0.0. An `<img>` is checked against `img-src`.
 */
export const browserSamplePorts: TtSamplePorts = {
  async decode(url) {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  },

  context(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    // Nearest-neighbour, as the old `resizeQuality: 'pixelated'` was: the
    // median cut (`tt-dominant-hue.ts`) wants real pixels, not blends of them.
    ctx.imageSmoothingEnabled = false;
    return ctx;
  },
};
