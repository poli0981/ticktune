import { describe, expect, it } from 'vitest';
import { ytCauseFromUpstream, ytCauseIsTransient } from '../../src/lib/tt-yt-cause';

/**
 * The oEmbed status → cause map — docs/06 §3.
 *
 * Every row here is a **measurement from spike S1**, not a reading of YouTube's
 * documentation, and the two disagree in at least one place. The test exists so
 * a future edit has to argue with the measurement rather than with a guess.
 */

describe('ytCauseFromUpstream — the S1 truth table', () => {
  it.each([
    [400, 'invalid_id', 'structurally impossible id — 11 chars, illegal final character'],
    [401, 'embed_off', 'embedding disabled by the owner'],
    [403, 'private', 'private or unlisted'],
    [404, 'not_found', 'well-formed id, no such video'],
  ])('maps %i → %s (%s)', (status, cause) => {
    expect(ytCauseFromUpstream(status)).toBe(cause);
  });

  it('does NOT collapse 401 into 404', () => {
    // The Worker rewrote 401→404 until P4, on the belief that both meant
    // "deleted or private". They are different things to tell a user, and
    // rewriting one into the other is unrecoverable downstream: the player
    // reports onError 150 for every cause, so this response is the only place
    // the reason survives.
    expect(ytCauseFromUpstream(401)).not.toBe(ytCauseFromUpstream(404));
  });

  it('keeps 400 and 404 apart', () => {
    // The distinction an earlier S1 note erased. Both its samples ended in a
    // character that cannot terminate a base64url id, so they were malformed
    // rather than missing — and the conclusion drawn from them ("a deleted
    // video is a 400") was about the wrong thing entirely.
    expect(ytCauseFromUpstream(400)).toBe('invalid_id');
    expect(ytCauseFromUpstream(404)).toBe('not_found');
  });

  it('falls back honestly on a status nobody has measured', () => {
    // `unavailable` says "it did not work and we do not know why", which is
    // true. Guessing a specific cause here would put a confident wrong sentence
    // in front of the user.
    for (const status of [402, 410, 418, 451, 500, 503]) {
      expect(ytCauseFromUpstream(status)).toBe('unavailable');
    }
  });

  it('every mapped cause is distinct, so the map cannot silently degenerate', () => {
    const mapped = [400, 401, 403, 404].map(ytCauseFromUpstream);
    expect(new Set(mapped).size).toBe(mapped.length);
  });
});

describe('ytCauseIsTransient — docs/06 §5', () => {
  it('only the network failure is worth retrying', () => {
    expect(ytCauseIsTransient('upstream_unreachable')).toBe(true);
  });

  it('everything else is a property of the video, so a re-check would fail alike', () => {
    for (const cause of [
      'invalid_id',
      'embed_off',
      'private',
      'not_found',
      'unavailable',
    ] as const) {
      expect(ytCauseIsTransient(cause)).toBe(false);
    }
  });
});
