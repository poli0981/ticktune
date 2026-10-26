import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index';

/**
 * The `/api/*` budget — docs/10 §6 (v2.0.3).
 *
 * docs/10 §6 promised "60 requests / 1 min per IP" on `/api/*` from P4 on, as a
 * zone rule. Nobody ever saw it fire, and on 2026-10-27 seventy-five rapid
 * calls to production all answered 200: oEmbed had no limit at all. The budget
 * is now the Worker's `API_LIMIT` binding, so it is code, and pinned here —
 * what is counted, by what key, what an over-budget client is told, and that
 * a limiter which cannot answer never takes the API down with it.
 */

interface CacheStub {
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

let cache: CacheStub;
let fetchMock: ReturnType<typeof vi.fn>;
let assets: ReturnType<typeof vi.fn>;
let apiLimit: ReturnType<typeof vi.fn>;
let durationsLimit: ReturnType<typeof vi.fn>;

const ctx = { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => undefined };

function env() {
  return {
    ASSETS: { fetch: assets },
    YT_DATA_API_KEY: 'test-key-not-a-real-one',
    API_LIMIT: { limit: apiLimit },
    YT_DURATIONS_LIMIT: { limit: durationsLimit },
  };
}

function call(path: string, { method = 'GET', ip = '203.0.113.7' } = {}): Promise<Response> {
  return (
    worker as unknown as {
      fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>;
    }
  ).fetch(
    new Request(`https://ticktune.net${path}`, { method, headers: { 'cf-connecting-ip': ip } }),
    env(),
    ctx,
  );
}

const ID = 'dQw4w9WgXcQ';
const OEMBED = `/api/yt/oembed?id=${ID}`;
const DURATIONS = `/api/yt/durations?ids=${ID}`;

const oembedBody = () =>
  new Response(JSON.stringify({ title: 't', author_name: 'a', thumbnail_url: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  cache = {
    match: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
  };
  vi.stubGlobal('caches', { default: cache });
  fetchMock = vi.fn().mockImplementation(() => Promise.resolve(oembedBody()));
  vi.stubGlobal('fetch', fetchMock);
  assets = vi
    .fn()
    .mockImplementation(() => Promise.resolve(new Response('404 page', { status: 404 })));
  apiLimit = vi.fn().mockResolvedValue({ success: true });
  durationsLimit = vi.fn().mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('what is counted', () => {
  it.each([
    ['oEmbed', OEMBED],
    ['durations', DURATIONS],
    ['a malformed id', '/api/yt/oembed?id=nope'],
    ['an /api/ path that does not exist', '/api/nothing-here'],
  ])('%s spends one unit, keyed on the client IP', async (_name, path) => {
    await call(path, { ip: '198.51.100.4' });

    expect(apiLimit).toHaveBeenCalledTimes(1);
    expect(apiLimit).toHaveBeenCalledWith({ key: '198.51.100.4' });
  });

  it('a wrong method is counted too — a flood is made of those', async () => {
    await call(OEMBED, { method: 'POST' });
    expect(apiLimit).toHaveBeenCalledTimes(1);
  });

  it.each(['/', '/app/', '/no-such-page', '/apix', '/api'])(
    'never counts %s — not an /api/ request',
    async (path) => {
      await call(path);
      expect(apiLimit).not.toHaveBeenCalled();
    },
  );

  it('a request with no client IP header shares one bucket rather than going free', async () => {
    await (
      worker as unknown as {
        fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>;
      }
    ).fetch(new Request(`https://ticktune.net${OEMBED}`), env(), ctx);

    expect(apiLimit).toHaveBeenCalledWith({ key: 'unknown' });
  });
});

describe('over budget', () => {
  beforeEach(() => {
    apiLimit.mockResolvedValue({ success: false });
  });

  it.each([OEMBED, DURATIONS])('%s → 429 rate_limited, before cache or upstream', async (path) => {
    const res = await call(path);

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: 'rate_limited' });
    expect(cache.match).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the 429 is ours: JSON, nosniff, uncached, no CORS header', async () => {
    // The client only names a cause for a response our Worker produced, and it
    // knows that by the content type (src/lib/tt-yt-cause.ts) — so this 429 is
    // read as `rate_limited` and the track stays `pending` (TT-YT-001).
    const res = await call(OEMBED);

    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('public, max-age=0');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('does not also spend the durations quota budget', async () => {
    await call(DURATIONS);
    expect(durationsLimit).not.toHaveBeenCalled();
  });

  it('leaves the static fall-through alone', async () => {
    const res = await call('/no-such-page');

    expect(res.status).toBe(404);
    expect(assets).toHaveBeenCalledTimes(1);
  });
});

describe('when the limiter fails', () => {
  it('lets the request through — a Cloudflare hiccup is not an outage', async () => {
    apiLimit.mockRejectedValue(new Error('limiter down'));
    const res = await call(OEMBED);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('the two budgets together', () => {
  it('durations spends from both, the /api/ budget first', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: ID, contentDetails: { duration: 'PT1M' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await call(DURATIONS);

    expect(apiLimit).toHaveBeenCalledTimes(1);
    expect(durationsLimit).toHaveBeenCalledTimes(1);
    expect(apiLimit.mock.invocationCallOrder[0]).toBeLessThan(
      durationsLimit.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('oEmbed never touches the durations budget', async () => {
    await call(OEMBED);
    expect(durationsLimit).not.toHaveBeenCalled();
  });

  it('the durations budget alone can still refuse', async () => {
    durationsLimit.mockResolvedValue({ success: false });
    const res = await call(DURATIONS);

    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
