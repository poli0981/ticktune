import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index';

/**
 * `/api/yt/durations` — docs/06 §3 (v2.0).
 *
 * The YouTube Data API behind our Worker: the key stays a secret, the quota is
 * the budget, and the app reads one word on failure — so what this tier pins is
 * the money and the leaks. One upstream call per batch, never one for an id the
 * cache holds; the key never in a URL; failures never cached; no CORS header to
 * make it anyone else's free proxy; a per-IP limiter in front of the quota.
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
    YT_DURATIONS_LIMIT: { limit },
    ...extra,
  };
}

function call(
  query: string,
  {
    method = 'GET',
    e = env(),
    ip = '203.0.113.7',
    country,
  }: { method?: string; e?: unknown; ip?: string; country?: string } = {},
): Promise<Response> {
  const request = new Request(`https://ticktune.net/api/yt/durations${query}`, {
    method,
    headers: { 'cf-connecting-ip': ip },
  });
  // Cloudflare's `request.cf` — absent from Node's Request, so attached by hand.
  if (country !== undefined) Object.assign(request, { cf: { country } });
  return (
    worker as unknown as {
      fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>;
    }
  ).fetch(request, e, ctx);
}

const A = 'dQw4w9WgXcQ';
const B = 'jNQXAC9IVRw';
const C = '9bZkp7q19f0';

/** What Google's `videos.list` returns for `fields=items(id,contentDetails/duration)`. */
const google = (items: Array<[string, string]>) =>
  new Response(
    JSON.stringify({
      items: items.map(([id, duration]) => ({ id, contentDetails: { duration } })),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

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

const upstreamUrl = () => new URL(String(fetchMock.mock.calls[0]?.[0]));
const upstreamHeaders = () =>
  new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers);

describe('the happy path', () => {
  it('answers milliseconds per id, null for what Google did not return', async () => {
    fetchMock.mockResolvedValue(
      google([
        [A, 'PT4M13S'],
        [B, 'P0D'],
      ]),
    );
    const res = await call(`?ids=${A},${B},${C}`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      durations: { [A]: 253_000, [B]: null, [C]: null },
      unplayable: {},
    });
  });

  it('asks Google once, for the batch, with only what it needs', async () => {
    fetchMock.mockResolvedValue(google([[A, 'PT1M']]));
    await call(`?ids=${A},${B}`);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = upstreamUrl();
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/youtube/v3/videos');
    expect(url.searchParams.get('part')).toBe('contentDetails,status,snippet');
    expect(url.searchParams.get('id')?.split(',').sort()).toEqual([A, B].sort());
    expect(url.searchParams.get('fields')).toBe(
      'items(id,contentDetails(duration,regionRestriction,contentRating/ytRating),' +
        'status(uploadStatus,privacyStatus,embeddable),snippet/liveBroadcastContent)',
    );
  });

  it('sends the key in a header — never in the URL', async () => {
    fetchMock.mockResolvedValue(google([[A, 'PT1M']]));
    await call(`?ids=${A}`);

    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain(KEY);
    expect(upstreamHeaders().get('x-goog-api-key')).toBe(KEY);
  });

  it('sends the Referer the key is restricted to', async () => {
    fetchMock.mockResolvedValue(google([[A, 'PT1M']]));
    await call(`?ids=${A}`);

    expect(upstreamHeaders().get('referer')).toBe('https://ticktune.net/');
  });

  it('dedupes the ids before asking', async () => {
    fetchMock.mockResolvedValue(google([[A, 'PT1M']]));
    const res = await call(`?ids=${A},${A},${A}`);

    expect(upstreamUrl().searchParams.get('id')).toBe(A);
    await expect(res.json()).resolves.toEqual({ durations: { [A]: 60_000 }, unplayable: {} });
  });
});

describe('the quota is the budget — the cache spends none of it', () => {
  it('answers a fully cached batch without calling Google', async () => {
    fetchMock.mockResolvedValue(
      google([
        [A, 'PT1M'],
        [B, 'PT2M'],
      ]),
    );
    await call(`?ids=${A},${B}`);
    fetchMock.mockClear();

    const res = await call(`?ids=${B},${A}`);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      durations: { [A]: 60_000, [B]: 120_000 },
      unplayable: {},
    });
  });

  it('asks only for the ids the cache does not hold', async () => {
    fetchMock.mockResolvedValue(google([[A, 'PT1M']]));
    await call(`?ids=${A}`);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(google([[B, 'PT2M']]));

    const res = await call(`?ids=${A},${B}`);
    expect(upstreamUrl().searchParams.get('id')).toBe(B);
    await expect(res.json()).resolves.toEqual({
      durations: { [A]: 60_000, [B]: 120_000 },
      unplayable: {},
    });
  });

  it('keeps a length a day and a "no length" fifteen minutes', async () => {
    fetchMock.mockResolvedValue(
      google([
        [A, 'PT1M'],
        [B, 'P0D'],
      ]),
    );
    await call(`?ids=${A},${B}`);

    const ttl = (id: string) =>
      [...stored.entries()]
        .find(([url]) => url.endsWith(`/${id}`))?.[1]
        .headers.get('cache-control');
    expect(ttl(A)).toBe('public, max-age=86400');
    expect(ttl(B)).toBe('public, max-age=900');
  });

  it('versions its cache keys', async () => {
    fetchMock.mockResolvedValue(google([[A, 'PT1M']]));
    await call(`?ids=${A}`);

    expect([...stored.keys()]).toEqual([`https://tt-yt-duration.invalid/v2/${A}`]);
  });
});

describe('every failure is one uncached word', () => {
  it('no key → 503 not_configured, and Google is never called', async () => {
    const res = await call(`?ids=${A}`, { e: env({ YT_DATA_API_KEY: undefined }) });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'upstream_refused', 'quota spent, or the key refusing us'],
    [400, 'upstream_refused', 'a request Google rejects'],
    [429, 'upstream_unreachable', 'Google rate-limiting'],
    [500, 'upstream_unreachable', 'Google failing'],
  ])('upstream %i → 503 %s (%s)', async (status, error) => {
    fetchMock.mockResolvedValue(new Response('{}', { status }));
    const res = await call(`?ids=${A}`);

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error });
    expect(res.headers.get('cache-control')).toBe('public, max-age=0');
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('a network failure or a timeout → 502 upstream_unreachable', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    const res = await call(`?ids=${A}`);

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: 'upstream_unreachable' });
    expect(cache.put).not.toHaveBeenCalled();
  });

  it.each([
    ['an HTML page', '<!doctype html><p>challenge</p>'],
    ['a literal null', 'null'],
    ['items that are not a list', '{"items":"nope"}'],
  ])('a 200 that is %s → 502, uncached', async (_, body) => {
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    const res = await call(`?ids=${A}`);

    expect(res.status).toBe(502);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('bounds the wait on Google', async () => {
    fetchMock.mockResolvedValue(google([[A, 'PT1M']]));
    await call(`?ids=${A}`);

    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe('input — it is not a proxy', () => {
  it.each([
    ['', 'no ids parameter'],
    ['?ids=', 'an empty list'],
    [`?ids=${A},not-an-id`, 'one malformed id'],
    [`?ids=${A},`, 'a trailing comma'],
    ['?ids=https://evil.example/', 'a URL'],
  ])('%s → 400 invalid_id (%s)', async (query) => {
    const res = await call(query);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_id' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('takes 50 ids and refuses 51', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `${String(i).padStart(2, '0')}xxxxxxxxx`);
    fetchMock.mockResolvedValue(google([]));

    expect((await call(`?ids=${ids.slice(0, 50).join(',')}`)).status).toBe(200);
    expect((await call(`?ids=${ids.join(',')}`)).status).toBe(400);
  });

  it('answers non-GET with 405, as the WAF rule does', async () => {
    const res = await call(`?ids=${A}`, { method: 'POST' });

    expect(res.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the per-IP limiter', () => {
  it('keys on the client IP', async () => {
    fetchMock.mockResolvedValue(google([[A, 'PT1M']]));
    await call(`?ids=${A}`, { ip: '198.51.100.4' });

    expect(limit).toHaveBeenCalledWith({ key: '198.51.100.4' });
  });

  it('over budget → 429 rate_limited, and Google is never called', async () => {
    limit.mockResolvedValue({ success: false });
    const res = await call(`?ids=${A}`);

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: 'rate_limited' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets the request through when the limiter itself fails', async () => {
    limit.mockRejectedValue(new Error('limiter down'));
    fetchMock.mockResolvedValue(google([[A, 'PT1M']]));

    expect((await call(`?ids=${A}`)).status).toBe(200);
  });

  it('spends no budget on a malformed request', async () => {
    await call('?ids=nope');
    expect(limit).not.toHaveBeenCalled();
  });
});

describe('headers', () => {
  it('JSON with nosniff and NO CORS header, on success and failure alike', async () => {
    fetchMock.mockResolvedValue(google([[A, 'PT1M']]));
    for (const res of [await call(`?ids=${A}`), await call('?ids=bad')]) {
      expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });
});

/** A full `videos.list` item, as the v2.3 `fields` selection returns one. */
interface ItemOpts {
  duration?: string;
  embeddable?: boolean;
  age?: boolean;
  allowed?: string[];
  blocked?: string[];
  live?: 'none' | 'live' | 'upcoming';
  upload?: string;
  privacy?: string;
}
function fullItem(id: string, o: ItemOpts = {}) {
  const regionRestriction =
    o.allowed !== undefined
      ? { allowed: o.allowed }
      : o.blocked !== undefined
        ? { blocked: o.blocked }
        : undefined;
  return {
    id,
    contentDetails: {
      duration: o.duration ?? 'PT1M',
      ...(regionRestriction === undefined ? {} : { regionRestriction }),
      ...(o.age === true ? { contentRating: { ytRating: 'ytAgeRestricted' } } : {}),
    },
    status: {
      uploadStatus: o.upload ?? 'processed',
      privacyStatus: o.privacy ?? 'public',
      embeddable: o.embeddable ?? true,
    },
    snippet: { liveBroadcastContent: o.live ?? 'none' },
  };
}
const googleFull = (items: unknown[]) =>
  new Response(JSON.stringify({ items }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('availability — docs/06 §3 (v2.3)', () => {
  it('names each video that cannot play for this visitor, and the reason', async () => {
    const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee'];
    const [EMB, AGE, UPC, PROC, OKV] = ids as [string, string, string, string, string];
    fetchMock.mockResolvedValue(
      googleFull([
        fullItem(EMB, { embeddable: false }),
        fullItem(AGE, { age: true, duration: 'PT2M' }),
        fullItem(UPC, { live: 'upcoming', duration: 'P0D' }),
        fullItem(PROC, { upload: 'uploaded', duration: 'P0D' }),
        fullItem(OKV),
      ]),
    );
    const res = await call(`?ids=${ids.join(',')}`, { country: 'VN' });

    await expect(res.json()).resolves.toEqual({
      durations: { [EMB]: 60_000, [AGE]: 120_000, [UPC]: null, [PROC]: null, [OKV]: 60_000 },
      unplayable: {
        [EMB]: 'embed_off',
        [AGE]: 'age_restricted',
        [UPC]: 'not_yet',
        [PROC]: 'not_yet',
      },
    });
  });

  it('decides the region per visitor, from ONE cached entry — the quota is not spent twice', async () => {
    fetchMock.mockResolvedValue(googleFull([fullItem(A, { allowed: ['US', 'CA'] })]));

    const us = await call(`?ids=${A}`, { country: 'US' });
    const vn = await call(`?ids=${A}`, { country: 'VN' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(us.json()).resolves.toEqual({ durations: { [A]: 60_000 }, unplayable: {} });
    await expect(vn.json()).resolves.toEqual({
      durations: { [A]: 60_000 },
      unplayable: { [A]: 'region_blocked' },
    });
  });

  it('a blocked list blocks only the countries it names', async () => {
    fetchMock.mockResolvedValue(googleFull([fullItem(A, { blocked: ['VN'] })]));

    await expect((await call(`?ids=${A}`, { country: 'VN' })).json()).resolves.toMatchObject({
      unplayable: { [A]: 'region_blocked' },
    });
    await expect((await call(`?ids=${A}`, { country: 'JP' })).json()).resolves.toMatchObject({
      unplayable: {},
    });
  });

  it.each([
    [undefined, 'no country at all'],
    ['XX', 'Cloudflare does not know'],
    ['T1', 'Tor'],
  ])('refuses nobody on a region it cannot compare (%s — %s)', async (country) => {
    fetchMock.mockResolvedValue(googleFull([fullItem(A, { allowed: ['US'] })]));
    const res = await call(`?ids=${A}`, country === undefined ? {} : { country });

    await expect(res.json()).resolves.toEqual({ durations: { [A]: 60_000 }, unplayable: {} });
  });

  it('gives no reason for an id Google did not return — oEmbed decides those', async () => {
    fetchMock.mockResolvedValue(googleFull([]));
    const res = await call(`?ids=${A}`, { country: 'VN' });

    await expect(res.json()).resolves.toEqual({ durations: { [A]: null }, unplayable: {} });
  });

  it('caches the facts — never the country — and answers each visitor privately', async () => {
    fetchMock.mockResolvedValue(googleFull([fullItem(A, { allowed: ['US'] })]));
    const res = await call(`?ids=${A}`, { country: 'VN' });

    // The answer depends on who asked, so no shared cache may keep it…
    expect(res.headers.get('cache-control')).toBe('private, max-age=900');
    // …while the per-video entry is the same for everyone, and stays public.
    const entry = stored.get(`https://tt-yt-duration.invalid/v2/${A}`);
    expect(entry?.headers.get('cache-control')).toBe('public, max-age=86400');
    const body = await entry?.clone().text();
    expect(JSON.parse(body ?? '')).toEqual({ ms: 60_000, f: { allowed: ['US'] } });
    expect(body).not.toContain('VN');
  });

  it('asks Google again within fifteen minutes about a video not out yet', async () => {
    fetchMock.mockResolvedValue(googleFull([fullItem(A, { live: 'upcoming', duration: 'PT1H' })]));
    await call(`?ids=${A}`);

    expect(stored.get(`https://tt-yt-duration.invalid/v2/${A}`)?.headers.get('cache-control')).toBe(
      'public, max-age=900',
    );
  });

  it('never reads a v1 entry — it holds a length and no facts', async () => {
    stored.set(
      `https://tt-yt-duration.invalid/v1/${A}`,
      new Response(JSON.stringify({ ms: 60_000 }), { status: 200 }),
    );
    fetchMock.mockResolvedValue(googleFull([fullItem(A, { age: true })]));
    const res = await call(`?ids=${A}`);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toMatchObject({ unplayable: { [A]: 'age_restricted' } });
  });

  it('treats an entry it cannot read as a miss', async () => {
    stored.set(`https://tt-yt-duration.invalid/v2/${A}`, new Response('not json', { status: 200 }));
    stored.set(
      `https://tt-yt-duration.invalid/v2/${B}`,
      new Response(JSON.stringify({ ms: 'sixty' }), { status: 200 }),
    );
    fetchMock.mockResolvedValue(googleFull([fullItem(A), fullItem(B)]));
    const res = await call(`?ids=${A},${B}`);

    expect(upstreamUrl().searchParams.get('id')?.split(',').sort()).toEqual([A, B].sort());
    await expect(res.json()).resolves.toEqual({
      durations: { [A]: 60_000, [B]: 60_000 },
      unplayable: {},
    });
  });
});
