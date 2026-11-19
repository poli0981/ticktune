import type { TtYtUnplayable } from '../../../lib/tt-yt-availability';
import type { TtYtCause } from '../../../lib/tt-yt-cause';
import type { TtImportResult } from '../importer/types';

/**
 * YouTube engine types — docs/06 §5.
 *
 * The shape that matters is `TtYtPorts.lookup`. Everything the network can do
 * to us arrives through that one function, which is what keeps the pipeline
 * below unit-testable across all six causes without Playwright, without the
 * network, and without YouTube being up. It is the same trick
 * `TtImportPorts` plays for local files (docs/13 §1).
 */

/** What `/api/yt/oembed` gives back when it worked. */
export interface TtYtMeta {
  title: string | null;
  author_name: string | null;
  thumbnail_url: string | null;
}

export type TtYtLookup = { ok: true; meta: TtYtMeta } | { ok: false; cause: TtYtCause };

/**
 * One playlist as `/api/yt/playlists` answered for it — docs/06 §9 (v2.1).
 *
 * `ids` are the playable videos of its first page, in playlist order;
 * `skipped` the private and deleted entries on that page; `total` what the
 * list holds in all, so a list longer than its first page can say so.
 */
export type TtYtList =
  { ok: true; ids: string[]; skipped: number; total: number } | { ok: false; cause: TtYtCause };

/**
 * The batch. `lists` is null when the call itself failed — no key on this
 * deployment, the quota spent, a 429, the edge unreachable — so every list
 * went unanswered. `reached` is docs/06 §8's evidence: whether OUR edge
 * answered, which a JSON refusal is and a static 404 page is not.
 */
export interface TtYtListLookup {
  reached: boolean;
  lists: Map<string, TtYtList> | null;
}

/**
 * docs/06 §3 (v2.3) — one `/api/yt/durations` answer: the lengths Google knows,
 * and the videos that cannot play for this visitor, each with its reason.
 */
export interface TtYtAvailability {
  durations: Map<string, number>;
  unplayable: Map<string, TtYtUnplayable>;
}

/**
 * A YouTube import's result: the shared shape, plus what its one availability
 * call (v2.3) came back with:
 *
 * - the lengths it learned — for the shelf's older links as well as the new
 *   ones, so the session fills them without asking again;
 * - `'unanswered'` — it asked and got nothing; asking again in the same
 *   moment would only spend a call, so the session logs TT-YT-008 instead;
 * - `null` — nothing was asked (nothing accepted, or a port without
 *   `availability`); the session asks the way it did before v2.3.
 */
export interface TtYtImportResult extends TtImportResult {
  lengths: Map<string, number> | 'unanswered' | null;
}

export interface TtYtPorts {
  newId: () => string;
  now: () => number;
  /**
   * One oEmbed pre-check. **Never rejects** — every failure is a `cause`.
   *
   * That contract is load-bearing rather than stylistic: a 429 from an edge
   * block page carries no CORS header, so the browser may surface it as a
   * *rejected* fetch rather than a readable response. (The Worker's own 429
   * is readable JSON since v2.0.3, docs/10 §6; a zone rule's never is.) A port
   * that could throw would make "rate limited" indistinguishable from a bug,
   * so the driver swallows both into `rate_limited` and the pipeline never
   * needs a try/catch.
   */
  lookup: (videoId: string) => Promise<TtYtLookup>;
  /**
   * docs/06 §9 — up to ten playlists in one call. Never rejects, like
   * `lookup`. Optional, so a port without it reads as "not here": every list
   * is reported unavailable and nothing is added.
   */
  lookupPlaylists?: (ids: readonly string[]) => Promise<TtYtListLookup>;
  /**
   * docs/06 §3 (v2.3) — lengths and availability for up to 50 videos in one
   * call. Never rejects; null means "not answered" whatever the reason, and the
   * import then keeps every link oEmbed accepted, as before v2.3. Optional, like
   * `lookupPlaylists`.
   */
  availability?: (ids: readonly string[]) => Promise<TtYtAvailability | null>;
  /** docs/02 §4 — same progress contract the local importer uses. */
  onProgress?: (done: number, total: number) => void;
}
