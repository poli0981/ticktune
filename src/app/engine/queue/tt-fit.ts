import type { TtMode } from '../../../lib/tt-domain-types';
import { matchQueueLengthMs, queueTotalMs } from '../importer/tt-queue-rules';
import type { TtTrack } from '../importer/types';
import { TT_MAX_COUNTDOWN_MS } from '../timer/tt-format';

/**
 * A countdown fitted to its queue — docs/02 §5.2 (v2.1).
 *
 * The owner's rule: with Repeat off, a countdown set to the queue's length
 * follows the queue when a track leaves it; with Repeat on the countdown keeps
 * its frame and the queue plays inside it.
 *
 * Fitted is a LATCH that "Khớp độ dài" sets and any hand edit clears — no new
 * toggle. Not a comparison of values: a number the user typed that happens to
 * equal the total is theirs, and docs/03 §3's reason for one-shot is exactly
 * that a hand edit is never overwritten. Pure, so every case below is a unit
 * test rather than an E2E timing.
 */

/** What Match set: the mode it was clicked in, and the total it wrote. */
export interface TtFit {
  mode: TtMode;
  totalMs: number;
}

/**
 * The countdown a latched fit should now show, or null to leave it alone.
 *
 * Follows while the latch belongs to this mode — switching tabs shows another
 * shelf (docs/02 §3.5), and a countdown matched to the files must not leap to
 * the links' total because the user looked at them — and Repeat is off. An
 * unknown total (a link whose length is still on its way) changes nothing, so
 * the follow resumes when the length lands.
 */
export function fitFollowMs(
  fit: TtFit | null,
  now: { mode: TtMode; totalMs: number | null; repeat: boolean },
): number | null {
  if (fit === null || fit.mode !== now.mode || now.mode === 'single' || now.repeat) return null;
  if (now.totalMs === null || now.totalMs === fit.totalMs) return null;
  return now.totalMs;
}

/**
 * Is `countdownMs` this queue's own length — the run-side half of the check,
 * made at Start beside the latch?
 *
 * A total over the 24 h cap is not: Match clamps it, and a clamped countdown
 * is the cap's length, not the queue's — shortening it by a removed track
 * would cut into music the countdown never covered.
 */
export function isFittedCountdown(countdownMs: number, queue: readonly TtTrack[]): boolean {
  const total = queueTotalMs(queue);
  if (total === null || total > TT_MAX_COUNTDOWN_MS) return false;
  return countdownMs === matchQueueLengthMs(queue);
}

/**
 * How much of `removedId` the run still had to play — docs/02 §5.2.
 *
 * Asked BEFORE the store drops the track: afterwards it is not in the order,
 * and "after the cursor" has no answer.
 *
 * - after the cursor in the play order → its whole length;
 * - the current track → its length minus where the engine is;
 * - before the cursor, not in the order (errored, or never playable), or any
 *   track once the order is exhausted → nothing; it was played, or never was
 *   going to be. Exhaustion is checked first because `playback.stop()` resets
 *   the position to 0, which would otherwise count a finished track in full.
 *
 * A cursor that is not in the order — it outlived its track — counts every
 * track as ahead, which is what `nextInOrder` does with it too.
 *
 * @param positionMs the engine's position in the current track; null when the
 *   engine has not reported one yet, which only happens just after a load —
 *   at 0, so 0 is the honest reading.
 */
export function unplayedMs(args: {
  order: readonly string[];
  currentId: string | null;
  removedId: string;
  durationMs: number | null;
  positionMs: number | null;
  exhausted: boolean;
}): number {
  const { order, currentId, removedId, durationMs, positionMs, exhausted } = args;
  if (exhausted || durationMs === null || !(durationMs > 0)) return 0;
  const at = order.indexOf(removedId);
  if (at < 0) return 0;
  if (removedId === currentId) return Math.max(0, durationMs - Math.max(0, positionMs ?? 0));
  const cursor = currentId === null ? -1 : order.indexOf(currentId);
  return at > cursor ? durationMs : 0;
}
