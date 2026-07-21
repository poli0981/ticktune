import { describe, expect, it } from 'vitest';
import {
  TT_ACCEPT_ATTR,
  TT_ACCEPT_EXT,
  extOf,
  isAccepted,
  mimeForExt,
} from '../../src/app/engine/importer/tt-accept';

/** docs/02 §4 step 1 × docs/05 §4's browser matrix. */

/** A browser that supports everything — Chromium/Firefox shaped. */
const permissive = () => 'probably';
/** Safari-shaped: no Ogg family. docs/05 §4 marks those ⚠️ for exactly this. */
const safariish = (mime: string) => (mime.startsWith('audio/ogg') ? '' : 'maybe');

describe('extOf', () => {
  it('lower-cases and keeps the dot', () => {
    expect(extOf('Song.MP3')).toBe('.mp3');
    expect(extOf('a.b.FLAC')).toBe('.flac');
  });

  it('treats a dotfile as having no extension', () => {
    // ".flac" is a hidden file called ".flac", not a FLAC file with no name.
    expect(extOf('.flac')).toBe('');
    expect(extOf('noextension')).toBe('');
  });
});

describe('the allow-list', () => {
  it('matches docs/02 §4 exactly', () => {
    expect([...TT_ACCEPT_EXT]).toEqual([
      '.mp3',
      '.m4a',
      '.aac',
      '.flac',
      '.wav',
      '.ogg',
      '.oga',
      '.opus',
      '.webm',
    ]);
  });

  it('derives the picker attribute from the same list', () => {
    // If these two ever disagree, the picker hides files the validator accepts
    // (or worse, the reverse) and nothing else would notice.
    expect(TT_ACCEPT_ATTR).toBe(TT_ACCEPT_EXT.join(','));
    for (const ext of TT_ACCEPT_EXT) expect(TT_ACCEPT_ATTR).toContain(ext);
  });

  it('maps every allowed extension to a MIME to probe', () => {
    for (const ext of TT_ACCEPT_EXT) expect(mimeForExt(ext)).toBeTruthy();
  });

  it('asks about the opus CODEC, not just the ogg container', () => {
    // A browser can support Vorbis-in-Ogg and not Opus; probing bare audio/ogg
    // would answer the wrong question (docs/05 §4).
    expect(mimeForExt('.opus')).toContain('codecs=opus');
  });
});

describe('isAccepted', () => {
  it('accepts every allow-list extension on a permissive browser', () => {
    for (const ext of TT_ACCEPT_EXT) expect(isAccepted(`track${ext}`, permissive)).toBe(true);
  });

  it('rejects containers outside the list', () => {
    // The three the local corpus supplies for free (docs/15 §S3).
    for (const name of ['x.aiff', 'x.alac', 'x.ac3', 'x.txt', 'noext']) {
      expect(isAccepted(name, permissive)).toBe(false);
    }
  });

  it('rejects an allowed extension the browser cannot play', () => {
    // The honest TT-IMP-001 docs/05 §4 promises Safari users, instead of a
    // track that imports and then refuses to play.
    expect(isAccepted('track.oga', safariish)).toBe(false);
    expect(isAccepted('track.opus', safariish)).toBe(false);
    expect(isAccepted('track.mp3', safariish)).toBe(true);
  });

  it('treats "maybe" as a yes', () => {
    expect(isAccepted('track.mp3', () => 'maybe')).toBe(true);
    expect(isAccepted('track.mp3', () => '')).toBe(false);
  });
});
