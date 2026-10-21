import { errorName } from '../log/tt-log';

/**
 * Read a picture's pixels at `size`×`size` — the step the adaptive scrim
 * (docs/03 §2, 8×8) and auto-theme's hue (docs/03 §5, 16×16) share.
 *
 * ## Through an `<img>`, never `fetch`
 *
 * Both samplers used to `fetch(blobUrl)` and hand the Blob to
 * `createImageBitmap`. To CSP a fetch is a CONNECTION, and `connect-src` has
 * never allowed `blob:` (docs/09 §4) — so from v0.7.0 to v2.0.0 every sample
 * was refused, both catches swallowed it, and neither feature ever ran in
 * production. Decoding through an image element is checked against `img-src`,
 * which allows `blob:` for the pictures themselves. That choice lives in the
 * driver's `decode`; this module only decides what to do with the answer, and
 * says why when there is none.
 */

export interface TtSamplePorts {
  /** Decode the picture — through an `<img>`, i.e. `img-src`, never `connect-src`. */
  decode(url: string): Promise<CanvasImageSource>;
  /** A `size`×`size` 2D context, or null when the browser refuses one. */
  context(size: number): Pick<CanvasRenderingContext2D, 'drawImage' | 'getImageData'> | null;
}

/** The pixels, or the reason there are none — an error NAME (docs/12 §6), never a message. */
type TtImageSample = { ok: true; rgba: Uint8ClampedArray } | { ok: false; reason: string };

export async function sampleImage(
  url: string,
  size: number,
  ports: TtSamplePorts,
): Promise<TtImageSample> {
  try {
    const source = await ports.decode(url);
    const ctx = ports.context(size);
    if (!ctx) return { ok: false, reason: 'no-2d-context' };
    ctx.drawImage(source, 0, 0, size, size);
    return { ok: true, rgba: ctx.getImageData(0, 0, size, size).data };
  } catch (err) {
    return { ok: false, reason: errorName(err) };
  }
}
