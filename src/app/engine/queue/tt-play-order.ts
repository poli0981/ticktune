/**
 * Playback order — docs/02 §5 and §5.1.
 *
 * Pure, and deliberately stateless: every function takes the order it should
 * operate on and returns a new one. The cursor, the queue and the shuffle flag
 * all live in `session.svelte.ts`; what lives here is only the set of decisions
 * §5.1 had to settle before any UI could be written.
 *
 * The one idea the whole module rests on: **display order and playback order are
 * different things, and the cursor names a track id rather than a position.**
 * With Shuffle off there is no permutation at all — playback order *is* the
 * queue array, so a drag changes what plays next for free. With Shuffle on the
 * permutation is stored, and a drag leaves it alone. Both of §5.1's awkward
 * cases — "does a drag remap the cycle" and "does the now-playing track stay
 * current" — stop being cases at all once the cursor is an id.
 *
 * No `types.ts` beside this file: the convention in docs/12 §2 exists so an
 * engine's consumers have one import site, and this engine is one module.
 */

/**
 * Randomness, injected — so a shuffle test asserts the permutation rather than
 * asserting that something changed. `Math.random` is passed in by the store.
 */
export type TtRandom = () => number;

/**
 * Fisher–Yates, in its original "draw and strike out" form rather than the
 * in-place swap variant.
 *
 * Same uniform distribution, and it avoids indexed reads entirely — under
 * `noUncheckedIndexedAccess` the swap form needs two non-null assertions per
 * iteration to say something the loop bounds already guarantee. `splice`
 * returns an array, so the types stay honest. At n ≤ 95 (docs/02 §4) the
 * quadratic cost is not worth a single `!`.
 */
export function shuffleIds(ids: readonly string[], rand: TtRandom): string[] {
  const pool = [...ids];
  const out: string[] = [];
  while (pool.length > 0) {
    out.push(...pool.splice(Math.floor(rand() * pool.length), 1));
  }
  return out;
}

/**
 * docs/02 §5's "no immediate repeat", made precise enough to test — docs/02
 * §5.1 rule 4.
 *
 * A fresh permutation on a wrap can legitimately start with the track that just
 * finished, and hearing the same song twice across a wrap is the one artifact
 * shuffle exists to avoid. Swapping the first two entries fixes it in one move
 * and keeps the result a permutation.
 *
 * At `length === 1` this is a no-op **by design**: a one-track playlist
 * repeating itself is the correct behaviour, not a defect to engineer around.
 */
export function withoutImmediateRepeat(ids: readonly string[], lastId: string | null): string[] {
  const out = [...ids];
  const [first, second] = out;
  if (lastId === null || out.length < 2 || first !== lastId || second === undefined) return out;
  out[0] = second;
  out[1] = lastId;
  return out;
}

/**
 * Move `id` to the front — docs/02 §5.1 rule 2.
 *
 * Used when Shuffle is switched ON mid-run: the new permutation is generated
 * over every playable track, then the track already playing is pinned first so
 * it stays current. Without this the toggle would cut off whatever is playing,
 * which reads as a bug rather than as a shuffle.
 */
export function pinFirst(ids: readonly string[], id: string | null): string[] {
  if (id === null || !ids.includes(id)) return [...ids];
  return [id, ...ids.filter((x) => x !== id)];
}

/**
 * Bring a stored permutation back in step with the live queue — docs/02 §5.1
 * rule 5.
 *
 * Reconcile, never regenerate. Importing five tracks into a shuffled playlist
 * must not reshuffle the part the user has not heard yet: that would silently
 * rewrite the future of a run in progress, and the user has no way to see it
 * happen. Dropped ids leave, new ids land at the end, everything else keeps its
 * position.
 *
 * Idempotent, which is what lets the store call it after every mutation without
 * tracking whether it already has.
 */
export function reconcile(order: readonly string[], liveIds: readonly string[]): string[] {
  const live = new Set(liveIds);
  const kept = order.filter((id) => live.has(id));
  const known = new Set(kept);
  return [...kept, ...liveIds.filter((id) => !known.has(id))];
}

/**
 * The next track, or null when the order is exhausted.
 *
 * Null is the caller's cue to either wrap (Repeat ON) or stop with TT-PLY-102
 * (Repeat OFF, docs/02 §5.1 rule 6) — this function does not know which,
 * because that is a settings question and this module holds no state.
 *
 * A `currentId` that is not in the order means the cursor outlived its track —
 * it was removed, or errored out from under us. Starting from the top is the
 * only defined move, and it is better than returning null, which the caller
 * would read as "playlist finished" and act on.
 */
export function nextInOrder(order: readonly string[], currentId: string | null): string | null {
  if (order.length === 0) return null;
  const i = currentId === null ? -1 : order.indexOf(currentId);
  if (i < 0) return order[0] ?? null;
  return order[i + 1] ?? null;
}

/**
 * The previous track, or null at the first one.
 *
 * Deliberately does **not** wrap to the end. ⏮ on the first track becomes an
 * inert, visibly disabled control (docs/03 §2 Z7) rather than a jump to the
 * far end of a 95-track queue, which is never what the press meant.
 */
export function prevInOrder(order: readonly string[], currentId: string | null): string | null {
  if (currentId === null) return null;
  const i = order.indexOf(currentId);
  return i > 0 ? (order[i - 1] ?? null) : null;
}
