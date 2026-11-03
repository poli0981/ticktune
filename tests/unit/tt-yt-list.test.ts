import { describe, expect, it } from 'vitest';
import { YT_LIST_ID, ytListCause, ytListUnreadable } from '../../src/lib/tt-yt-list';

/**
 * Playlist ids, shared by the Worker and the app — docs/06 §9 (v2.1).
 *
 * The Worker's validation and the app's parser import this one module, so the
 * two cannot drift into the client accepting what the edge refuses.
 */

describe('YT_LIST_ID', () => {
  it.each([
    ['a PL list, short form', 'PL0123456789ABCDEF'],
    ['a PL list, long form', 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'],
    ['a channel’s uploads', 'UUuAXFkgsw1L7xaCfnd5JJOw'],
    ['an album list', 'OLAK5uy_kAoQbD4bA9uv6-QXEj9dO5QK4hxvMZo4E'],
  ])('accepts %s', (_label, id) => {
    expect(YT_LIST_ID.test(id)).toBe(true);
  });

  it('never accepts an 11-character video id, so a bare line has one reading', () => {
    expect(YT_LIST_ID.test('dQw4w9WgXcQ')).toBe(false);
  });

  it.each([
    ['too short', 'PL123'],
    ['an illegal character', 'PL0123456789ABCD!F'],
    ['too long', `PL${'a'.repeat(63)}`],
  ])('refuses %s', (_label, id) => {
    expect(YT_LIST_ID.test(id)).toBe(false);
  });
});

describe('ytListUnreadable — what a key cannot read', () => {
  it('names the personal lists, which are private to their owner', () => {
    expect(ytListUnreadable('LL')).toBe('personal');
    expect(ytListUnreadable('WL')).toBe('personal');
    expect(ytListUnreadable('LM')).toBe('personal');
  });

  it('names a Mix, which YouTube generates per viewer', () => {
    expect(ytListUnreadable('RDdQw4w9WgXcQ')).toBe('mix');
    expect(ytListUnreadable('RDMMdQw4w9WgXcQ')).toBe('mix');
  });

  it('lets an ordinary list through', () => {
    expect(ytListUnreadable('PL0123456789ABCDEF')).toBeNull();
    expect(ytListUnreadable('UUuAXFkgsw1L7xaCfnd5JJOw')).toBeNull();
  });
});

describe('ytListCause — Google’s reason decides, never the status alone', () => {
  it('a missing list and a private one are properties of the LIST', () => {
    expect(ytListCause(404, 'playlistNotFound')).toBe('not_found');
    expect(ytListCause(404, null)).toBe('not_found');
    expect(ytListCause(403, 'playlistItemsNotAccessible')).toBe('private');
    expect(ytListCause(403, 'watchLaterNotAccessible')).toBe('private');
  });

  it('any other 400 is about the list too — one bad id must not cost the batch', () => {
    // Measured on the v2.1 preview: a regex-valid id Google refused with a
    // 400 took the other lists of its paste down with it.
    expect(ytListCause(400, 'playlistOperationUnsupported')).toBe('not_found');
    expect(ytListCause(400, 'invalidValue')).toBe('not_found');
    expect(ytListCause(400, null)).toBe('not_found');
  });

  it('🔴 a spent quota is a 403 too, and must never read as "private"', () => {
    expect(ytListCause(403, 'quotaExceeded')).toBe('refused');
    expect(ytListCause(403, 'forbidden')).toBe('refused');
    expect(ytListCause(400, 'keyInvalid')).toBe('refused');
    expect(ytListCause(403, null)).toBe('refused');
  });

  it('Google having a bad minute is transient', () => {
    expect(ytListCause(500, null)).toBe('upstream_unreachable');
    expect(ytListCause(503, 'backendError')).toBe('upstream_unreachable');
    expect(ytListCause(429, null)).toBe('upstream_unreachable');
    expect(ytListCause(403, 'rateLimitExceeded')).toBe('upstream_unreachable');
    expect(ytListCause(403, 'userRateLimitExceeded')).toBe('upstream_unreachable');
  });
});
