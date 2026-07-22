import { describe, expect, it } from 'vitest';
import {
  nextInOrder,
  pinFirst,
  prevInOrder,
  reconcile,
  shuffleIds,
  withoutImmediateRepeat,
  type TtRandom,
} from '../../src/app/engine/queue/tt-play-order';

/** Playback order — docs/02 §5 and the §5.1 rules decided before P3's UI. */

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `t${i}`);

/**
 * A scripted `rand`, so a shuffle test asserts the exact permutation instead of
 * asserting that something moved. Values are consumed in order and the sequence
 * is padded with 0 — a shuffle draws exactly `length` times.
 */
const scripted = (values: readonly number[]): TtRandom => {
  let i = 0;
  return () => values[i++] ?? 0;
};

describe('shuffleIds', () => {
  it('returns a permutation — nothing lost, nothing duplicated', () => {
    // The property that actually matters. A shuffle that drops a track is
    // indistinguishable from one that works, right up until a user notices a
    // song never plays.
    const input = ids(95); // the docs/02 §4 playlist cap, not a round number
    const out = shuffleIds(input, Math.random);
    expect(out).toHaveLength(95);
    expect([...out].sort()).toEqual([...input].sort());
  });

  it('draws exactly once per element', () => {
    let draws = 0;
    shuffleIds(ids(10), () => {
      draws += 1;
      return 0.5;
    });
    expect(draws).toBe(10);
  });

  it('produces the permutation the draws describe', () => {
    // Original "draw and strike out" form: each value picks an index into what
    // REMAINS, so 0 always takes the current head.
    expect(shuffleIds(['a', 'b', 'c'], scripted([0, 0, 0]))).toEqual(['a', 'b', 'c']);
    // 0.99 of 3 → index 2 ('c'), then 0.99 of 2 → index 1 ('b'), then 'a'.
    expect(shuffleIds(['a', 'b', 'c'], scripted([0.99, 0.99, 0]))).toEqual(['c', 'b', 'a']);
  });

  it('does not mutate its input', () => {
    const input = ids(5);
    shuffleIds(input, Math.random);
    expect(input).toEqual(ids(5));
  });

  it('handles the empty and single cases without drawing', () => {
    const never: TtRandom = () => {
      throw new Error('should not draw');
    };
    expect(shuffleIds([], never)).toEqual([]);
    expect(shuffleIds(['only'], scripted([0]))).toEqual(['only']);
  });
});

describe('withoutImmediateRepeat — docs/02 §5.1 rule 4', () => {
  it('swaps the first two when the wrap would repeat the track just played', () => {
    expect(withoutImmediateRepeat(['a', 'b', 'c'], 'a')).toEqual(['b', 'a', 'c']);
  });

  it('leaves an order alone when it does not start with that track', () => {
    expect(withoutImmediateRepeat(['b', 'a', 'c'], 'a')).toEqual(['b', 'a', 'c']);
  });

  it('is a no-op at length 1 — a one-track playlist repeating itself is correct', () => {
    // The boundary the rule is written around: there is no other track to swap
    // with, and refusing to play would be worse than repeating.
    expect(withoutImmediateRepeat(['a'], 'a')).toEqual(['a']);
  });

  it('swaps at length 2, the smallest case where the rule can act', () => {
    expect(withoutImmediateRepeat(['a', 'b'], 'a')).toEqual(['b', 'a']);
  });

  it('is a no-op when nothing has played yet', () => {
    expect(withoutImmediateRepeat(['a', 'b'], null)).toEqual(['a', 'b']);
  });

  it('still returns a permutation', () => {
    const out = withoutImmediateRepeat(ids(8), 't0');
    expect([...out].sort()).toEqual([...ids(8)].sort());
  });
});

describe('pinFirst — docs/02 §5.1 rule 2', () => {
  it('moves the current track to the front so a Shuffle toggle does not cut it off', () => {
    expect(pinFirst(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('preserves the relative order of everything else', () => {
    expect(pinFirst(['a', 'b', 'c', 'd'], 'c')).toEqual(['c', 'a', 'b', 'd']);
  });

  it('is a no-op for null or an id that is not there', () => {
    expect(pinFirst(['a', 'b'], null)).toEqual(['a', 'b']);
    expect(pinFirst(['a', 'b'], 'zz')).toEqual(['a', 'b']);
  });
});

describe('reconcile — docs/02 §5.1 rule 5', () => {
  it('drops ids that left the queue and keeps the rest in their shuffled places', () => {
    // 'a' stays ahead of 'b' because that is where the permutation put them —
    // reconcile must not quietly fall back to queue order.
    expect(reconcile(['c', 'b', 'a'], ['a', 'b'])).toEqual(['b', 'a']);
  });

  it('appends new ids at the end rather than reshuffling the unplayed remainder', () => {
    // The whole point of the rule: importing during a shuffled run must not
    // silently rewrite what the user is about to hear.
    expect(reconcile(['c', 'a', 'b'], ['a', 'b', 'c', 'd', 'e'])).toEqual([
      'c',
      'a',
      'b',
      'd',
      'e',
    ]);
  });

  it('is idempotent, so the store can call it after every mutation', () => {
    const once = reconcile(['c', 'a'], ['a', 'b', 'c']);
    expect(reconcile(once, ['a', 'b', 'c'])).toEqual(once);
  });

  it('survives random add/remove without losing or duplicating a track', () => {
    // Property test in the spirit of the URL-ledger one (docs/13 §1): the
    // invariant is "the order is always exactly the live set".
    let order = ids(12);
    const live = new Set(order);
    for (let step = 0; step < 200; step += 1) {
      const roll = (step * 7919) % 100; // deterministic, no seeded RNG needed
      if (roll < 50 && live.size > 1) {
        live.delete([...live][roll % live.size] ?? '');
      } else {
        live.add(`extra${step}`);
      }
      order = reconcile(order, [...live]);
      expect([...order].sort()).toEqual([...live].sort());
      expect(new Set(order).size).toBe(order.length);
    }
  });

  it('empties when the queue is cleared', () => {
    expect(reconcile(['a', 'b'], [])).toEqual([]);
  });
});

describe('nextInOrder', () => {
  it('advances one position', () => {
    expect(nextInOrder(['a', 'b', 'c'], 'a')).toBe('b');
  });

  it('returns null at the last track — the caller decides wrap vs TT-PLY-102', () => {
    // docs/02 §5.1 rule 6: this module holds no settings, so exhaustion is
    // reported rather than resolved.
    expect(nextInOrder(['a', 'b', 'c'], 'c')).toBeNull();
  });

  it('starts at the top when nothing is current', () => {
    expect(nextInOrder(['a', 'b'], null)).toBe('a');
  });

  it('starts at the top when the cursor outlived its track', () => {
    // Removed or errored out from under us. Null here would be read as
    // "playlist finished" and acted on, which is the wrong outcome.
    expect(nextInOrder(['a', 'b'], 'gone')).toBe('a');
  });

  it('returns null on an empty order', () => {
    expect(nextInOrder([], 'a')).toBeNull();
  });
});

describe('prevInOrder', () => {
  it('steps back one position', () => {
    expect(prevInOrder(['a', 'b', 'c'], 'b')).toBe('a');
  });

  it('returns null at the first track — ⏮ does not wrap to the end', () => {
    expect(prevInOrder(['a', 'b', 'c'], 'a')).toBeNull();
  });

  it('returns null for null or an unknown id', () => {
    expect(prevInOrder(['a', 'b'], null)).toBeNull();
    expect(prevInOrder(['a', 'b'], 'gone')).toBeNull();
  });
});
