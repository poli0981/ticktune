import { describe, expect, it } from 'vitest';
import {
  TT_DASH,
  TT_NA,
  bitrateText,
  bytesText,
  num,
  positionText,
  text,
  trackInfoRows,
} from '../../src/app/engine/importer/tt-track-display';
import type { TtTrack } from '../../src/app/engine/importer/types';

/** docs/02 §2's fallback rule, §8's modal, and docs/03 §2 Z7's position. */

describe('the fallback rule', () => {
  it('uses N/A for missing text and – for missing numbers', () => {
    expect(TT_NA).toBe('N/A');
    expect(TT_DASH).toBe('–'); // en dash, not a hyphen
    expect(text(undefined)).toBe(TT_NA);
    expect(text(null)).toBe(TT_NA);
    expect(text('  ')).toBe(TT_NA);
    expect(num(undefined)).toBe(TT_DASH);
    expect(num(Number.NaN)).toBe(TT_DASH);
  });

  it('treats 0 and "0" as values, not absences', () => {
    // The reason these are functions rather than `v || fallback` inline.
    expect(num(0)).toBe('0');
    expect(text('0')).toBe('0');
  });

  it('never renders undefined or an empty string', () => {
    for (const v of [undefined, null, '', '   ']) expect(text(v)).toBe(TT_NA);
  });

  it('appends a unit only when given one', () => {
    expect(num(44_100, 'Hz')).toBe('44100 Hz');
    expect(num(2)).toBe('2');
  });
});

describe('positionText', () => {
  it('does not zero-pad minutes', () => {
    // docs/03 §2 — this is a media position, NOT a countdown format. The old
    // diagram read 03:12 and contradicted its own rule.
    expect(positionText(192_000)).toBe('3:12');
    expect(positionText(0)).toBe('0:00');
    expect(positionText(9_000)).toBe('0:09');
  });

  it('widens on its own past ten minutes', () => {
    expect(positionText(600_000)).toBe('10:00');
    expect(positionText(3_723_000)).toBe('62:03');
  });

  it('falls back for unknown or negative', () => {
    expect(positionText(null)).toBe(TT_DASH);
    expect(positionText(-1)).toBe(TT_DASH);
  });
});

describe('bytesText / bitrateText', () => {
  it('scales bytes readably', () => {
    expect(bytesText(512)).toBe('512 B');
    expect(bytesText(2_048)).toBe('2 KB');
    expect(bytesText(7_612_416)).toBe('7.3 MB'); // S3's largest embedded cover
    expect(bytesText(null)).toBe(TT_DASH);
  });

  it('rounds bitrate', () => {
    expect(bitrateText(320)).toBe('320 kbps');
    expect(bitrateText(191.6)).toBe('192 kbps');
    expect(bitrateText(undefined)).toBe(TT_DASH);
  });
});

describe('trackInfoRows — docs/02 §8', () => {
  const local: TtTrack = {
    id: 'x',
    source: 'local',
    status: 'ok',
    title: 'Nắng ấm xa dần',
    artist: 'Nguyễn Thị Ánh Tuyết',
    durationMs: 192_000,
    fileName: 'song.mp3',
    fileSizeBytes: 4_096,
    addedAt: Date.UTC(2026, 6, 21, 7, 32),
  };

  it('lists every documented field for a local track', () => {
    const labels = trackInfoRows(local).map((r) => r.label);
    for (const expected of [
      'Tiêu đề',
      'Nghệ sĩ',
      'Album',
      'Năm',
      'Thể loại',
      'Số thứ tự',
      'Thời lượng',
      'Codec',
      'Bitrate',
      'Tần số lấy mẫu',
      'Số kênh',
      'Kích thước',
      'Tên tệp',
      'Nguồn',
      'Đã thêm lúc',
      'Ảnh bìa',
    ]) {
      expect(labels).toContain(expected);
    }
  });

  it('applies the fallback rule to every missing field', () => {
    const rows = trackInfoRows(local);
    // Untagged file: album/year/genre/track#/codec/bitrate are all absent.
    expect(rows.find((r) => r.label === 'Album')?.value).toBe(TT_NA);
    expect(rows.find((r) => r.label === 'Bitrate')?.value).toBe(TT_DASH);
    expect(rows.find((r) => r.label === 'Số kênh')?.value).toBe(TT_DASH);
    // And nothing anywhere renders as undefined or blank.
    for (const r of rows) expect(r.value.trim()).not.toBe('');
  });

  it('swaps in the YouTube fields for a YouTube track', () => {
    const yt: TtTrack = {
      ...local,
      source: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
      durationMs: null,
    };
    const labels = trackInfoRows(yt).map((r) => r.label);

    expect(labels).toContain('Video ID');
    expect(labels).toContain('URL');
    expect(labels).not.toContain('Tên tệp');
    // Unknown duration renders as the numeric fallback, per docs/06 §5.
    expect(trackInfoRows(yt).find((r) => r.label === 'Thời lượng')?.value).toBe(TT_DASH);
  });
});
