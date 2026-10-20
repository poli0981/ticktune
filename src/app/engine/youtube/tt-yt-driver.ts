import { ytCauseFromResponse } from '../../../lib/tt-yt-cause';
import { readDurations } from './tt-yt-import';
import type { TtYtLookup, TtYtMeta, TtYtPorts } from './types';

/**
 * The browser half of the YouTube importer — docs/06 §5 step 4.
 *
 * Named `*-driver.ts` so the coverage gate skips it (docs/13 §1): it is one
 * `fetch` and the error handling around it, and "unit testing" that would mean
 * asserting a mocked `fetch`. Every decision it could make lives in
 * `src/lib/tt-yt-cause.ts` and `tt-yt-import.ts`, both of which are pure.
 */

/**
 * ⚠️ **Read `res.status` BEFORE `res.json()`, and never let either throw.**
 *
 * Three different failures arrive here looking like three different things:
 *
 * 1. Our Worker's own JSON error — readable, status carries the cause.
 * 2. **A 429 from the Cloudflare rate-limit rule** (`docs/10 §6`). That block
 *    page is HTML and carries no CORS header, so `res.json()` throws a
 *    `SyntaxError` — and depending on how the edge terminates it, the browser
 *    may reject the `fetch` outright instead, with an opaque network error
 *    indistinguishable from being offline.
 * 3. A genuine network failure.
 *
 * The old shape — `await res.json()` first, classify second — turns (2) into an
 * unhandled exception during a fifty-link import. So the status decides, the
 * body is only ever read on success, and the whole thing is wrapped: this port
 * is contractually unable to reject (`types.ts`).
 */
/** Per-link ceiling for the oEmbed lookup; a timeout is transient (`pending`). */
const LOOKUP_TIMEOUT_MS = 10_000;

async function lookup(videoId: string): Promise<TtYtLookup> {
  let res: Response;
  try {
    res = await fetch(`/api/yt/oembed?id=${encodeURIComponent(videoId)}`, {
      headers: { accept: 'application/json' },
      // A stalled connection used to hold the whole sequential import — and the
      // disabled "Thêm" button — indefinitely. Longer than the Worker's own
      // upstream limit (8 s), so a slow YouTube reports as the Worker's 502.
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch {
    // Offline, DNS, or a CORS-opaque rejection from an edge block page. All
    // transient as far as the user is concerned, and all keep the track.
    return { ok: false, cause: 'upstream_unreachable' };
  }

  if (!res.ok) {
    // The decision — including "is this status even ours to read" — lives in the
    // pure module, where it is unit-tested. See its note: a static 404 page once
    // made three good videos look deleted.
    return { ok: false, cause: ytCauseFromResponse(res.status, res.headers.get('content-type')) };
  }

  try {
    const body = (await res.json()) as Partial<TtYtMeta>;
    return {
      ok: true,
      meta: {
        title: body.title ?? null,
        author_name: body.author_name ?? null,
        thumbnail_url: body.thumbnail_url ?? null,
      },
    };
  } catch {
    /*
     * A 200 whose body will not parse did NOT come from our Worker — it always
     * answers `application/json`, and this is the branch where it did not.
     *
     * The last hole in the rule `tt-yt-cause.ts` states for the `!res.ok` path.
     * This used to return `unavailable`, which is non-transient, so a captive
     * portal or a challenge page answering 200 rejected the track and told the
     * user their video was unusable. Same evidence, same verdict as every other
     * response we cannot attribute: transient, and the track survives.
     */
    return { ok: false, cause: 'upstream_unreachable' };
  }
}

/**
 * docs/06 §3 (v2.0) — lengths for a batch of links, one request.
 *
 * Never rejects, and `null` means "not now" whatever the reason: no key on this
 * deployment, the quota spent, the edge unreachable, a 429. The track keeps
 * `–`, "Match queue length" keeps its reason, and the player still backfills
 * the length on play — exactly the v1 behaviour, so a failure here costs a
 * convenience and nothing else. Which of those it was is the Worker's log to
 * tell; the status is read before the body for the reason `lookup` gives.
 */
export async function lookupDurations(ids: readonly string[]): Promise<Map<string, number> | null> {
  if (ids.length === 0) return new Map();
  let res: Response;
  try {
    res = await fetch(`/api/yt/durations?ids=${ids.map(encodeURIComponent).join(',')}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    return readDurations(await res.json(), ids);
  } catch {
    return null;
  }
}

export function browserYtPorts(onProgress?: TtYtPorts['onProgress']): TtYtPorts {
  return {
    newId: () => crypto.randomUUID(),
    now: () => Date.now(),
    lookup,
    ...(onProgress === undefined ? {} : { onProgress }),
  };
}
