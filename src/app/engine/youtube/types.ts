import type { TtYtCause } from '../../../lib/tt-yt-cause';

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

export interface TtYtPorts {
  newId: () => string;
  now: () => number;
  /**
   * One oEmbed pre-check. **Never rejects** — every failure is a `cause`.
   *
   * That contract is load-bearing rather than stylistic: the 429 our own edge
   * returns is a Cloudflare block page with no CORS header, so the browser may
   * surface it as a *rejected* fetch rather than a readable response. A port
   * that could throw would make "rate limited" indistinguishable from a bug,
   * so the driver swallows both into `rate_limited` and the pipeline never
   * needs a try/catch.
   */
  lookup: (videoId: string) => Promise<TtYtLookup>;
  /** docs/02 §4 — same progress contract the local importer uses. */
  onProgress?: (done: number, total: number) => void;
}
