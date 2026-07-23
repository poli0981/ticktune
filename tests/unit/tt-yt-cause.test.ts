import { describe, expect, it } from 'vitest';
import {
  ytCauseFromResponse,
  ytCauseFromUpstream,
  ytCauseIsTransient,
} from '../../src/lib/tt-yt-cause';

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

  it('falls back honestly on a 4xx nobody has measured', () => {
    // `unavailable` says "it did not work and we do not know why", which is
    // true. Guessing a specific cause here would put a confident wrong sentence
    // in front of the user.
    for (const status of [402, 410, 418, 451]) {
      expect(ytCauseFromUpstream(status)).toBe('unavailable');
    }
  });

  it('treats every 5xx as the SERVER failing, never the video', () => {
    // These used to land in `unavailable`, which is non-transient — so a
    // YouTube outage did not fail an import, it rejected every pasted link
    // outright, and the Worker then cached that verdict for fifteen minutes.
    for (const status of [500, 502, 503, 504]) {
      expect(ytCauseFromUpstream(status)).toBe('upstream_unreachable');
      expect(ytCauseIsTransient(ytCauseFromUpstream(status))).toBe(true);
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

describe('ytCauseFromResponse — a status is only a cause if it is OURS', () => {
  const JSONH = 'application/json; charset=utf-8';

  it.each([
    [400, 'invalid_id'],
    [401, 'embed_off'],
    [403, 'private'],
    [404, 'not_found'],
    [429, 'rate_limited'],
  ] as const)('reads %i from our own JSON as %s', (status, cause) => {
    expect(ytCauseFromResponse(status, JSONH)).toBe(cause);
  });

  it('treats our 502 as transient, not as a property of the video', () => {
    // The Worker emits it when the EDGE could not reach oEmbed.
    expect(ytCauseFromResponse(502, JSONH)).toBe('upstream_unreachable');
    expect(ytCauseIsTransient(ytCauseFromResponse(502, JSONH))).toBe(true);
  });

  it('treats an upstream 5xx the same way, JSON or not', () => {
    // A 503 our Worker forwarded and a 503 from something in between are the
    // same fact to the user: the server failed. Neither is the owner's doing.
    for (const ct of [JSONH, 'text/html', null]) {
      expect(ytCauseIsTransient(ytCauseFromResponse(503, ct))).toBe(true);
    }
  });

  it('never blames the video when something else answered', () => {
    // The bug this pins, found by using the app: under `astro preview` the
    // Worker does not run, `/api/yt/oembed` fell through to the static 404
    // page, and three known-good videos were reported as deleted.
    for (const ct of ['text/html', 'text/html; charset=utf-8', 'text/plain', null]) {
      const cause = ytCauseFromResponse(404, ct);
      expect(cause).toBe('upstream_unreachable');
      expect(cause).not.toBe('not_found');
      // Transient, so the track survives as `pending` rather than being
      // rejected for a reason we invented.
      expect(ytCauseIsTransient(cause)).toBe(true);
    }
  });

  it('still recognises a rate limit even as an HTML block page', () => {
    // Cloudflare's own block page is HTML and carries no CORS header, but the
    // status is unambiguous and "slow down" is more useful than "network down".
    expect(ytCauseFromResponse(429, 'text/html')).toBe('rate_limited');
  });

  it('does not mistake a non-JSON 401 or 403 for a video property', () => {
    // A proxy or SSO wall answering 401 must not read as "embedding disabled".
    expect(ytCauseFromResponse(401, 'text/html')).toBe('upstream_unreachable');
    expect(ytCauseFromResponse(403, 'text/html')).toBe('upstream_unreachable');
  });
});
