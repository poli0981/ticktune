import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TT_MAX_BACKGROUND_IMAGES, backdrop } from '../../src/app/state/backdrop.svelte';
import { ttLog } from '../../src/app/engine/log/tt-log';

/**
 * The backdrop store — docs/03 §2 Z1, P5 slice 3.
 *
 * The store tier docs/13 §1 describes: "the tier the engines cannot fail".
 * `TtUrlLedger` is already unit-tested and correct; what is untested until here
 * is whether this store USES it — and an object-URL leak is invisible to every
 * other tier, which is the whole reason docs/09 §5 calls the count a canary.
 */

let created: string[];
let revoked: string[];

beforeEach(() => {
  created = [];
  revoked = [];
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => {
      const url = `blob:tt-${created.length}`;
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => void revoked.push(url)),
  });
  vi.stubGlobal('crypto', { randomUUID: () => `id-${created.length}` });
  ttLog.clear();
  backdrop.clearImages();
  revoked = [];
});

afterEach(() => vi.unstubAllGlobals());

const png = (name: string): File => new File([new Uint8Array([1])], name, { type: 'image/png' });

describe('picking pictures', () => {
  it('keeps images and gives each a blob URL', () => {
    backdrop.setImages([png('a.png'), png('b.png')]);
    expect(backdrop.images).toHaveLength(2);
    expect(backdrop.images[0]!.url).toMatch(/^blob:/);
    expect(backdrop.images[0]!.name).toBe('a.png');
    expect(backdrop.liveUrls).toBe(2);
  });

  it('rejects a non-image and says so with TT-IMG-001, not TT-IMP-001', () => {
    /*
     * The family matters (docs/12 §6). `TT-IMP-*` is keyed straight into the
     * import summary toast by code, so a rejected background carrying an
     * importer code would surface as "Format not supported" inside a toast
     * about music.
     */
    backdrop.setImages([png('ok.png'), new File([], 'song.mp3', { type: 'audio/mpeg' })]);
    expect(backdrop.images).toHaveLength(1);
    expect(ttLog.entries().map((e) => e.code)).toContain('TT-IMG-001');
    expect(ttLog.entries().map((e) => e.code)).not.toContain('TT-IMP-001');
  });

  it('caps the set and reports the drop rather than truncating silently', () => {
    const many = Array.from({ length: TT_MAX_BACKGROUND_IMAGES + 5 }, (_, i) => png(`${i}.png`));
    backdrop.setImages(many);
    expect(backdrop.images).toHaveLength(TT_MAX_BACKGROUND_IMAGES);
    expect(ttLog.entries().map((e) => e.code)).toContain('TT-IMG-002');
  });

  it('logs nothing when every file is fine', () => {
    backdrop.setImages([png('a.png')]);
    const codes = ttLog.entries().map((e) => e.code);
    expect(codes).not.toContain('TT-IMG-001');
    expect(codes).not.toContain('TT-IMG-002');
  });
});

describe('the URL ledger — docs/05 §3, docs/09 §5', () => {
  it('revokes the previous set before creating the next', () => {
    /*
     * The leak this catches is silent by construction: replacing `#images`
     * makes the old URLs unreachable, the pictures keep rendering from the new
     * ones, and nothing anywhere looks wrong. Only the count can tell.
     */
    backdrop.setImages([png('a.png'), png('b.png')]);
    const first = backdrop.images.map((i) => i.url);
    revoked = [];

    backdrop.setImages([png('c.png')]);
    expect(revoked).toEqual(expect.arrayContaining(first));
    expect(backdrop.liveUrls).toBe(1);
  });

  it('drops to zero on clear and on dispose', () => {
    backdrop.setImages([png('a.png'), png('b.png')]);
    backdrop.clearImages();
    expect(backdrop.liveUrls).toBe(0);
    expect(backdrop.images).toEqual([]);

    backdrop.setImages([png('c.png')]);
    backdrop.dispose();
    expect(backdrop.liveUrls).toBe(0);
  });

  it('creates exactly one URL per accepted file, never per read', () => {
    backdrop.setImages([png('a.png'), png('b.png')]);
    const before = created.length;
    // Reading the getter repeatedly must not mint anything.
    void backdrop.images;
    void backdrop.current;
    void backdrop.current;
    expect(created.length).toBe(before);
  });
});

describe('the slideshow cursor', () => {
  it('wraps', () => {
    backdrop.setImages([png('a.png'), png('b.png'), png('c.png')]);
    expect(backdrop.index).toBe(0);
    backdrop.advance();
    backdrop.advance();
    expect(backdrop.index).toBe(2);
    backdrop.advance();
    expect(backdrop.index).toBe(0);
  });

  it('is inert below two pictures — a one-image slideshow must not flicker', () => {
    backdrop.setImages([png('a.png')]);
    backdrop.advance();
    expect(backdrop.index).toBe(0);
  });

  it('resets to the first picture when the set is replaced', () => {
    // Otherwise a cursor left at 5 points past the end of a shorter new set.
    backdrop.setImages([png('a.png'), png('b.png'), png('c.png')]);
    backdrop.advance();
    backdrop.advance();
    backdrop.setImages([png('x.png'), png('y.png')]);
    expect(backdrop.index).toBe(0);
    expect(backdrop.current?.name).toBe('x.png');
  });

  it('reports no current picture when there are none', () => {
    expect(backdrop.current).toBeNull();
  });
});

describe('auto-theme hue', () => {
  it('is null with no cover art, without touching the canvas', async () => {
    // docs/03 §5 "skipped when no cover art". Reaching for a canvas here would
    // throw in Node and, more importantly, would be work with no question.
    await backdrop.readHue(null);
    expect(backdrop.hue).toBeNull();
  });

  it('swallows an unreadable cover rather than breaking the render', async () => {
    // Decoration, and the same rule `makeCoverUrl` follows: a cover that will
    // not decode must never take playback with it.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('gone'))),
    );
    await backdrop.readHue('blob:broken');
    expect(backdrop.hue).toBeNull();
  });
});
