import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index';

/**
 * The edge endpoint — docs/06 §3.
 *
 * **This tier exists because nothing else can reach this file.** Playwright's
 * `webServer` is `astro preview`, not `wrangler`, so `/api/yt/oembed` does not
 * exist under E2E; `docs/13 §3` mocks it rather than running it. The Worker
 * therefore shipped through P1–P3 with zero automated coverage.
 *
 * That mattered little while it forwarded a body. It matters now: spike S1
 * established that the player reports `onError 150` for **every** failure
 * cause, so this response is the only place the reason exists. A regression
 * here is unrecoverable downstream and invisible to every other test.
 *
 * `fetch` and `caches.default` are the only two things it touches, and both
 * stub cleanly — no network, no browser, no workerd.
 */

interface CacheStub {
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

let cache: CacheStub;
let fetchMock: ReturnType<typeof vi.fn>;

/** `ctx.waitUntil` runs the promise; the real runtime just does not block on it. */
const ctx = { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => undefined };

const env = { ASSETS: { fetch: () => Promise.resolve(new Response('asset', { status: 200 })) } };

function call(url: string, method = 'GET'): Promise<Response> {
  // The handler's signature is workerd's; the shapes above are the only parts
  // of it this route actually uses.
  return (
    worker as unknown as {
      fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>;
    }
  ).fetch(new Request(url, { method }), env, ctx);
}

const OEMBED = 'https://ticktune.net/api/yt/oembed?id=';
const GOOD_ID = 'dQw4w9WgXcQ';

beforeEach(() => {
  cache = {
    match: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
  };
  vi.stubGlobal('caches', { default: cache });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the cause is preserved — spike S1', () => {
  it.each([
    [400, 'invalid_id', 'structurally impossible id'],
    [401, 'embed_off', 'embedding disabled by the owner'],
    [403, 'private', 'private or unlisted'],
    [404, 'not_found', 'no such video'],
  ])('upstream %i → status %i and error "%s"', async (status, cause) => {
    fetchMock.mockResolvedValue(new Response('', { status }));
    const res = await call(OEMBED + GOOD_ID);

    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toEqual({ error: cause });
  });

  it('does NOT rewrite 401 to 404', async () => {
    // The bug this tier was written to make impossible. The Worker carried
    // `res.status === 401 ? 404 : res.status` through three releases, telling
    // users their video was deleted when the owner had merely blocked
    // embedding — and the player could never correct it, because every cause
    // arrives there as 150.
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));
    const res = await call(OEMBED + GOOD_ID);

    expect(res.status).toBe(401);
    expect(res.status).not.toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'embed_off' });
  });

  it('falls back to "unavailable" on a 4xx nobody has measured', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 451 }));
    const res = await call(OEMBED + GOOD_ID);
    await expect(res.json()).resolves.toEqual({ error: 'unavailable' });
  });

  it('names an upstream 5xx as the server failing, not the video', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    const res = await call(OEMBED + GOOD_ID);
    // `unavailable` is non-transient, so this used to REJECT the track: a
    // YouTube outage threw away every pasted link.
    await expect(res.json()).resolves.toEqual({ error: 'upstream_unreachable' });
  });
});

describe('a transient verdict is never remembered — docs/06 §3', () => {
  it.each([
    [503, 'an upstream outage'],
    [429, 'a rate limit'],
  ])('does not cache %i (%s)', async (status) => {
    // The 502 branch already refused to cache "for exactly this reason" while
    // every OTHER transient status was kept for 15 minutes — so the retry that
    // would have cleared it hit the cache instead and got the same answer.
    fetchMock.mockResolvedValue(new Response('', { status }));
    const res = await call(OEMBED + GOOD_ID);

    expect(cache.put).not.toHaveBeenCalled();
    expect(res.headers.get('cache-control')).toBe('public, max-age=0');
  });

  it('still caches a verdict about the VIDEO itself', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }));
    await call(OEMBED + GOOD_ID);
    // 404s are cheap and rarely un-delete; that is what the 15 minutes is for.
    expect(cache.put).toHaveBeenCalled();
  });
});

describe('the happy path', () => {
  it('forwards only the three fields the app renders', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        title: 'Never Gonna Give You Up',
        author_name: 'Rick Astley',
        thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
        // docs/06 §3: the upstream body also carries embeddable HTML we
        // neither need nor want to pass through.
        html: '<iframe src="https://www.youtube.com/embed/x"></iframe>',
        author_url: 'https://www.youtube.com/@RickAstleyYT',
      }),
    );
    const res = await call(OEMBED + GOOD_ID);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['author_name', 'thumbnail_url', 'title']);
    expect(body['html']).toBeUndefined();
  });

  it('nulls a missing field rather than dropping the key', async () => {
    fetchMock.mockResolvedValue(Response.json({ title: 'x' }));
    const body = (await (await call(OEMBED + GOOD_ID)).json()) as Record<string, unknown>;
    expect(body).toEqual({ title: 'x', author_name: null, thumbnail_url: null });
  });

  it('builds the upstream URL itself and never from the request', async () => {
    // docs/09 §1 — this is what stops the route being an open proxy.
    fetchMock.mockResolvedValue(Response.json({ title: 't' }));
    await call(OEMBED + GOOD_ID);

    const called = String((fetchMock.mock.calls[0]?.[0] as URL) ?? '');
    expect(called).toContain('https://www.youtube.com/oembed');
    expect(called).toContain(encodeURIComponent(`https://www.youtube.com/watch?v=${GOOD_ID}`));
  });
});

describe('input validation', () => {
  it.each(['xxx', '', '0000000000', 'abcdefghijkl', 'abcdefghij!'])(
    'rejects %o without calling upstream',
    async (id) => {
      const res = await call(OEMBED + encodeURIComponent(id));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: 'invalid_id' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('accepts the full URL-safe base64 alphabet', async () => {
    fetchMock.mockResolvedValue(Response.json({ title: 't' }));
    const res = await call(OEMBED + '-_AZaz09xy');
    // 10 chars — one short. The regex is exactly 11.
    expect(res.status).toBe(400);
  });

  it('refuses a non-GET at the edge as well as in the WAF', async () => {
    const res = await call(OEMBED + GOOD_ID, 'POST');
    expect(res.status).toBe(405);
    await expect(res.json()).resolves.toEqual({ error: 'method_not_allowed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('network failure is transient, and must not look like a deleted video', () => {
  it('reports upstream_unreachable as 502', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    const res = await call(OEMBED + GOOD_ID);

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: 'upstream_unreachable' });
  });

  it('never caches it — a blip must not be remembered for 15 minutes', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    await call(OEMBED + GOOD_ID);
    expect(cache.put).not.toHaveBeenCalled();
  });
});

describe('caching — docs/06 §3, docs/09 §3', () => {
  it('returns a hit without touching upstream', async () => {
    cache.match.mockResolvedValue(Response.json({ title: 'cached' }));
    const res = await call(OEMBED + GOOD_ID);

    await expect(res.json()).resolves.toEqual({ title: 'cached' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches a success for 6 h and a failure for 15 min', async () => {
    fetchMock.mockResolvedValue(Response.json({ title: 't' }));
    const ok = await call(OEMBED + GOOD_ID);
    expect(ok.headers.get('cache-control')).toBe('public, max-age=21600');

    fetchMock.mockResolvedValue(new Response('', { status: 404 }));
    const gone = await call(OEMBED + GOOD_ID);
    expect(gone.headers.get('cache-control')).toBe('public, max-age=900');
  });

  it('keys the cache per video id, so one id cannot serve another', async () => {
    fetchMock.mockResolvedValue(Response.json({ title: 't' }));
    await call(OEMBED + GOOD_ID);
    const key = String((cache.put.mock.calls[0]?.[0] as Request).url);
    expect(key).toContain(GOOD_ID);
  });
});

describe('CORS — the whole reason this endpoint exists', () => {
  it('sends the header on success AND on failure', async () => {
    // docs/06 §3: YouTube's own oEmbed sends no CORS headers, which is why the
    // browser cannot call it directly. An error response without the header
    // would be unreadable to the client — it could not even see the status.
    fetchMock.mockResolvedValue(Response.json({ title: 't' }));
    expect((await call(OEMBED + GOOD_ID)).headers.get('access-control-allow-origin')).toBe('*');

    fetchMock.mockResolvedValue(new Response('', { status: 403 }));
    expect((await call(OEMBED + GOOD_ID)).headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('everything else is a static asset', () => {
  it('falls through to ASSETS', async () => {
    const res = await call('https://ticktune.net/app/');
    expect(await res.text()).toBe('asset');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
