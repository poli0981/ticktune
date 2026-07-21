import { describe, expect, it } from 'vitest';
import {
  hasReplacementChar,
  isTagUnreliable,
  mapTags,
  titleFromFileName,
} from '../../src/app/engine/importer/tt-metadata';
import type { TtRawTags } from '../../src/app/engine/importer/types';

/**
 * docs/05 §5 — including the rule that spike S3 falsified and replaced.
 *
 * The Vietnamese string below is the one S3 actually measured through an ID3v1
 * tag; it comes back as `N¯ng ¥m xa d§n` with ZERO replacement characters,
 * which is why the original U+FFFD rule never fired.
 */
const VI_TITLE = 'Nắng ấm xa dần — Đường về nhà';
const VI_MOJIBAKE = 'N¯ng ¥m xa d§n  °Ýng vÁ nhà';

const tags = (over: Partial<TtRawTags> = {}): TtRawTags => ({ tagTypes: ['ID3v2.3'], ...over });

describe('isTagUnreliable — the S3 replacement rule', () => {
  it('flags ID3v1-only with non-ASCII', () => {
    // The measured case. No U+FFFD anywhere in it.
    expect(VI_MOJIBAKE.includes('�')).toBe(false);
    expect(isTagUnreliable(['ID3v1'], VI_MOJIBAKE, 'Nguy?n')).toBe(true);
  });

  it('KEEPS pure-ASCII ID3v1 — discarding it would be the regression', () => {
    // Most Western files are exactly this. docs/05 §5 is explicit that only the
    // non-ASCII case is unrecoverable.
    expect(isTagUnreliable(['ID3v1'], 'Bohemian Rhapsody', 'Queen')).toBe(false);
  });

  it('trusts a tag whenever ANY non-v1 container is present', () => {
    // The ffmpeg fixture caveat: the mp3 muxer writes an empty ID3v2 tag unless
    // told not to, which made S3's first "v1-only" fixture report both.
    expect(isTagUnreliable(['ID3v2.4', 'ID3v1'], VI_TITLE, 'x')).toBe(false);
    // Containers S3 found in the wild that this chapter had never mentioned.
    expect(isTagUnreliable(['ID3v2.2'], VI_TITLE, 'x')).toBe(false);
    expect(isTagUnreliable(['ID3v2.3', 'APEv2', 'ID3v1'], VI_TITLE, 'x')).toBe(false);
  });

  it('does not flag a file with no tags at all', () => {
    // 14 of S3's 103 files. They take the file-name path, not the mojibake one.
    expect(isTagUnreliable([], VI_TITLE, 'x')).toBe(false);
  });
});

describe('hasReplacementChar — kept, for a different failure', () => {
  it('still catches broken UTF-8 in a v2 frame', () => {
    expect(hasReplacementChar('Nắng � dần')).toBe(true);
    expect(hasReplacementChar(VI_TITLE)).toBe(false);
    expect(hasReplacementChar(null)).toBe(false);
  });
});

describe('titleFromFileName', () => {
  it('strips only the extension', () => {
    expect(titleFromFileName('01 - Nắng ấm xa dần.mp3')).toBe('01 - Nắng ấm xa dần');
    expect(titleFromFileName('no-extension')).toBe('no-extension');
    expect(titleFromFileName('.hidden')).toBe('.hidden');
  });
});

describe('mapTags', () => {
  it('maps a healthy v2 tag through unchanged', () => {
    const m = mapTags(
      tags({
        title: VI_TITLE,
        artist: 'Nguyễn Thị Ánh Tuyết',
        album: 'Đêm',
        year: 2019,
        trackNo: 3,
        durationMs: 245_000,
        codec: 'MPEG 1 Layer 3',
        bitrateKbps: 320,
        sampleRateHz: 44_100,
        channels: 2,
      }),
      'whatever.mp3',
    );

    expect(m.title).toBe(VI_TITLE);
    expect(m.artist).toBe('Nguyễn Thị Ánh Tuyết');
    expect(m.year).toBe('2019');
    expect(m.trackNo).toBe('3');
    expect(m.bitrateKbps).toBe(320);
    expect(m.note).toBeUndefined();
  });

  it('falls back to the file name and notes TT-IMP-007 on an unreliable tag', () => {
    const m = mapTags(
      tags({ tagTypes: ['ID3v1'], title: VI_MOJIBAKE, artist: 'Nguy?n' }),
      'Nắng ấm xa dần.mp3',
    );

    expect(m.title).toBe('Nắng ấm xa dần');
    expect(m.artist).toBe('');
    expect(m.note).toBe('TT-IMP-007');
  });

  it('keeps stream facts even when the TEXT is unreliable', () => {
    // Bitrate and duration come from the stream, not from a charset-less tag.
    // Dropping them too would lose good data over a text-encoding problem.
    const m = mapTags(
      tags({
        tagTypes: ['ID3v1'],
        title: VI_MOJIBAKE,
        durationMs: 245_000,
        bitrateKbps: 320,
        codec: 'MPEG 1 Layer 3',
      }),
      'x.mp3',
    );

    expect(m.note).toBe('TT-IMP-007');
    expect(m.durationMs).toBe(245_000);
    expect(m.bitrateKbps).toBe(320);
    expect(m.codec).toBe('MPEG 1 Layer 3');
  });

  it('notes TT-IMP-006 and still produces a track when the parse failed', () => {
    // docs/02 §4: parse failure is NOT import failure.
    const m = mapTags(null, 'Track 4.flac');
    expect(m.title).toBe('Track 4');
    expect(m.note).toBe('TT-IMP-006');
  });

  it('falls back on a v2 frame containing U+FFFD', () => {
    const m = mapTags(tags({ title: 'Broken � title' }), 'Real Name.mp3');
    expect(m.title).toBe('Real Name');
    expect(m.note).toBe('TT-IMP-007');
  });

  it('treats an empty or whitespace tag as absent', () => {
    // 17 of S3's 103 files have no title. This is the common path.
    const m = mapTags(tags({ title: '   ', artist: '' }), 'Fallback.mp3');
    expect(m.title).toBe('Fallback');
    expect(m.artist).toBe('');
    expect(m.note).toBeUndefined();
  });

  it('omits absent optional fields rather than setting them undefined', () => {
    // exactOptionalPropertyTypes (docs/12 §2) — and the display layer's
    // fallback rule keys on absence.
    const m = mapTags(tags({ title: 'T' }), 'x.mp3');
    expect('album' in m).toBe(false);
    expect('bitrateKbps' in m).toBe(false);
  });

  it('ignores non-positive numeric fields', () => {
    const m = mapTags(tags({ title: 'T', durationMs: 0, bitrateKbps: -1, channels: 0 }), 'x.mp3');
    expect('durationMs' in m).toBe(false);
    expect('bitrateKbps' in m).toBe(false);
    expect('channels' in m).toBe(false);
  });

  it('uses the container when no codec is reported', () => {
    const m = mapTags(tags({ title: 'T', container: 'FLAC' }), 'x.flac');
    expect(m.codec).toBe('FLAC');
  });
});
