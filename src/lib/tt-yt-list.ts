/**
 * YouTube playlist ids — docs/06 §9 (v2.1). Shared by the Worker and the app.
 *
 * Shared for the reason `tt-yt-cause.ts` is: if the client and the edge
 * disagree about what a list id is, the client sends something the edge
 * refuses, and the user is told their link is malformed by the app that just
 * accepted it. One module, one answer.
 *
 * Pure, and no DOM types, so `tsconfig.worker.json` compiles it as it is.
 */

/**
 * A list id the Data API can be asked about: 13–64 URL-safe characters.
 *
 * Real ones are `PL` + 16 or 32, `UU`/`FL` + 22, `OLAK5uy_` + 33. The floor of
 * 13 is what keeps a bare line from being read both ways: an 11-character
 * token is a video id (`tt-yt-url.ts`), never a list.
 */
export const YT_LIST_ID = /^[A-Za-z0-9_-]{13,64}$/;

/** The viewer's own lists. The Data API reads them only with that viewer's sign-in. */
const PERSONAL = new Set(['LL', 'WL', 'LM']);

/**
 * Lists a key cannot read, so asking would only spend quota on a refusal.
 *
 * - `personal` — Liked videos, Watch later, YouTube Music's Liked music: two
 *   letters, private to their owner.
 * - `mix` — `RD…`, a Mix YouTube generates for each viewer as they watch.
 *
 * @returns null for a list worth asking about.
 */
export function ytListUnreadable(id: string): 'personal' | 'mix' | null {
  if (PERSONAL.has(id)) return 'personal';
  if (id.startsWith('RD')) return 'mix';
  return null;
}

/**
 * What a failed `playlistItems.list` says about the LIST — or that it says
 * nothing about it at all.
 *
 * 🔴 Decided by Google's `error.errors[0].reason`, not by the status alone: a
 * spent quota and a private list are both 403. Read by status, an exhausted
 * quota would tell every user that every playlist they paste is private, for
 * the rest of the day — the confident wrong cause spike S1 spent a day
 * removing from the video path (`tt-yt-cause.ts`).
 *
 * - `not_found` / `private` — a property of the list: cached, and told to the
 *   user as such.
 * - `upstream_unreachable` — Google having a bad minute: never cached.
 * - `refused` — the key, its restriction, the quota or a request we built
 *   wrong: a fact about US, which the Worker answers for the whole batch.
 */
export function ytListCause(
  status: number,
  reason: string | null,
): 'not_found' | 'private' | 'upstream_unreachable' | 'refused' {
  if (status >= 500 || status === 429) return 'upstream_unreachable';
  if (reason !== null && TRANSIENT.has(reason)) return 'upstream_unreachable';
  if (reason !== null && ABOUT_US.has(reason)) return 'refused';
  if (reason !== null && NOT_READABLE.has(reason)) return 'private';
  /*
   * The request is ours and fixed but for the id, so any other 400 or 404 is
   * about the LIST: missing, malformed past our shape check, or one the API
   * cannot list (`playlistOperationUnsupported`). Measured on the v2.1
   * preview: such an id refused the WHOLE batch while this read 400 as "us",
   * so one bad line cost the user the other nine.
   */
  if (status === 404 || status === 400) return 'not_found';
  return 'refused';
}

/** Google having a bad minute. */
const TRANSIENT = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError']);

/** Our key, its restriction or the quota — a fact about us, for the whole batch. */
const ABOUT_US = new Set([
  'quotaExceeded',
  'dailyLimitExceeded',
  'keyInvalid',
  'keyExpired',
  'accessNotConfigured',
  'ipRefererBlocked',
  'forbidden',
]);

/** A list that exists and that a key may not read. */
const NOT_READABLE = new Set([
  'playlistItemsNotAccessible',
  'watchHistoryNotAccessible',
  'watchLaterNotAccessible',
]);
