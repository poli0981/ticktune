import type { TtMode } from '../../../lib/tt-domain-types';
import { TT_MAX_COUNTDOWN_MS, TT_MIN_COUNTDOWN_MS } from '../timer/tt-format';
import type { TtTrack } from './types';

/**
 * The Start predicate and the queue caps — docs/02 §1.
 *
 * `ready` is deliberately a derived boolean on `setup`, not a state. An earlier
 * revision listed it as a state and it was a phantom: no screen, no component,
 * no E2E flow, and — fatally — no edge back to `setup`, so a user who had staged
 * a queue had no specified way to add or remove a track.
 */

/** docs/02 §4 / §1 — per-mode count caps. */
export const TT_QUEUE_CAP: Record<TtMode, number> = {
  single: 1,
  playlist: 95,
  youtube: 50,
};

/** docs/02 §4 — Playlist only. */
export const TT_MAX_PLAYLIST_TOTAL_MS = 5_460_000;

/**
 * `'pending'` counts. It is YouTube-only, set when the oEmbed pre-check failed
 * on the *network* rather than on the video (docs/06 §5): the video is probably
 * fine, and blocking Start on a flaky metadata lookup would be wrong.
 */
export function isPlayable(t: TtTrack): boolean {
  return t.status !== 'error';
}

export function isQueueValid(mode: TtMode, queue: readonly TtTrack[]): boolean {
  const playable = queue.filter(isPlayable);
  if (playable.length < 1) return false;
  // Single is exactly one, not "at most one" — two staged tracks would leave
  // the engine to pick, and docs/02 §4 resolves that by replacing on import.
  if (mode === 'single') return playable.length === 1;
  return playable.length <= TT_QUEUE_CAP[mode];
}

export function isReady(mode: TtMode, queue: readonly TtTrack[], countdownMs: number): boolean {
  return (
    isQueueValid(mode, queue) &&
    countdownMs >= TT_MIN_COUNTDOWN_MS &&
    countdownMs <= TT_MAX_COUNTDOWN_MS
  );
}

/**
 * Total playable duration, or **null when any of it is unknown**.
 *
 * Null rather than a partial sum, because a partial sum is a wrong number that
 * looks like a right one: it understates the queue while reading as
 * authoritative. Both callers turn null into a visible absence instead — the
 * docs/03 §2 totals footer renders `–` (hard invariant 5) and "Match queue
 * length" disables itself with its reason shown.
 *
 * S3 measured ~16% of a real library as having missing or unusable tags, so one
 * unknown duration in a 95-track queue is the common case, not an edge case.
 */
export function queueTotalMs(queue: readonly TtTrack[]): number | null {
  const playable = queue.filter(isPlayable);
  if (playable.length === 0) return null;
  if (playable.some((t) => t.durationMs === null || t.durationMs === undefined)) return null;
  return playable.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
}

/**
 * "Match queue length" — docs/03 §3.
 *
 * Disabled (null) on an empty queue or any unknown duration — which is also
 * what disables it in YouTube mode, where `durationMs` stays null until player
 * backfill.
 */
export function matchQueueLengthMs(queue: readonly TtTrack[]): number | null {
  const total = queueTotalMs(queue);
  if (total === null) return null;
  // Whole seconds, rounded UP: a countdown that ends a fraction before the last
  // track does is the one outcome nobody wants from a button called "match".
  const rounded = Math.ceil(total / 1000) * 1000;
  return Math.min(TT_MAX_COUNTDOWN_MS, Math.max(TT_MIN_COUNTDOWN_MS, rounded));
}
