import { describe, expect, it } from 'vitest';
import {
  TT_QUEUE_CAP,
  isPlayable,
  isQueueValid,
  isReady,
  matchQueueLengthMs,
  modeSource,
} from '../../src/app/engine/importer/tt-queue-rules';
import type { TtTrack } from '../../src/app/engine/importer/types';

/** docs/02 §1 — the Start predicate — and docs/03 §3's Match queue length. */

const track = (over: Partial<TtTrack> = {}): TtTrack =>
  ({ source: 'local', status: 'ok', durationMs: 60_000, ...over }) as TtTrack;
const link = (over: Partial<TtTrack> = {}): TtTrack => track({ source: 'youtube', ...over });

describe('isPlayable', () => {
  it('counts pending, excludes error', () => {
    expect(isPlayable(track({ status: 'ok' }))).toBe(true);
    // YouTube-only: the oEmbed pre-check failed on the NETWORK, not the video.
    // Blocking Start on a flaky metadata lookup would be wrong (docs/02 §1).
    expect(isPlayable(track({ status: 'pending' }))).toBe(true);
    expect(isPlayable(track({ status: 'error' }))).toBe(false);
  });
});

describe('isQueueValid', () => {
  it('needs at least one playable track in every mode', () => {
    expect(isQueueValid('single', [])).toBe(false);
    expect(isQueueValid('playlist', [])).toBe(false);
    expect(isQueueValid('youtube', [])).toBe(false);
    expect(isQueueValid('single', [track({ status: 'error' })])).toBe(false);
  });

  it('requires EXACTLY one in Single mode', () => {
    expect(isQueueValid('single', [track()])).toBe(true);
    expect(isQueueValid('single', [track(), track()])).toBe(false);
  });

  it('caps playlist at 95 and youtube at 50', () => {
    expect(TT_QUEUE_CAP).toEqual({ single: 1, playlist: 95, youtube: 50 });
    const many = (n: number) => Array.from({ length: n }, () => track());
    expect(isQueueValid('playlist', many(95))).toBe(true);
    expect(isQueueValid('playlist', many(96))).toBe(false);
    const links = (n: number) => Array.from({ length: n }, () => link());
    expect(isQueueValid('youtube', links(50))).toBe(true);
    expect(isQueueValid('youtube', links(51))).toBe(false);
  });

  it('ignores error tracks when counting', () => {
    // Shown struck-through so the user can see why Start is disabled, but not
    // counted — and equally, not blocking an otherwise-valid queue.
    expect(isQueueValid('single', [track(), track({ status: 'error' })])).toBe(true);
  });
});

describe('sources do not mix — docs/02 §3.5, v2.0.1', () => {
  it('maps Single and Playlist to the local shelf, YouTube to the links', () => {
    expect(modeSource('single')).toBe('local');
    expect(modeSource('playlist')).toBe('local');
    expect(modeSource('youtube')).toBe('youtube');
  });

  it('never starts a queue holding the other source', () => {
    /*
     * v2.0.0 counted tracks and never looked at what they were: three files
     * passed the YouTube cap of 50, Start ran one on the YouTube player, and
     * nothing ever played. The session's shelves make that queue unreachable;
     * this is the second lock on the same door.
     */
    expect(isQueueValid('youtube', [track(), track(), track()])).toBe(false);
    expect(isQueueValid('playlist', [link()])).toBe(false);
    expect(isQueueValid('single', [link()])).toBe(false);
    expect(isQueueValid('playlist', [track(), link()])).toBe(false);
    expect(isQueueValid('youtube', [link(), track({ status: 'error' })])).toBe(false);
  });
});

describe('isReady', () => {
  it('is the queue AND the countdown bounds, inclusive', () => {
    const q = [track()];
    expect(isReady('single', q, 1_000)).toBe(true);
    expect(isReady('single', q, 999)).toBe(false);
    expect(isReady('single', q, 86_400_000)).toBe(true);
    expect(isReady('single', q, 86_400_001)).toBe(false);
    expect(isReady('single', [], 60_000)).toBe(false);
  });
});

describe('matchQueueLengthMs', () => {
  it('sums the queue and rounds up to a whole second', () => {
    expect(
      matchQueueLengthMs([track({ durationMs: 200_400 }), track({ durationMs: 100_100 })]),
    ).toBe(301_000);
  });

  it('is null on an empty queue — the button is disabled, not zero', () => {
    // A 0 ms result would violate the 1 s floor in docs/04 §4.
    expect(matchQueueLengthMs([])).toBeNull();
  });

  it('is null when ANY duration is unknown', () => {
    // YouTube leaves durationMs null until player backfill (docs/06 §5), which
    // is also what disables the button in that mode. Summing the known ones
    // would silently produce a countdown shorter than the queue.
    expect(matchQueueLengthMs([track(), track({ durationMs: null })])).toBeNull();
  });

  it('ignores error tracks', () => {
    expect(
      matchQueueLengthMs([
        track({ durationMs: 60_000 }),
        track({ status: 'error', durationMs: null }),
      ]),
    ).toBe(60_000);
  });

  it('clamps to the docs/04 §4 range', () => {
    expect(matchQueueLengthMs([track({ durationMs: 300 })])).toBe(1_000);
    const huge = Array.from({ length: 30 }, () => track({ durationMs: 3_600_000 }));
    expect(matchQueueLengthMs(huge)).toBe(86_400_000);
  });
});
