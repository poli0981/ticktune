/**
 * Extracting a video id from a pasted line — docs/06 §5 step 1.
 *
 * Pure, and deliberately strict in one specific way: **the id this returns must
 * satisfy the Worker's own `^[A-Za-z0-9_-]{11}$`** (`worker/index.ts`). If the
 * two ever disagree, the client sends something the edge rejects as
 * `invalid_id` and the user is told their link is malformed when the parser
 * accepted it — a contradiction from inside the app. A unit test pins the two
 * regexes to the same shape rather than trusting them to stay aligned.
 *
 * Note what an 11-character id does NOT guarantee: **it can still be
 * structurally impossible**. An id encodes 64 bits of base64url, so the final
 * character carries only 4 bits and must be one of
 * `A E I M Q U Y c g k o s w 0 4 8`. Spike S1 measured YouTube answering 400
 * for anything else, across the whole alphabet with no exceptions. This module
 * does **not** enforce that: the check belongs to the endpoint that already
 * reports it (`src/lib/tt-yt-cause.ts` maps that 400 to `invalid_id`), and
 * duplicating a rule about YouTube's id encoding into our parser would be a
 * second place to be wrong when they change it.
 */

/** docs/06 §5 — the same shape the Worker enforces. */
const ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The six accepted URL shapes, verbatim from docs/06 §5:
 *
 *     watch?v= · youtu.be/ · shorts/ · live/ · embed/ · music.youtube.com/watch?v=
 *
 * Matched against the parsed URL rather than by one large regex, because
 * "extra params ignored" is free that way and a regex over a whole URL is where
 * `&list=` and `?si=` quietly break things.
 */
const PATH_PREFIXES = ['/shorts/', '/live/', '/embed/'] as const;

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  // Our own player host. Nobody pastes these, but round-tripping an embed URL
  // the app itself produced should not be the one thing it cannot read.
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/**
 * @returns the 11-character id, or null when the line is not a video link.
 *   Null is the caller's cue for TT-YT-002 (docs/06 §5).
 */
export function parseVideoId(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;

  // A bare id, which is what the S1 harness and the manual matrix both use.
  if (ID.test(trimmed)) return trimmed;

  let url: URL;
  try {
    // Accept a scheme-less paste — people copy `youtu.be/x` out of chat all the
    // time, and rejecting it would be pedantry rather than validation.
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (!HOSTS.has(url.hostname.toLowerCase())) return null;

  // youtu.be/<id> — the id is the whole path.
  if (url.hostname.toLowerCase().endsWith('youtu.be')) {
    return take(url.pathname.slice(1));
  }

  const v = url.searchParams.get('v');
  if (v !== null) return take(v);

  for (const prefix of PATH_PREFIXES) {
    if (url.pathname.startsWith(prefix)) return take(url.pathname.slice(prefix.length));
  }

  return null;
}

/** First path segment only, so a trailing `/` or `/whatever` cannot leak in. */
function take(raw: string): string | null {
  const first = raw.split('/')[0] ?? '';
  return ID.test(first) ? first : null;
}

/**
 * Split a pasted textarea into lines and resolve each — docs/06 §5 step 1.
 *
 * Returns both halves rather than filtering: the rejected lines are what the
 * summary toast counts, and dropping them silently is the failure mode
 * `docs/01 §2` principle 5 exists to prevent.
 */
export function parseVideoIds(text: string): { ids: string[]; rejected: string[] } {
  const ids: string[] = [];
  const rejected: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const id = parseVideoId(line);
    if (id === null) rejected.push(line.trim());
    else ids.push(id);
  }

  return { ids, rejected };
}
