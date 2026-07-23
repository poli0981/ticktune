import type { TtTrack } from './types';

/**
 * The `N/A` / `–` fallback rule and the media-position format — docs/02 §2, §8
 * and docs/03 §2 Z7.
 *
 * One module so the rule is applied identically everywhere. It is stated as a
 * spec requirement precisely because the failure mode — rendering `undefined`,
 * or an empty gap where a value should be — is invisible in the happy path and
 * shows up only on the files that lack tags. S3 measured that as ~16% of a real
 * library, so this is the common path, not an edge case.
 */

/** Missing TEXT. Not translated — universal per docs/08 §3. */
export const TT_NA = 'N/A';
/** Missing NUMBER or duration. An en dash, not a hyphen. */
export const TT_DASH = '–';

export function text(v: string | null | undefined): string {
  // A tag can legitimately be an empty string; that is still "missing" to a
  // reader, so it takes the fallback rather than rendering as blank.
  return v === null || v === undefined || v.trim() === '' ? TT_NA : v;
}

export function num(v: number | null | undefined, unit = ''): string {
  // 0 is a value, not an absence — `v || TT_DASH` would be wrong here, and is
  // the reason this is a function rather than an inline expression.
  if (v === null || v === undefined || !Number.isFinite(v)) return TT_DASH;
  return unit ? `${v} ${unit}` : String(v);
}

/**
 * Media position — `M:SS`, widening to `MM:SS` on its own past ten minutes.
 *
 * Minutes are NOT zero-padded; only seconds are. That is the whole rule, and it
 * is why the docs/03 §2 diagram's old `03:12` was wrong — it padded a 3-minute
 * position as if this were a countdown. It is not: docs/04 §4 is the single
 * source of truth for countdown formats and nothing here restates them.
 */
export function positionText(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return TT_DASH;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? `0${s}` : s}`;
}

export function bytesText(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return TT_DASH;
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function bitrateText(kbps: number | null | undefined): string {
  return kbps === null || kbps === undefined || !Number.isFinite(kbps)
    ? TT_DASH
    : `${Math.round(kbps)} kbps`;
}

export interface TtInfoRow {
  /**
   * An i18n key stem under `player.trackinfo.*`, NOT a label.
   *
   * This module is pure and lives under `engine/**`, where docs/12 §3.1 forbids
   * importing from state at all — so it cannot call `i18n.t` and must not try.
   * Returning the key and letting the component translate is the same shape
   * `TtYtOverlayState.key` already uses for the YouTube overlays, and it keeps
   * the field ORDER (which is docs/02 §8's actual contract) here, where the
   * unit tests can see it, rather than in markup.
   */
  labelKey: string;
  value: string;
}

/**
 * Every field docs/02 §8 lists, in that order, already run through the fallback
 * rule — so the modal renders rows rather than deciding anything.
 *
 * Labels are hardcoded Vietnamese for P2; the keys are filed under
 * `player.trackinfo.*` in docs/08 §3.1 for P5.
 */
export function trackInfoRows(t: TtTrack, locale: string): TtInfoRow[] {
  const rows: TtInfoRow[] = [
    { labelKey: 'title', value: text(t.title) },
    { labelKey: 'artist', value: text(t.artist) },
    { labelKey: 'album', value: text(t.album) },
    { labelKey: 'year', value: text(t.year) },
    { labelKey: 'genre', value: text(t.genre) },
    { labelKey: 'trackNo', value: text(t.trackNo) },
    { labelKey: 'duration', value: positionText(t.durationMs) },
  ];

  if (t.source === 'local') {
    rows.push(
      { labelKey: 'codec', value: text(t.codec) },
      { labelKey: 'bitrate', value: bitrateText(t.bitrateKbps) },
      { labelKey: 'sampleRate', value: num(t.sampleRateHz, 'Hz') },
      { labelKey: 'channels', value: num(t.channels) },
      { labelKey: 'fileSize', value: bytesText(t.fileSizeBytes) },
      { labelKey: 'fileName', value: text(t.fileName) },
    );
  } else {
    rows.push(
      { labelKey: 'channel', value: text(t.artist) },
      { labelKey: 'videoId', value: text(t.videoId) },
      { labelKey: 'url', value: text(t.sourceUrl) },
      // docs/02 §8 has listed Thumbnail since the first revision and nothing
      // rendered it — the same declared-but-never-shown shape as coverArtUrl.
      { labelKey: 'thumbnail', value: text(t.thumbnailUrl) },
      { labelKey: 'status', value: text(t.status) },
    );
  }

  rows.push(
    // `source` and `coverArt` carry a VALUE that needs translating too, not just
    // a label — so they take a key on both sides. docs/08 §3.1's "one key per
    // 02 §8 field" did not anticipate that; the extra three are filed there now.
    { labelKey: 'source', value: t.source === 'local' ? '@sourceLocal' : '@sourceYoutube' },
    // The locale is INJECTED rather than read, for the same purity reason the
    // labels are keys. It was hardcoded 'vi-VN' until 2026-07-23, so an EN user
    // got Vietnamese dates — docs/08 §3 says "the active locale".
    { labelKey: 'addedAt', value: new Date(t.addedAt).toLocaleString(locale) },
    { labelKey: 'coverArt', value: t.coverArtUrl ? '@coverArtYes' : TT_NA },
  );

  return rows;
}
