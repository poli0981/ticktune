import { ytCauseFromUpstream, type TtYtCause } from '../../../lib/tt-yt-cause';
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
async function lookup(videoId: string): Promise<TtYtLookup> {
  let res: Response;
  try {
    res = await fetch(`/api/yt/oembed?id=${encodeURIComponent(videoId)}`, {
      headers: { accept: 'application/json' },
    });
  } catch {
    // Offline, DNS, or a CORS-opaque rejection from an edge block page. All
    // transient as far as the user is concerned, and all keep the track.
    return { ok: false, cause: 'upstream_unreachable' };
  }

  if (!res.ok) {
    // The status is the signal (docs/06 §3). The body is not consulted at all,
    // so an HTML block page cannot break this branch.
    return { ok: false, cause: causeFor(res.status) };
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
    // A 200 that is not JSON is nobody's documented behaviour, so it gets the
    // honest bucket rather than a guess.
    return { ok: false, cause: 'unavailable' };
  }
}

function causeFor(status: number): TtYtCause {
  // 502 is ours, not YouTube's — the Worker emits it when the edge could not
  // reach oEmbed at all, and it is the one status that must not be read as a
  // property of the video.
  if (status === 502) return 'upstream_unreachable';
  return ytCauseFromUpstream(status);
}

export function browserYtPorts(onProgress?: TtYtPorts['onProgress']): TtYtPorts {
  return {
    newId: () => crypto.randomUUID(),
    now: () => Date.now(),
    lookup,
    ...(onProgress === undefined ? {} : { onProgress }),
  };
}
