/**
 * Why a YouTube video cannot be used — docs/06 §3, measured in spike S1.
 *
 * Lives in `src/lib/` for the reason `tt-domain-types.ts` records: this is
 * vocabulary two very different programs must agree on. `worker/index.ts` runs
 * on workerd and decides the cause; the app runs in the browser and renders it.
 * A copy on each side is a copy that drifts, and the whole value here is that
 * both ends name the same five things.
 *
 * ## Why the status and not the body
 *
 * Spike S1 measured this against the live endpoint on 2026-07-22, and it
 * overturned what `docs/06 §3` had said since 2026-07-21.
 *
 * The player is no help: `onError` reports **150** for every failure cause
 * there is — private, age-restricted, region-blocked, deleted, malformed,
 * embed-disabled — and `onError 100` was never observed at all, on either the
 * nocookie or the regular host. So the only place cause survives is the oEmbed
 * **status**, and it survives there cleanly:
 *
 * | Upstream | Cause |
 * |----------|-------|
 * | 400 | structurally impossible id — 11 chars, but the final character is not one of the 16 that can terminate a base64url id |
 * | 401 | embedding disabled by the owner |
 * | 403 | private / unlisted |
 * | 404 | well-formed id, no such video |
 * | 2xx | exists and is listed — which says **nothing** about whether it plays |
 *
 * The 400/404 split was itself a correction: an earlier S1 note concluded "a
 * deleted video is a 400, not a 404" from two samples that both ended in a
 * character no id can end with. They were malformed, not missing. Re-measured
 * across the whole alphabet, 26 ids, no exceptions.
 *
 * ## What is deliberately NOT distinguishable
 *
 * Age-restricted and region-blocked both return **200 with full title and
 * channel**, then refuse to play. There is no signal that separates them, so
 * `blocked` names both and the overlay says so. That is the measured result,
 * not a gap left for later.
 */

export type TtYtCause =
  /** Our regex rejected the shape, or upstream called the id impossible. */
  | 'invalid_id'
  /** 401 — the owner disabled embedding. */
  | 'embed_off'
  /** 403 — private or unlisted. */
  | 'private'
  /** 404 — well-formed, but there is no such video. */
  | 'not_found'
  /** The edge could not reach YouTube. Transient: keep the track as pending. */
  | 'upstream_unreachable'
  /**
   * 429 — our own edge rate limit, not YouTube's (`docs/10 §6`).
   *
   * Transient like the one above, and deliberately NOT folded into it: a user
   * who pasted fifty links wants to hear "slow down", not "the network is
   * broken". ⚠️ The block page Cloudflare returns carries no CORS header, so
   * the client may see a rejected `fetch` rather than a readable 429 — the
   * driver has to treat both as this.
   */
  | 'rate_limited'
  /** Any other non-2xx. Honest fallback rather than a guess. */
  | 'unavailable';

/**
 * Map an oEmbed response status to a cause.
 *
 * @param status the status YouTube returned, NOT one we invented.
 */
export function ytCauseFromUpstream(status: number): TtYtCause {
  if (status === 400) return 'invalid_id';
  if (status === 401) return 'embed_off';
  if (status === 403) return 'private';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  /*
   * 5xx is the SERVER failing, never the video.
   *
   * This used to fall through to `unavailable`, which is non-transient — so a
   * YouTube outage did not merely fail an import, it **rejected every pasted
   * link permanently**, and `worker/index.ts` then edge-cached that verdict for
   * fifteen minutes. The user's remedy was to wait out a cache they cannot see
   * and re-paste fifty links.
   *
   * It is the same reasoning that already gave our own 502 this cause: nothing
   * about a 503 from oEmbed says anything about whether the video plays.
   */
  if (status >= 500) return 'upstream_unreachable';
  return 'unavailable';
}

/**
 * Whether a cause should keep the track rather than reject it — docs/06 §5.
 *
 * The two transient ones do. Everything else is a property of the *video*, so
 * re-checking on Start would fail identically and rejecting now is honest.
 */
export function ytCauseIsTransient(cause: TtYtCause): boolean {
  return cause === 'upstream_unreachable' || cause === 'rate_limited';
}

/**
 * Classify a failed response — the status, but **only if it is ours**.
 *
 * Found by using the app, not by reading it: under `astro preview` the Worker
 * does not run, so `/api/yt/oembed` fell through to the static 404 page. A 404
 * maps to `not_found`, so three known-good videos were all reported as
 * *"deleted or private"* — their owners blamed for a route that was not there.
 *
 * It is not a dev-only wrinkle. A misrouted deploy, a captive portal, a
 * corporate proxy or a Cloudflare challenge each answers with **HTML on some
 * status**, and every one of those would arrive as a confident wrong sentence
 * about the user's video — the precise failure spike S1 spent a day removing.
 *
 * Our Worker always answers `application/json`; nothing else in the chain does.
 * So the content type is what earns a status the right to be read as a cause.
 * Anything else is transient, and the track survives as `pending` rather than
 * being rejected for a reason we invented.
 *
 * @param contentType the raw header, or null when absent.
 */
export function ytCauseFromResponse(status: number, contentType: string | null): TtYtCause {
  if (!(contentType ?? '').includes('application/json')) {
    return status === 429 ? 'rate_limited' : 'upstream_unreachable';
  }
  // Our own 502 needs no special case any more: `ytCauseFromUpstream` sends
  // every 5xx to `upstream_unreachable`, which is the same answer for the same
  // reason — the edge failed, and that says nothing about the video.
  return ytCauseFromUpstream(status);
}
