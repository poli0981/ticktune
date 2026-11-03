import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index';

/**
 * `/api/yt/playlists` — docs/06 §9 (v2.1).
 *
 * The same key and quota as the lengths, and one call can spend ten units —
 * so what this tier pins is the money, the leaks and the CAUSES: one upstream
 * call per uncached list and never one for a list the cache holds, the key
 * never in a URL, a spent quota never told to the user as "private", a
 * transient failure never cached, no CORS header, a per-IP limiter behind
 * `API_LIMIT`.
 */

interface CacheStub {
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

let cache: CacheStub;
let stored: Map<string, Response>;
let fetchMock: ReturnType<typeof vi.fn>;
let limit: ReturnType<typeof vi.fn>;

const ctx = { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => undefined };
const KEY = 'test-key-not-a-real-one';

function env(extra: Record<string, unknown> = {}) {
  return {
    ASSETS: { fetch: () => Promise.resolve(new Response('asset', { status: 200 })) },
    YT_DATA_API_KEY: KEY,
    YT_PLAYLISTS_LIMIT: { limit },
    ...extra,
  };
}

function call(
  query: string,
  { method = 'GET', e = env(), ip = '203.0.113.7' } = {},
): Promise<Response> {
  return (
    worker as unknown as {
      fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>;
    }
  ).fetch(
    new Request(`https://ticktune.net/api/yt/playlists${query}`, {
      method,
      headers: { 'cf-connecting-ip': ip },
    }),
    e,
    ctx,
  );
}

const A = 'PLaaaaaaaaaaaaaaaa';
const B = 'PLbbbbbbbbbbbbbbbb';
const V1 = 'dQw4w9WgXcQ';
const V2 = 'jNQXAC9IVRw';
const V3 = '9bZkp7q19f0';

type Item = [videoId: string, privacy: string, published: boolean];

/** What Google's `playlistItems.list` returns for our `fields`. */
const page = (items: Item[], total = items.length) =>
  new Response(
    JSON.stringify({
      pageInfo: { totalResults: total },
      items: items.map(([videoId, privacyStatus, published]) => ({
        contentDetails: published
          ? { videoId, videoPublishedAt: '2009-10-25T06:57:33Z' }
          : { videoId },
        status: { privacyStatus },
      })),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

/** Google's error body, as the Data API sends it. */
const googleError = (status: number, reason: string) =>
  new Response(JSON.stringify({ error: { code: status, errors: [{ reason }] } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  stored = new Map();
  cache = {
    match: vi.fn((req: Request) => Promise.resolve(stored.get(req.url)?.clone())),
    put: vi.fn((req: Request, res: Response) => {
      stored.set(req.url, res);
      return Promise.resolve();
    }),
  };
  vi.stubGlobal('caches', { default: cache });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  limit = vi.fn().mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const upstreamUrl = (i = 0) => new URL(String(fetchMock.mock.calls[i]?.[0]));
const upstreamHeaders = (i = 0) =>
  new Headers((fetchMock.mock.calls[i]?.[1] as RequestInit | undefined)?.headers);

describe('the happy path', () => {
  it('answers each list’s playable videos in order, with what was skipped and the total', async () => {
    fetchMock.mockResolvedValue(
      page(
        [
          [V1, 'public', true],
          [V2, 'private', false], // private: no publish date
          [V3, 'unlisted', true],
        ],
        120,
      ),
    );
    const res = await call(`?ids=${A}`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      lists: { [A]: { ids: [V1, V3], skipped: 1, total: 120 } },
    });
  });

  it('asks for the first page only, with only the fields it reads', async () => {
    fetchMock.mockResolvedValue(page([[V1, 'public', true]]));
    await call(`?ids=${A}`);

    const url = upstreamUrl();
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/youtube/v3/playlistItems');
    expect(url.searchParams.get('playlistId')).toBe(A);
    expect(url.searchParams.get('maxResults')).toBe('50');
    expect(url.searchParams.get('part')).toBe('contentDetails,status');
    expect(url.searchParams.get('fields')).toBe(
      'pageInfo/totalResults,items(contentDetails(videoId,videoPublishedAt),status/privacyStatus)',
    );
    expect(url.searchParams.has('pageToken')).toBe(false);
  });

  it('sends the key in a header — never in the URL — and the Referer it is restricted to', async () => {
    fetchMock.mockResolvedValue(page([[V1, 'public', true]]));
    await call(`?ids=${A}`);

    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain(KEY);
    expect(upstreamHeaders().get('x-goog-api-key')).toBe(KEY);
    expect(upstreamHeaders().get('referer')).toBe('https://ticktune.net/');
  });

  it('one upstream call per list, and none for a list the cache holds', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(page([[V1, 'public', true]])));
    await call(`?ids=${A},${B}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockClear();
    const again = await call(`?ids=${A},${B}`);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(again.json()).resolves.toEqual({
      lists: {
        [A]: { ids: [V1], skipped: 0, total: 1 },
        [B]: { ids: [V1], skipped: 0, total: 1 },
      },
    });
  });

  it('caches a list for an hour, under a versioned key', async () => {
    fetchMock.mockResolvedValue(page([[V1, 'public', true]]));
    await call(`?ids=${A}`);

    const [key] = [...stored.keys()];
    expect(key).toBe(`https://tt-yt-playlist.invalid/v1/${A}`);
    expect(stored.get(key ?? '')?.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('is never cached by the browser and sends no CORS header', async () => {
    fetchMock.mockResolvedValue(page([[V1, 'public', true]]));
    const res = await call(`?ids=${A}`);
    expect(res.headers.get('cache-control')).toBe('public, max-age=0');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
  });
});

describe('causes — Google’s reason decides, never the status alone', () => {
  it('a missing list is `not_found` and a private one `private`, both cached 15 min', async () => {
    fetchMock.mockImplementation((url: URL) =>
      Promise.resolve(
        url.searchParams.get('playlistId') === A
          ? googleError(404, 'playlistNotFound')
          : googleError(403, 'playlistItemsNotAccessible'),
      ),
    );
    const res = await call(`?ids=${A},${B}`);
    await expect(res.json()).resolves.toEqual({
      lists: { [A]: { error: 'not_found' }, [B]: { error: 'private' } },
    });
    expect(stored.get(`https://tt-yt-playlist.invalid/v1/${A}`)?.headers.get('cache-control')).toBe(
      'public, max-age=900',
    );
  });

  it('🔴 a spent quota is a 403 too — it refuses the batch, and is never "private"', async () => {
    fetchMock.mockResolvedValue(googleError(403, 'quotaExceeded'));
    const res = await call(`?ids=${A},${B}`);

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'upstream_refused' });
    expect(stored.size).toBe(0);
  });

  it('Google having a bad minute is transient: answered as such, and never cached', async () => {
    fetchMock.mockImplementation((url: URL) =>
      url.searchParams.get('playlistId') === A
        ? Promise.resolve(new Response('', { status: 503 }))
        : Promise.reject(new TypeError('network')),
    );
    const res = await call(`?ids=${A},${B}`);
    await expect(res.json()).resolves.toEqual({
      lists: { [A]: { error: 'upstream_unreachable' }, [B]: { error: 'upstream_unreachable' } },
    });
    expect(stored.size).toBe(0);
  });

  it('a 200 that will not parse is transient, not empty', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }));
    const res = await call(`?ids=${A}`);
    await expect(res.json()).resolves.toEqual({
      lists: { [A]: { error: 'upstream_unreachable' } },
    });
  });

  it('no key on this deployment: 503 `not_configured`, and Google is not asked', async () => {
    const res = await call(`?ids=${A}`, { e: env({ YT_DATA_API_KEY: undefined }) });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('validation — before the quota is touched', () => {
  it.each([
    ['nothing', ''],
    ['an empty list', '?ids='],
    ['a video id', `?ids=${V1}`],
    ['a malformed id', '?ids=PL!aaaaaaaaaaaaaaaa'],
    ['a Mix', `?ids=RD${V1}`],
    ['a personal list', '?ids=WL'],
    [
      'eleven lists',
      `?ids=${Array.from({ length: 11 }, (_, i) => `PL${String(i).padStart(16, '0')}`).join(',')}`,
    ],
  ])('refuses %s with 400 invalid_id', async (_label, query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_id' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
  });

  it('takes ten, and counts a repeated list once', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(page([[V1, 'public', true]])));
    const ten = Array.from({ length: 10 }, (_, i) => `PL${String(i).padStart(16, '0')}`);
    const res = await call(`?ids=${[...ten, ten[0]].join(',')}`);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('refuses anything but GET', async () => {
    const res = await call(`?ids=${A}`, { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('the per-IP budget — docs/10 §6', () => {
  it('a spent budget answers our own JSON 429, and Google is not asked', async () => {
    limit.mockResolvedValue({ success: false });
    const res = await call(`?ids=${A}`);
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: 'rate_limited' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts by the client IP, and fails open when the limiter cannot answer', async () => {
    limit.mockRejectedValue(new Error('binding down'));
    fetchMock.mockResolvedValue(page([[V1, 'public', true]]));
    const res = await call(`?ids=${A}`, { ip: '198.51.100.9' });
    expect(res.status).toBe(200);
    expect(limit).toHaveBeenCalledWith({ key: '198.51.100.9' });
  });
});
