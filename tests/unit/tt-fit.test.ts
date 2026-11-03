import { describe, expect, it } from 'vitest';
import type { TtTrack } from '../../src/app/engine/importer/types';
import { fitFollowMs, isFittedCountdown, unplayedMs } from '../../src/app/engine/queue/tt-fit';

/**
 * docs/02 §5.2 (v2.1) — a countdown fitted to its queue.
 *
 * The shell's wiring is E2E's (tests/e2e/wiring.spec.ts, "v2.1"); every
 * decision about WHICH amount and WHEN is here, where a case is one line.
 */

const track = (over: Partial<TtTrack> = {}): TtTrack =>
  ({ source: 'local', status: 'ok', durationMs: 60_000, ...over }) as TtTrack;

describe('fitFollowMs — the latch Match sets', () => {
  const fit = { mode: 'playlist', totalMs: 90_000 } as const;
  const now = { mode: 'playlist', totalMs: 60_000, repeat: false } as const;

  it('follows the total, both ways — fitted means "the queue\'s length"', () => {
    expect(fitFollowMs(fit, now)).toBe(60_000);
    expect(fitFollowMs(fit, { ...now, totalMs: 150_000 })).toBe(150_000);
  });

  it('does nothing without a latch — Match was never clicked, or a hand edit cleared it', () => {
    expect(fitFollowMs(null, now)).toBeNull();
  });

  it('leaves the frame alone with Repeat on', () => {
    expect(fitFollowMs(fit, { ...now, repeat: true })).toBeNull();
  });

  it('never leaps to another shelf’s total because the user switched tabs', () => {
    expect(fitFollowMs(fit, { ...now, mode: 'youtube' })).toBeNull();
  });

  it('never in Single mode, which always loops', () => {
    expect(fitFollowMs({ mode: 'single', totalMs: 90_000 }, { ...now, mode: 'single' })).toBeNull();
  });

  it('holds still on an unknown total — a link whose length is on its way — then resumes', () => {
    expect(fitFollowMs(fit, { ...now, totalMs: null })).toBeNull();
    // The latch still says 90 s, so the length landing is a change from it.
    expect(fitFollowMs(fit, { ...now, totalMs: 150_000 })).toBe(150_000);
  });

  it('does nothing when the total did not move', () => {
    expect(fitFollowMs(fit, { ...now, totalMs: 90_000 })).toBeNull();
  });
});

describe('isFittedCountdown — the run-side check at Start', () => {
  const queue = [track({ durationMs: 61_200 }), track({ durationMs: 30_000 })];

  it('is what Match writes — the total, rounded up to the second', () => {
    expect(isFittedCountdown(92_000, queue)).toBe(true);
    expect(isFittedCountdown(91_000, queue)).toBe(false);
    expect(isFittedCountdown(91_200, queue)).toBe(false);
  });

  it('is never fitted with a length unknown, an empty queue, or only errored rows', () => {
    expect(isFittedCountdown(60_000, [track({ durationMs: null })])).toBe(false);
    expect(isFittedCountdown(1_000, [])).toBe(false);
    expect(isFittedCountdown(60_000, [track({ status: 'error' })])).toBe(false);
  });

  it('ignores errored rows in the total, as Match does', () => {
    expect(isFittedCountdown(60_000, [track(), track({ status: 'error' })])).toBe(true);
  });

  it('is not fitted when the total is over the 24 h cap — Match clamped it', () => {
    const long = [track({ durationMs: 23 * 3_600_000 }), track({ durationMs: 2 * 3_600_000 })];
    expect(isFittedCountdown(24 * 3_600_000, long)).toBe(false);
  });
});

describe('unplayedMs — what a leaving track had left', () => {
  const order = ['a', 'b', 'c', 'd'];
  const base = { order, currentId: 'b', durationMs: 200_000, positionMs: 50_000, exhausted: false };

  it('a track after the cursor: all of it', () => {
    expect(unplayedMs({ ...base, removedId: 'c' })).toBe(200_000);
    expect(unplayedMs({ ...base, removedId: 'd' })).toBe(200_000);
  });

  it('the current track: only what the engine has not played yet', () => {
    expect(unplayedMs({ ...base, removedId: 'b' })).toBe(150_000);
    // A position past a stale length (VBR revision) leaves nothing, never less.
    expect(unplayedMs({ ...base, removedId: 'b', positionMs: 250_000 })).toBe(0);
  });

  it('the current track with no position yet — just loaded, so at 0', () => {
    expect(unplayedMs({ ...base, removedId: 'b', positionMs: null })).toBe(200_000);
  });

  it('a track before the cursor: nothing — it was heard', () => {
    expect(unplayedMs({ ...base, removedId: 'a' })).toBe(0);
  });

  it('nothing once the order is exhausted, whatever the stopped engine reports', () => {
    // `playback.stop()` resets the position to 0: the last track would count in full.
    expect(unplayedMs({ ...base, removedId: 'c', exhausted: true })).toBe(0);
    expect(unplayedMs({ ...base, removedId: 'b', positionMs: 0, exhausted: true })).toBe(0);
  });

  it('nothing for a track outside the order, or of unknown length', () => {
    expect(unplayedMs({ ...base, removedId: 'zz' })).toBe(0);
    expect(unplayedMs({ ...base, removedId: 'c', durationMs: null })).toBe(0);
    expect(unplayedMs({ ...base, removedId: 'c', durationMs: 0 })).toBe(0);
  });

  it('a cursor that outlived its track counts every track as ahead', () => {
    // nextInOrder restarts from the top in this state, so all of it will play.
    expect(unplayedMs({ ...base, currentId: 'gone', removedId: 'a' })).toBe(200_000);
    expect(unplayedMs({ ...base, currentId: null, removedId: 'a' })).toBe(200_000);
  });

  it('follows the PLAY order, not the display order — Shuffle on', () => {
    const shuffled = ['c', 'a', 'd', 'b'];
    expect(unplayedMs({ ...base, order: shuffled, currentId: 'a', removedId: 'c' })).toBe(0);
    expect(unplayedMs({ ...base, order: shuffled, currentId: 'a', removedId: 'b' })).toBe(200_000);
  });
});
