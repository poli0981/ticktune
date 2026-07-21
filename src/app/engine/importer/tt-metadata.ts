import type { TtImportCode, TtRawTags } from './types';

/**
 * Tag → track mapping, docs/05 §5.
 *
 * The rule this module exists to get right was *falsified by measurement* once
 * already, so it is worth restating why it looks the way it does.
 *
 * The original spec said: if a decoded tag contains U+FFFD, fall back to the
 * file name. Spike S3 showed that never fires for the case it was written for.
 * `Nắng ấm xa dần` in an ID3v1 tag comes back as `N¯ng ¥m xa d§n` — wrong, and
 * containing ZERO replacement characters, because ID3v1 has no charset field so
 * every byte decodes as *some* valid Latin-1 character. The mojibake reached the
 * UI looking like a legitimately odd title.
 *
 * The replacement rule keys on the tag container instead. The U+FFFD check is
 * kept as well: it still catches genuinely broken UTF-8 in v2 frames, which is a
 * different failure with the same symptom.
 */

export function hasReplacementChar(v: string | null | undefined): boolean {
  return !!v && v.includes('�');
}

const nonAscii = (v: string | null | undefined): boolean =>
  !!v && [...v].some((c) => c.codePointAt(0)! > 0x7f);

/**
 * A tag is unreliable when it came from ID3v1 ALONE *and* carries non-ASCII.
 *
 * Both halves matter:
 *  - `onlyV1`, because any other container present means music-metadata read a
 *    charset-aware tag. S3 found ID3v2.2 and APEv2 in a 103-file corpus, so this
 *    must treat any non-ID3v1 entry as sufficient reason to trust the tag —
 *    listing known-good containers instead would reject the ones nobody
 *    anticipated.
 *  - `nonAscii`, because pure-ASCII ID3v1 is unambiguous and must be KEPT. Most
 *    Western files are exactly that, and discarding their titles would be a
 *    regression, not a fix.
 */
export function isTagUnreliable(
  tagTypes: readonly string[],
  title: string | null | undefined,
  artist: string | null | undefined,
): boolean {
  const onlyV1 = tagTypes.length > 0 && tagTypes.every((t) => t === 'ID3v1');
  return onlyV1 && (nonAscii(title) || nonAscii(artist));
}

/**
 * docs/02 §2's fallback: no usable tag title ⇒ the file name, minus extension.
 *
 * Nothing further is stripped — leading track numbers, underscores and the rest
 * are the user's own naming and inventing rules for them would silently rewrite
 * titles the user recognises.
 */
export function titleFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return base.trim() || fileName;
}

const str = (v: string | number | null | undefined): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
};

const posNum = (v: number | null | undefined): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

/** The mapped subset of a track, plus any non-fatal code the mapping raised. */
export interface TtMappedTags {
  title: string;
  artist: string;
  album?: string;
  year?: string;
  genre?: string;
  trackNo?: string;
  durationMs?: number;
  codec?: string;
  bitrateKbps?: number;
  sampleRateHz?: number;
  channels?: number;
  /** TT-IMP-006 (parse failed) or TT-IMP-007 (tag unreliable). */
  note?: TtImportCode;
}

/**
 * @param raw null when the parse threw. docs/02 §4 step 2: a parse failure is
 *   NOT an import failure — the track is kept with a file-name title.
 */
export function mapTags(raw: TtRawTags | null, fileName: string): TtMappedTags {
  if (raw === null) {
    return { title: titleFromFileName(fileName), artist: '', note: 'TT-IMP-006' };
  }

  const unreliable =
    isTagUnreliable(raw.tagTypes, raw.title, raw.artist) ||
    hasReplacementChar(raw.title) ||
    hasReplacementChar(raw.artist);

  const title = unreliable ? undefined : str(raw.title);
  const artist = unreliable ? undefined : str(raw.artist);

  // Only the text fields are discarded when the tag is unreliable. Container,
  // bitrate and duration come from the stream itself, not from a charset-less
  // tag, so they are unaffected — dropping them too would lose good data for a
  // text-encoding problem.
  return {
    title: title ?? titleFromFileName(fileName),
    artist: artist ?? '',
    ...(unreliable ? {} : optional('album', str(raw.album))),
    ...(unreliable ? {} : optional('genre', str(raw.genre))),
    ...optional('year', str(raw.year)),
    ...optional('trackNo', str(raw.trackNo)),
    ...optional('durationMs', posNum(raw.durationMs)),
    ...optional('codec', str(raw.codec) ?? str(raw.container)),
    ...optional('bitrateKbps', posNum(raw.bitrateKbps)),
    ...optional('sampleRateHz', posNum(raw.sampleRateHz)),
    ...optional('channels', posNum(raw.channels)),
    ...(unreliable ? { note: 'TT-IMP-007' as const } : {}),
  };
}

/**
 * `exactOptionalPropertyTypes` is on (docs/12 §2), so an optional property must
 * be ABSENT rather than set to undefined. Spreading an empty object is how that
 * is expressed without a mutable builder.
 */
function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
