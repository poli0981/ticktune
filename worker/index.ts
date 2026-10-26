/**
 * The edge endpoints — docs/01 §1, docs/06 §3.
 *
 * Two, each for a reason the browser cannot meet on its own:
 *
 * - `/api/yt/oembed` — https://www.youtube.com/oembed sends no CORS headers.
 * - `/api/yt/durations` (v2.0) — the YouTube Data API needs a key, and a key in
 *   the page is a key anyone can take. It stays a Worker secret.
 *
 * Neither is a URL proxy. The only input is 11-character video ids matched
 * against a strict regex; every upstream URL is constructed here and never
 * taken from the request (docs/09 §1). That is what stops them being usable as
 * open proxies. Everything else is static assets.
 */

import { isoDurationMs } from '../src/lib/tt-iso-duration';
import { ytCauseFromUpstream, ytCauseIsTransient } from '../src/lib/tt-yt-cause';

/** Workers Rate Limiting binding — counted in edge memory, never logged. */
interface TtRateLimit {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
}

interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  /**
   * YouTube Data API v3 key (docs/06 §3, docs/10 §3). A Worker SECRET, set with
   * `wrangler versions secret put` — the dashboard and `wrangler secret put`
   * both deploy, which production must only ever do from a signed tag.
   * Absent → 503 `not_configured`, and the app keeps `–` as it did before v2.0.
   */
  YT_DATA_API_KEY?: string;
  /** `ratelimits` in wrangler.jsonc — per-IP budget for every /api/* request. */
  API_LIMIT?: TtRateLimit;
  /** `ratelimits` in wrangler.jsonc — per-IP budget for /api/yt/durations. */
  YT_DURATIONS_LIMIT?: TtRateLimit;
}

/**
 * Has this client spent its budget? Keyed on the client IP, counted in edge
 * memory only, never logged (docs/10 §6, the Privacy Policy §6).
 *
 * A limiter that cannot answer lets the request through: both budgets guard
 * against floods, and failing closed would turn a Cloudflare hiccup into an
 * outage for every user at once. No binding (unit tests, a bare `wrangler dev`
 * without the config) means no limit.
 */
async function overBudget(limiter: TtRateLimit | undefined, request: Request): Promise<boolean> {
  if (limiter === undefined) return false;
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const verdict = await limiter.limit({ key: ip }).catch(() => ({ success: true }));
  return !verdict.success;
}

/** YouTube video ids: exactly 11 chars of URL-safe base64 (docs/06 §3). */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const OEMBED_TTL_S = 21_600; // 6 h, docs/06 §3 + docs/09 §3
const ERROR_TTL_S = 900; // 15 min for 404s — cheap, and they rarely un-delete

/**
 * How long to wait for youtube.com before calling the answer transient.
 *
 * There was no limit, so one stalled upstream connection held the request — and
 * the client's sequential 50-link import behind it — for as long as the runtime
 * allowed. The client has its own, longer timeout (tt-yt-driver.ts).
 */
const UPSTREAM_TIMEOUT_MS = 8_000;

/**
 * No CORS headers, deliberately — the endpoint is SAME-ORIGIN only.
 *
 * It sent `Access-Control-Allow-Origin: *` from the first version, on the
 * reasoning that an error response without it "would be unreadable to the
 * client". That premise was wrong: the app calls `/api/yt/oembed` on its own
 * origin (tt-yt-driver.ts), and same-origin responses are readable with no CORS
 * header at all. The only thing `*` did was let ANY website use this Worker as a
 * free, CORS-enabled oEmbed proxy — billed per request on Workers Paid.
 * `wrangler dev` and the Version URLs serve pages and API from one origin too.
 */
function json(body: unknown, status: number, ttlSeconds: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${ttlSeconds}`,
      // `_headers` covers static assets only; Worker responses need their own.
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * The cache key carries a version, because a hit is returned VERBATIM — headers
 * included. An entry written by an older Worker therefore keeps that Worker's
 * headers for its whole TTL: after this file dropped `ACAO: *` and added
 * `nosniff`, a GET on the PR's preview still came back with v1.0's `*` and no
 * `nosniff` (while a HEAD, which never reaches the cache, carried the new ones).
 * Bump this whenever what is stored changes shape or headers; old entries are
 * then never read again and simply expire.
 */
const CACHE_VERSION = 'v2';

async function oembed(id: string, ctx: ExecutionContext): Promise<Response> {
  const cacheKey = new Request(`https://tt-oembed.invalid/${CACHE_VERSION}/${id}`);
  const cache = caches.default;

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const upstream = new URL('https://www.youtube.com/oembed');
  upstream.searchParams.set('url', `https://www.youtube.com/watch?v=${id}`);
  upstream.searchParams.set('format', 'json');

  let res: Response;
  try {
    res = await fetch(upstream, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // Network failure or timeout between the edge and YouTube. The client keeps
    // the track as status:'pending' and re-checks on Start (docs/06 §5,
    // TT-YT-001), so a transient blip must not look like a deleted video.
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

  /*
   * A 200 is not a promise of JSON. A challenge page, a captive portal on the
   * upstream path, or a literal `null` body all arrive as `ok` — and this used to
   * be a bare `res.json()` followed by `data['title']`, so each one threw out of
   * the handler and Cloudflare answered with its 1101 HTML error page. The
   * client already treats such answers as transient; now they are reported as
   * one, uncached, so a retry is a real retry.
   */
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = await res.json();
    if (parsed === null || typeof parsed !== 'object') throw new TypeError('not an object');
    data = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'upstream_unreachable' }, 502, 0);
  }

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

/** One `videos.list` call takes at most 50 ids — and so does the queue (docs/02 §4). */
const MAX_DURATION_IDS = 50;

/**
 * 24 h for a length, 15 min for "none". YouTube's developer policies allow
 * keeping API data up to 30 days; a day keeps the quota near zero for a queue
 * someone re-imports. A video with no length — live, unaired, private, gone —
 * may gain one, so that answer is re-asked sooner.
 */
const DURATION_TTL_S = 86_400;
const NO_DURATION_TTL_S = 900;
const DURATION_CACHE_VERSION = 'v1';

/**
 * The key's website restriction is `https://ticktune.net/*` (docs/10 §3), and
 * Google checks it against the Referer of the API request — which, from here,
 * is whatever this Worker sends. Version URLs send the same one, so a PR's
 * preview exercises the real key.
 */
const DATA_API_REFERER = 'https://ticktune.net/';

/** `ids=a,b,c` → unique ids, or null if any is malformed or there are none or too many. */
function parseIds(param: string | null): string[] | null {
  if (param === null || param === '') return null;
  const ids = [...new Set(param.split(','))];
  if (ids.length > MAX_DURATION_IDS || !ids.every((id) => VIDEO_ID.test(id))) return null;
  return ids;
}

const durationKey = (id: string) =>
  new Request(`https://tt-yt-duration.invalid/${DURATION_CACHE_VERSION}/${id}`);

/**
 * docs/06 §3 — `{durations: {id: ms | null}}` for up to 50 ids, one Data API
 * call for whatever the cache does not hold.
 *
 * Every failure is uncached and says so in one word; the app treats them all
 * alike — durations stay `–`, the player still backfills on play — so the
 * words are for Workers Logs, where "why is Match disabled for links" gets
 * answered.
 */
async function durations(ids: string[], env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const out: Record<string, number | null> = {};
  const missing: string[] = [];
  await Promise.all(
    ids.map(async (id) => {
      const hit = await cache.match(durationKey(id));
      const ms = hit ? ((await hit.json()) as { ms?: unknown }).ms : undefined;
      if (typeof ms === 'number' || ms === null) out[id] = ms;
      else missing.push(id);
    }),
  );
  if (missing.length === 0) return json({ durations: out }, 200, NO_DURATION_TTL_S);

  const key = env.YT_DATA_API_KEY;
  if (key === undefined || key === '') return json({ error: 'not_configured' }, 503, 0);

  const upstream = new URL('https://www.googleapis.com/youtube/v3/videos');
  upstream.searchParams.set('part', 'contentDetails');
  upstream.searchParams.set('id', missing.join(','));
  upstream.searchParams.set('fields', 'items(id,contentDetails/duration)');

  let res: Response;
  try {
    res = await fetch(upstream, {
      // The key travels in a header, not the URL: nothing that records URLs
      // between here and Google gets to keep it.
      headers: { accept: 'application/json', 'x-goog-api-key': key, referer: DATA_API_REFERER },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return json({ error: 'upstream_unreachable' }, 502, 0);
  }
  // 403 is quota spent, or the key or its restriction refusing us — a fact
  // about us, not about any video. 5xx and 429 are Google having a bad minute.
  if (!res.ok) {
    const refused = res.status >= 400 && res.status < 500 && res.status !== 429;
    return json({ error: refused ? 'upstream_refused' : 'upstream_unreachable' }, 503, 0);
  }

  let items: unknown[];
  try {
    const parsed: unknown = await res.json();
    if (parsed === null || typeof parsed !== 'object') throw new TypeError('not an object');
    const list = (parsed as { items?: unknown }).items ?? [];
    if (!Array.isArray(list)) throw new TypeError('items is not an array');
    items = list as unknown[];
  } catch {
    return json({ error: 'upstream_unreachable' }, 502, 0);
  }

  const found = new Map<string, number | null>();
  for (const item of items) {
    const it = item as { id?: unknown; contentDetails?: { duration?: unknown } } | null;
    if (typeof it?.id === 'string' && typeof it.contentDetails?.duration === 'string') {
      found.set(it.id, isoDurationMs(it.contentDetails.duration));
    }
  }
  // An id Google did not return is private, deleted or never existed: no length.
  for (const id of missing) {
    const ms = found.get(id) ?? null;
    out[id] = ms;
    ctx.waitUntil(
      cache.put(
        durationKey(id),
        json({ ms }, 200, ms === null ? NO_DURATION_TTL_S : DURATION_TTL_S),
      ),
    );
  }
  return json({ durations: out }, 200, NO_DURATION_TTL_S);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    /*
     * Every /api/* request spends from one per-IP budget, before anything else
     * — a malformed or wrong-method call too, since a flood is made of exactly
     * those. docs/10 §6 promised this budget from a zone rule since P4; the
     * rule never existed, so for ten releases oEmbed had no limit at all.
     *
     * Static pages are not counted, and cannot be from here: the asset layer
     * answers them before this Worker runs (`run_worker_first` is unset, and
     * setting it would log and bill every page view — wrangler.jsonc).
     */
    if (url.pathname.startsWith('/api/') && (await overBudget(env.API_LIMIT, request))) {
      return json({ error: 'rate_limited' }, 429, 0);
    }

    if (url.pathname === '/api/yt/durations') {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, 0);
      const ids = parseIds(url.searchParams.get('ids'));
      if (ids === null) return json({ error: 'invalid_id' }, 400, 0);

      /*
       * The quota is the budget this one guards: 10,000 units a day, one per
       * call — so a malformed request, which never reaches Google, spends none
       * of it. Running out costs nothing but this convenience until midnight
       * Pacific, which is why this limiter fails open too.
       */
      if (await overBudget(env.YT_DURATIONS_LIMIT, request)) {
        return json({ error: 'rate_limited' }, 429, 0);
      }
      return durations(ids, env, ctx);
    }

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
