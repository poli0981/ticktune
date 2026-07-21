/**
 * Import step 1 — docs/02 §4: the extension allow-list crossed with a live
 * `canPlayType()` probe (browser matrix in docs/05 §4).
 *
 * Both halves are needed and neither is sufficient. The extension list is what
 * the file picker advertises; the probe is what makes a Safari user get an
 * honest TT-IMP-001 instead of a track that imports and then refuses to play.
 *
 * One module owns both, so the `<input accept>` attribute and the validator
 * cannot drift apart — a mismatch there is invisible until someone drags in a
 * file the picker would have hidden.
 */

/** docs/02 §4, verbatim and in that order. */
export const TT_ACCEPT_EXT = [
  '.mp3',
  '.m4a',
  '.aac',
  '.flac',
  '.wav',
  '.ogg',
  '.oga',
  '.opus',
  '.webm',
] as const;

/** The `accept` attribute for the picker. Derived, never hand-written. */
export const TT_ACCEPT_ATTR = TT_ACCEPT_EXT.join(',');

/**
 * MIME to probe per extension.
 *
 * `.opus` carries the codec parameter because bare `audio/ogg` answers a
 * different question — a browser can support Vorbis-in-Ogg and not Opus, which
 * is precisely the Safari row in docs/05 §4.
 */
const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg; codecs=opus',
  '.webm': 'audio/webm',
};

/** Lower-cased extension including the dot, or '' when there is none. */
export function extOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  // A leading dot is a hidden file, not an extension: ".flac" has no name.
  if (dot <= 0) return '';
  return fileName.slice(dot).toLowerCase();
}

export function mimeForExt(ext: string): string | null {
  return MIME[ext] ?? null;
}

/**
 * @param canPlay `HTMLAudioElement.canPlayType`. Returns '' when unsupported,
 *   'maybe' or 'probably' otherwise — anything non-empty is a yes.
 */
export function isAccepted(fileName: string, canPlay: (mime: string) => string): boolean {
  const mime = mimeForExt(extOf(fileName));
  if (mime === null) return false;
  return canPlay(mime) !== '';
}
