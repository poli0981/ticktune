import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TT_SW_PREFIX, ttSwRoute, ttSwStale } from '../../src/sw/tt-sw';

/**
 * The /app/ service worker's two decisions — docs/10 §9 (v2.0).
 *
 * Which requests it may answer is the whole privacy surface of the feature:
 * a cached `/api/*` answer would lie about the network (docs/06 §8), and a
 * cross-origin one would make YouTube's player or the beacon ours to store.
 */
const ORIGIN = 'https://ticktune.net';
const route = (path: string, method = 'GET') => ttSwRoute(new URL(path, ORIGIN), method, ORIGIN);

describe('ttSwRoute', () => {
  it('serves the app shell network-first', () => {
    expect(route('/app/')).toBe('shell');
    expect(route('/app/?ttdebug=1')).toBe('shell');
    expect(route('/app/index.html')).toBe('shell');
  });

  it('serves hashed and pinned files cache-first', () => {
    expect(route('/_astro/mount.Bx1c2D3e.js')).toBe('asset');
    expect(route('/_astro/be-vietnam-pro-vietnamese-500-normal.CuSs.woff2')).toBe('asset');
    expect(route('/fonts/dseg7/DSEG7Classic-Regular.woff2')).toBe('asset');
    expect(route('/icons/icon-192.png')).toBe('asset');
    expect(route('/favicon.svg')).toBe('asset');
    expect(route('/manifest.webmanifest')).toBe('asset');
  });

  it.each([
    ['/api/yt/oembed?id=dQw4w9WgXcQ', 'oEmbed is a live answer'],
    ['/api/yt/durations?ids=dQw4w9WgXcQ', 'so are lengths'],
    ['/', 'the landing is not the app'],
    ['/en/legal/privacy/', 'nor are the legal pages'],
    ['/sw.js', 'the worker itself is the browser’s to fetch'],
    ['/og/ticktune.png', 'not something the app asks for'],
  ])('leaves %s to the network (%s)', (path) => {
    expect(route(path)).toBe('network');
  });

  it('never answers another origin — YouTube, Google, the beacon', () => {
    for (const url of [
      'https://www.youtube.com/iframe_api',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      'https://static.cloudflareinsights.com/beacon.min.js',
      'https://ticktune.net.evil.example/_astro/x.js',
    ]) {
      expect(ttSwRoute(new URL(url), 'GET', ORIGIN)).toBe('network');
    }
  });

  it('never answers anything but GET', () => {
    expect(route('/_astro/x.js', 'POST')).toBe('network');
    expect(route('/app/', 'HEAD')).toBe('network');
  });
});

describe('ttSwStale', () => {
  const c = (v: string, installedAt: number) => ({ name: TT_SW_PREFIX + v, installedAt });

  it('keeps this version and the newest one before it', () => {
    const caches = [c('old', 1), c('older', 0), c('prev', 5), c('now', 9)];
    expect(ttSwStale(caches, TT_SW_PREFIX + 'now').sort()).toEqual(
      [TT_SW_PREFIX + 'old', TT_SW_PREFIX + 'older'].sort(),
    );
  });

  it('deletes nothing on a first install', () => {
    expect(ttSwStale([c('now', 9)], TT_SW_PREFIX + 'now')).toEqual([]);
  });

  it('never touches a cache that is not a shell cache', () => {
    const caches = [{ name: 'someone-else', installedAt: 0 }, c('a', 1), c('b', 2), c('now', 9)];
    expect(ttSwStale(caches, TT_SW_PREFIX + 'now')).toEqual([TT_SW_PREFIX + 'a']);
  });
});

/*
 * The built worker. `cache.addAll` is all-or-nothing: one precached URL that
 * 404s and the worker never installs — silently, from the app's side. So every
 * entry must exist in dist/, and none may be an /api/ path or the user's kind
 * of file. Skipped without a build locally; under CI a missing build fails.
 */
const DIST = join(process.cwd(), 'dist');
const SW = join(DIST, 'sw.js');

it.runIf(!!process.env['CI'])('CI built the service worker', () => {
  expect(existsSync(SW), 'dist/sw.js is missing — run `pnpm build` before `pnpm test`').toBe(true);
});

describe.skipIf(!existsSync(SW))('dist/sw.js — scripts/make-sw.ts', () => {
  const text = existsSync(SW) ? readFileSync(SW, 'utf8') : '';
  const list = JSON.parse(/const TT_PRECACHE = (\[.*?\]);/.exec(text)?.[1] ?? '[]') as string[];

  it('carries a version hashed from what it precaches', () => {
    expect(text).toMatch(/const TT_SW_VERSION = '[0-9a-f]{12}';/);
  });

  it('precaches the shell, its scripts and its faces', () => {
    expect(list).toContain('/app/');
    expect(list.some((u) => /^\/_astro\/.+\.js$/.test(u))).toBe(true);
    expect(list.some((u) => u.endsWith('.woff2'))).toBe(true);
    expect(list).toContain('/manifest.webmanifest');
  });

  it('precaches only files that exist — one 404 and it never installs', () => {
    for (const url of list.filter((u) => u !== '/app/')) {
      expect(existsSync(join(DIST, ...url.split('/'))), url).toBe(true);
    }
  });

  it('never precaches an /api/ path or media', () => {
    expect(list.filter((u) => u.startsWith('/api/'))).toEqual([]);
    expect(list.filter((u) => /\.(?:mp4|webm|mp3|wav|flac|ogg|opus|m4a)$/i.test(u))).toEqual([]);
  });

  it('is a classic script — no module syntax survives the build', () => {
    expect(text).not.toMatch(/^\s*(?:export|import)\s/m);
  });
});
