import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleImage, type TtSamplePorts } from '../../src/app/engine/visuals/tt-image-sample';
import { browserSamplePorts } from '../../src/app/engine/visuals/tt-image-sample-driver';

/**
 * The picture sampler — docs/03 §2's scrim and docs/03 §5's hue, v2.0.1.
 *
 * Both used to `fetch` a blob: URL, which CSP's `connect-src` refuses
 * (docs/09 §4). Every sample failed in production from v0.7.0 to v2.0.0 and
 * both catches stayed silent, so the two things worth pinning are the ones that
 * hid it: the driver decodes through an `<img>` and never fetches, and a
 * failure comes back with a reason instead of vanishing.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fakePorts(rgba: Uint8ClampedArray, over: Partial<TtSamplePorts> = {}) {
  const source = { tag: 'decoded' } as unknown as CanvasImageSource;
  const drawImage = vi.fn();
  const getImageData = vi.fn(() => ({ data: rgba }) as ImageData);
  const ports: TtSamplePorts = {
    decode: vi.fn(() => Promise.resolve(source)),
    context: vi.fn(() => ({ drawImage, getImageData }) as never),
    ...over,
  };
  return { ports, source, drawImage, getImageData };
}

describe('sampleImage', () => {
  it('draws the whole picture into size×size and returns those pixels', async () => {
    const rgba = new Uint8ClampedArray(8 * 8 * 4).fill(255);
    const { ports, source, drawImage, getImageData } = fakePorts(rgba);

    const sample = await sampleImage('blob:pic', 8, ports);

    expect(ports.decode).toHaveBeenCalledWith('blob:pic');
    expect(ports.context).toHaveBeenCalledWith(8);
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 8, 8);
    expect(getImageData).toHaveBeenCalledWith(0, 0, 8, 8);
    expect(sample).toEqual({ ok: true, rgba });
  });

  it('turns a picture that will not decode into a reason, never a throw', async () => {
    const { ports } = fakePorts(new Uint8ClampedArray(4), {
      decode: () => Promise.reject(new DOMException('bad', 'EncodingError')),
    });
    await expect(sampleImage('blob:broken', 8, ports)).resolves.toEqual({
      ok: false,
      reason: 'EncodingError',
    });
  });

  it('names a refused 2D context', async () => {
    const { ports } = fakePorts(new Uint8ClampedArray(4), { context: () => null });
    await expect(sampleImage('blob:pic', 16, ports)).resolves.toEqual({
      ok: false,
      reason: 'no-2d-context',
    });
  });

  it('reports a NAME only — a message can carry a file name (docs/12 §6)', async () => {
    const { ports } = fakePorts(new Uint8ClampedArray(4), {
      decode: () => Promise.reject(new Error('could not read holiday-photo.jpg')),
    });
    const sample = await sampleImage('blob:pic', 8, ports);
    expect(sample).toEqual({ ok: false, reason: 'Error' });
  });
});

describe('browserSamplePorts — the driver', () => {
  it('decodes through an <img> and never fetches the blob: URL (connect-src)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const made: { src: string; decoding: string; decode: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        decoding = '';
        decode = vi.fn(() => Promise.resolve());
        constructor() {
          made.push(this);
        }
      },
    );

    const decoded = await browserSamplePorts.decode('blob:https://ticktune.net/abc');

    expect(made).toHaveLength(1);
    expect(made[0]!.src).toBe('blob:https://ticktune.net/abc');
    expect(made[0]!.decode).toHaveBeenCalled();
    expect(decoded).toBe(made[0]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hands back a size×size context with smoothing off', () => {
    const ctx = { imageSmoothingEnabled: true };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) };
    const real = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? canvas : real(tag)) as typeof document.createElement);

    expect(browserSamplePorts.context(16)).toBe(ctx);
    expect(canvas.width).toBe(16);
    expect(canvas.height).toBe(16);
    expect(canvas.getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
    expect(ctx.imageSmoothingEnabled).toBe(false);
  });

  it('returns null when the browser refuses a 2D context', () => {
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => null) };
    const real = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? canvas : real(tag)) as typeof document.createElement);
    expect(browserSamplePorts.context(8)).toBeNull();
  });
});
