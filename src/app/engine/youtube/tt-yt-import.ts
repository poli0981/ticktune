import { ytCauseIsTransient, type TtYtCause } from '../../../lib/tt-yt-cause';
import { TT_QUEUE_CAP, isPlayable } from '../importer/tt-queue-rules';
import type { TtImportCode, TtImportResult, TtImportSkip, TtTrack } from '../importer/types';
import { parseVideoIds } from './tt-yt-url';
import type { TtYtLookup, TtYtPorts } from './types';

/**
 * The YouTube import pipeline — docs/06 §5.
 *
 * Pure over `TtYtPorts`, exactly as `tt-import.ts` is pure over
 * `TtImportPorts`, and for the same payoff: every rejection boundary below is a
 * unit test rather than a Playwright run against YouTube's servers, which is
 * fortunate because CI cannot depend on those at all (docs/13 §4).
 *
 * It returns the **same** `TtImportResult` the local pipeline does, so the
 * summary toast, the log fan-out and the queue append all work unchanged.
 */

/**
 * cause → what the user is told, and whether the track survives.
 *
 * The whole reason this map can exist is spike S1: the player collapses every
 * failure to `onError 150`, so the oEmbed status measured at import is the only
 * place a real reason lives (`src/lib/tt-yt-cause.ts`). Getting a track this
 * far and *then* discovering it is unplayable would mean the countdown is
 * already running.
 */
function codeForCause(cause: TtYtCause): TtImportCode {
  switch (cause) {
    case 'invalid_id':
      return 'TT-YT-002';
    case 'embed_off':
      return 'TT-YT-101';
    case 'private':
    case 'not_found':
      // docs/06 §4 sends both to `yt.err.gone`. They differ upstream (403 vs
      // 404) and the log keeps that, but "you cannot watch this" is one
      // sentence to a user either way.
      return 'TT-YT-100';
    case 'upstream_unreachable':
    case 'rate_limited':
      return 'TT-YT-001';
    case 'unavailable':
      // Registered precisely so an unclassified failure does not borrow a
      // confident wrong label from one of the rows above.
      return 'TT-YT-004';
  }
}

export interface TtYtImportInput {
  /** Raw textarea contents — one URL or id per line (docs/06 §5). */
  text: string;
  /** The queue as it stands. Capacity is measured against it. */
  queue: TtTrack[];
  /** docs/02 §3.1 — bypasses the videoId dedupe. */
  allowDuplicates: boolean;
}

export async function importLinks(
  input: TtYtImportInput,
  ports: TtYtPorts,
): Promise<TtImportResult> {
  const { text, queue, allowDuplicates } = input;

  const added: TtTrack[] = [];
  const skipped: TtImportSkip[] = [];
  const notes: TtImportSkip[] = [];

  // ── step 1: parse every line ──────────────────────────────────────────────
  const { ids, rejected } = parseVideoIds(text);
  for (const line of rejected) skipped.push({ code: 'TT-YT-002', fileName: line });

  // ── step 3: capacity, hoisted ahead of any network work ───────────────────
  // Same reasoning as docs/02 §4's step 0: checking the cap after the lookups
  // would spend 50 round-trips to add at most a handful of tracks. The code is
  // TT-YT-003, not TT-IMP-004 — docs/06 §5 gives the link cap its own.
  const existing = queue.filter(isPlayable).length;
  const capacity = Math.max(0, TT_QUEUE_CAP.youtube - existing);
  const accepted = ids.slice(0, capacity);
  for (const over of ids.slice(capacity)) skipped.push({ code: 'TT-YT-003', fileName: over });

  // ── step 2: dedupe by videoId ─────────────────────────────────────────────
  const seen = new Set(queue.map((t) => t.videoId).filter((v): v is string => v !== undefined));

  for (const [index, videoId] of accepted.entries()) {
    ports.onProgress?.(index, accepted.length);

    if (!allowDuplicates && seen.has(videoId)) {
      skipped.push({ code: 'TT-IMP-005', fileName: videoId });
      continue;
    }

    // ── step 4: the oEmbed pre-check ────────────────────────────────────────
    const result: TtYtLookup = await ports.lookup(videoId);

    if (!result.ok) {
      const code = codeForCause(result.cause);

      if (!ytCauseIsTransient(result.cause)) {
        skipped.push({ code, fileName: videoId });
        continue;
      }

      /*
       * Transient — keep it, as `pending`. docs/02 §1: pending counts toward
       * Start, because "the video is probably fine and blocking Start on a
       * flaky metadata lookup would be wrong".
       *
       * It is a NOTE rather than a skip: the track was added, so counting it
       * among the skips would make the summary toast lie about both numbers.
       */
      seen.add(videoId);
      notes.push({ code, fileName: videoId });
      added.push(track(videoId, null, ports, 'pending'));
      continue;
    }

    // ── step 5: push ────────────────────────────────────────────────────────
    seen.add(videoId);
    added.push(track(videoId, result, ports, 'ok'));
  }

  ports.onProgress?.(accepted.length, accepted.length);
  return { added, skipped, notes };
}

/**
 * docs/06 §5 — `durationMs` stays null until the player backfills it (§2), and
 * renders as `–` meanwhile (hard invariant 5).
 *
 * `videoId`, `sourceUrl` and `thumbnailUrl` are **written here**, which is the
 * point: all three have been declared on `TtTrack` since the first revision
 * with nothing ever assigning them. That is the shape of this project's
 * escaped bugs, so the unit tests assert the values rather than the types.
 */
function track(
  videoId: string,
  found: {
    meta: { title: string | null; author_name: string | null; thumbnail_url: string | null };
  } | null,
  ports: TtYtPorts,
  status: 'ok' | 'pending',
): TtTrack {
  const meta = found?.meta;
  return {
    id: ports.newId(),
    source: 'youtube',
    status,
    // Empty rather than a placeholder: the `N/A` fallback is applied at render
    // time by tt-track-display, and baking it in here would make a real title
    // of "N/A" indistinguishable from a missing one.
    title: meta?.title ?? '',
    artist: meta?.author_name ?? '',
    durationMs: null,
    videoId,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    ...(meta?.thumbnail_url === undefined || meta.thumbnail_url === null
      ? {}
      : { thumbnailUrl: meta.thumbnail_url }),
    addedAt: ports.now(),
  };
}
