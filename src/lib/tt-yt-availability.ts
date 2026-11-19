import type { TtYtCause } from './tt-yt-cause';

/**
 * Whether a video can play in an embed, from the YouTube Data API — docs/06 §3
 * (v2.3).
 *
 * Shared, like `tt-yt-cause.ts`: `worker/index.ts` reads Google's answer and
 * decides, and the app reads the Worker's answer back. Both sides must agree
 * on the same words.
 *
 * ## Why this exists
 *
 * Spike S1 left one gap open on purpose. oEmbed answers **200 with a full
 * title** for an age-restricted or a region-blocked video, and the player
 * reports both as `onError 150` — so until v2.3 they imported as playable and
 * failed only on play, behind the TT-YT-150 card and a 5 s skip. `videos.list`
 * says what oEmbed cannot: `status.embeddable`, `contentRating.ytRating`, the
 * `regionRestriction` lists, `liveBroadcastContent` and `uploadStatus`. The
 * import asks it once per paste, and a link whose answer names a reason never
 * reaches the shelf.
 *
 * ## Facts, then a verdict
 *
 * The Worker caches **facts** per video, and they hold nothing about the
 * person who asked: the region lists are stored raw. The verdict is computed
 * per request from the country Cloudflare attaches to it (`request.cf.country`),
 * which is never sent to Google and never stored — so one cache entry serves
 * every visitor, and the same video is right for each of them.
 *
 * A verdict is only ever drawn from **positive evidence**. An id Google did not
 * return carries no facts and so no verdict: oEmbed already rejects private and
 * deleted links at import, and a guess here could only reject a good one.
 */

/** The reasons this answer can give — each a property of the video, none transient. */
export type TtYtUnplayable = Extract<
  TtYtCause,
  'embed_off' | 'private' | 'not_found' | 'age_restricted' | 'region_blocked' | 'not_yet'
>;

const UNPLAYABLE: ReadonlySet<string> = new Set<TtYtUnplayable>([
  'embed_off',
  'private',
  'not_found',
  'age_restricted',
  'region_blocked',
  'not_yet',
]);

/** Is `word` a reason the Worker's availability answer may carry? */
export function isYtUnplayable(word: unknown): word is TtYtUnplayable {
  return typeof word === 'string' && UNPLAYABLE.has(word);
}

/**
 * What the Data API said about one video — every field optional, present only
 * when it argues against playing. JSON-safe, because it is what the Worker
 * caches.
 */
export interface TtYtFacts {
  /** `status.embeddable` is false: the owner turned embedding off. */
  embedOff?: true;
  /** `contentDetails.contentRating.ytRating` is `ytAgeRestricted`. */
  age?: true;
  /** `regionRestriction.allowed` — viewable only here; empty means nowhere. */
  allowed?: string[];
  /** `regionRestriction.blocked` — blocked here; empty means nowhere. */
  blocked?: string[];
  /** An upcoming premiere or stream, or an upload still processing. */
  notYet?: true;
  /** `status.privacyStatus` is `private`. */
  private?: true;
  /** `status.uploadStatus` is `deleted`, `failed` or `rejected`. */
  gone?: true;
}

/** ISO 3166-1 alpha-2, the form both `regionRestriction` and `cf.country` use. */
const REGION = /^[A-Z]{2}$/;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * A region list, believed whole or not at all. An empty `allowed` list means
 * "blocked everywhere", so a list with one malformed entry must not be
 * filtered down to empty — it is dropped instead, and argues nothing.
 */
function regions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((v): v is string => typeof v === 'string' && REGION.test(v))
    ? [...value]
    : undefined;
}

/** Google's `videos.list` item → the facts. A shape it does not recognise argues nothing. */
export function ytFactsFromItem(item: unknown): TtYtFacts {
  const it = record(item);
  const details = record(it.contentDetails);
  const status = record(it.status);
  const snippet = record(it.snippet);
  const restriction = record(details.regionRestriction);
  const facts: TtYtFacts = {};

  if (status.embeddable === false) facts.embedOff = true;
  if (record(details.contentRating).ytRating === 'ytAgeRestricted') facts.age = true;
  const allowed = regions(restriction.allowed);
  if (allowed !== undefined) facts.allowed = allowed;
  const blocked = regions(restriction.blocked);
  if (blocked !== undefined) facts.blocked = blocked;
  if (snippet.liveBroadcastContent === 'upcoming' || status.uploadStatus === 'uploaded') {
    facts.notYet = true;
  }
  if (status.privacyStatus === 'private') facts.private = true;
  if (['deleted', 'failed', 'rejected'].includes(String(status.uploadStatus))) facts.gone = true;
  return facts;
}

/** Facts read back from the Worker's cache — the same shape, believed only as far as it goes. */
export function ytFactsFromCache(raw: unknown): TtYtFacts {
  const r = record(raw);
  const facts: TtYtFacts = {};
  if (r.embedOff === true) facts.embedOff = true;
  if (r.age === true) facts.age = true;
  const allowed = regions(r.allowed);
  if (allowed !== undefined) facts.allowed = allowed;
  const blocked = regions(r.blocked);
  if (blocked !== undefined) facts.blocked = blocked;
  if (r.notYet === true) facts.notYet = true;
  if (r.private === true) facts.private = true;
  if (r.gone === true) facts.gone = true;
  return facts;
}

/**
 * Facts that may change within the day — a premiere airs, processing ends — so
 * the Worker re-asks them on the short TTL.
 */
export function ytFactsAreProvisional(facts: TtYtFacts): boolean {
  return facts.notYet === true;
}

/**
 * `request.cf.country`, or null when it cannot be compared: absent, `XX`
 * (unknown) or `T1` (Tor). Null means the region lists are not consulted —
 * nobody is refused a video on a country we do not know.
 */
export function ytCountry(raw: unknown): string | null {
  return typeof raw === 'string' && REGION.test(raw) && raw !== 'XX' ? raw : null;
}

/**
 * The one reason this video will not play for this visitor, or null.
 *
 * One reason per video, the most permanent first: a video that is both gone
 * and region-blocked is gone.
 */
export function ytUnplayable(facts: TtYtFacts, country: string | null): TtYtUnplayable | null {
  if (facts.gone === true) return 'not_found';
  if (facts.private === true) return 'private';
  if (facts.embedOff === true) return 'embed_off';
  if (facts.age === true) return 'age_restricted';
  if (country !== null) {
    const blockedHere =
      facts.allowed !== undefined
        ? !facts.allowed.includes(country)
        : facts.blocked?.includes(country) === true;
    if (blockedHere) return 'region_blocked';
  }
  if (facts.notYet === true) return 'not_yet';
  return null;
}
