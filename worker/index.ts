/**
 * The one edge endpoint — docs/01 §1, docs/06 §3.
 *
 * It exists for exactly one reason: https://www.youtube.com/oembed sends no
 * CORS headers, so the browser cannot call it. Everything else is static assets.
 *
 * It is deliberately **not** a URL proxy. The only input is an 11-character
 * video id matched against a strict regex; the upstream URL is constructed here
 * and never taken from the request (docs/09 §1). That is what stops it being
 * usable as an open proxy.
 */

import { ytCauseFromUpstream, ytCauseIsTransient } from '../src/lib/tt-yt-cause';

interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

/** YouTube video ids: exactly 11 chars of URL-safe base64 (docs/06 §3). */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const OEMBED_TTL_S = 21_600; // 6 h, docs/06 §3 + docs/09 §3
const ERROR_TTL_S = 900; // 15 min for 404s — cheap, and they rarely un-delete

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
} as const;

function json(body: unknown, status: number, ttlSeconds: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${ttlSeconds}`,
      ...CORS,
    },
  });
}

async function oembed(id: string, ctx: ExecutionContext): Promise<Response> {
  const cacheKey = new Request(`https://tt-oembed.invalid/${id}`);
  const cache = caches.default;

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const upstream = new URL('https://www.youtube.com/oembed');
  upstream.searchParams.set('url', `https://www.youtube.com/watch?v=${id}`);
  upstream.searchParams.set('format', 'json');

  let res: Response;
  try {
    res = await fetch(upstream, { headers: { accept: 'application/json' } });
  } catch {
    // Network failure between the edge and YouTube. The client keeps the track
    // as status:'pending' and re-checks on Start (docs/06 §5, TT-YT-001), so a
    // transient blip must not look like a deleted video.
    return json({ error: 'upstream_unreachable' }, 502, 0);
  }

  if (!res.ok) {
    /*
     * The status is passed through UNCHANGED and the cause is named in the
     * body — docs/06 §3, rewritten from spike S1's measurements.
     *
     * This used to read `res.status === 401 ? 404 : res.status` with the body
     * hardcoded to `"unavailable"`, on the belief that "404/401 from oEmbed
     * means deleted or private". S1 measured otherwise: **401 is embedding
     * disabled by the owner**, which is a different thing to tell a user than
     * "this video is gone", and 403 is the one that means private. Rewriting
     * 401 to 404 destroyed the distinction, and the single body string destroyed
     * the rest of it — leaving the client, which docs/06 §3 had just told to
     * classify on the body, unable to distinguish anything at all.
     *
     * The player cannot recover any of it later: S1 found `onError` reports 150
     * for every cause. This response is the only place the reason exists.
     */
    const cause = ytCauseFromUpstream(res.status);

    /*
     * Only a verdict about the VIDEO earns the 15 minutes.
     *
     * `ERROR_TTL_S` used to apply to every non-ok status, which meant a 429 or
     * a 503 — the two that say the server is having a bad minute — were
     * remembered exactly as long as a 404. That is the opposite of what the 502
     * branch above already does, and for the same stated reason: a transient
     * blip must not look like a deleted video, and here it also could not be
     * cleared by retrying, because the retry hit the cache.
     */
    const transient = ytCauseIsTransient(cause);
    const out = json({ error: cause }, res.status, transient ? 0 : ERROR_TTL_S);
    if (!transient) ctx.waitUntil(cache.put(cacheKey, out.clone()));
    return out;
  }

  const data = (await res.json()) as Record<string, unknown>;
  // Forward only what the app renders (docs/06 §5) — not the raw upstream body,
  // which also carries embeddable HTML we neither need nor want to pass through.
  const out = json(
    {
      title: data['title'] ?? null,
      author_name: data['author_name'] ?? null,
      thumbnail_url: data['thumbnail_url'] ?? null,
    },
    200,
    OEMBED_TTL_S,
  );
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/yt/oembed') {
      // A WAF rule blocks non-GET on /api/* at the edge (docs/10 §5); this is
      // the same rule enforced in code, so local dev behaves like production.
      if (request.method !== 'GET') {
        return json({ error: 'method_not_allowed' }, 405, 0);
      }

      const id = url.searchParams.get('id') ?? '';
      if (!VIDEO_ID.test(id)) {
        // Same cause word the upstream 400 produces, because it IS the same
        // thing to the user: a string that cannot be a video id. Whether we or
        // YouTube noticed is our business, not theirs (src/lib/tt-yt-cause.ts).
        return json({ error: 'invalid_id' }, 400, 0);
      }

      return oembed(id, ctx);
    }

    // Everything else is a static asset. Note these mostly do NOT reach this
    // handler: Workers Static Assets serves a matching asset before invoking
    // the Worker, so `_headers` — not code here — governs asset responses
    // (which is why Cache-Control lives there, see public/_headers).
    // This call covers the paths with no matching asset, where
    // not_found_handling: "404-page" serves dist/404.html (docs/10 §3).
    return env.ASSETS.fetch(request);
  },
};
