import { orderEntries, applyEntryCap, type TtDropNode } from './tt-drop-order';
import type { TtImportPorts, TtRawTags } from './types';

/**
 * The browser half of the importer — docs/02 §4 step 0 and docs/05 §5.
 *
 * Named `*-driver.ts` so the coverage gate skips it (docs/13 §1): happy-dom
 * implements neither `webkitGetAsEntry` nor `FileSystemDirectoryReader`, so
 * "unit testing" this would mean mocking every browser API and asserting the
 * mocks. The decisions it would otherwise contain — ordering, the entry cap,
 * every rejection rule — live in the pure modules beside it.
 */

/**
 * `music-metadata` is imported lazily, on the first import action.
 *
 * It is a substantial parser and the boot chunk has a 250 KB gz budget
 * (docs/13 §5); a user who never imports a file should never download it.
 */
async function parseWithMusicMetadata(file: File): Promise<TtRawTags | null> {
  const { parseBlob } = await import('music-metadata');
  const m = await parseBlob(file);

  // docs/05 §5: the FIRST embedded picture. S3 measured covers up to 7.26 MB in
  // a real library, so the bytes are handed straight to the ledger rather than
  // copied around.
  const picture = m.common.picture?.[0];

  return {
    ...(picture ? { coverArt: { bytes: picture.data, mime: picture.format || 'image/jpeg' } } : {}),
    title: m.common.title ?? null,
    artist: m.common.artist ?? null,
    album: m.common.album ?? null,
    year: m.common.year ?? null,
    genre: m.common.genre?.[0] ?? null,
    trackNo: m.common.track?.no ?? null,
    durationMs: m.format.duration === undefined ? null : Math.round(m.format.duration * 1000),
    codec: m.format.codec ?? null,
    container: m.format.container ?? null,
    bitrateKbps: m.format.bitrate === undefined ? null : Math.round(m.format.bitrate / 1000),
    sampleRateHz: m.format.sampleRate ?? null,
    channels: m.format.numberOfChannels ?? null,
    tagTypes: m.format.tagTypes ? [...m.format.tagTypes] : [],
  };
}

/**
 * Fallback duration probe — docs/05 §5.
 *
 * Only reached when the parse yielded no duration, because it is the expensive
 * path: an object URL, a media element, and a load. Always revokes, including
 * on failure, so a probe that throws cannot leak a URL.
 */
function probeDurationViaElement(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    const done = (value: number | null): void => {
      el.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(value);
    };

    el.addEventListener('loadedmetadata', () => {
      done(Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : null);
    });
    el.addEventListener('error', () => done(null));
    // A file the browser accepts but never reports metadata for would otherwise
    // hang the whole sequential import.
    setTimeout(() => done(null), 5_000);

    el.preload = 'metadata';
    el.src = url;
  });
}

/**
 * @param makeCoverUrl supplied by the playback layer, so cover URLs land in the
 *   same ledger as media URLs and stay inside the docs/05 §3 bound. Minting
 *   them here with a bare `URL.createObjectURL` would leak them past the canary.
 */
export function browserImportPorts(makeCoverUrl: TtImportPorts['makeCoverUrl']): TtImportPorts {
  const probe = document.createElement('audio');
  return {
    newId: () => crypto.randomUUID(),
    now: () => Date.now(),
    canPlay: (mime) => probe.canPlayType(mime),
    parseTags: parseWithMusicMetadata,
    probeDuration: probeDurationViaElement,
    makeCoverUrl,
  };
}

/**
 * Flattens a drop into an ordered, capped file list — docs/02 §4 step 0.
 *
 * Two hazards here, both SILENT failures rather than errors, and both the
 * reason this cannot be "just read dataTransfer.files":
 *
 *  1. `DataTransfer.items` is neutered as soon as the drop handler returns or
 *     its first `await` resolves. Every `webkitGetAsEntry()` handle must
 *     therefore be taken synchronously, before anything is awaited — which is
 *     why the entries are collected in one pass and walked in another.
 *  2. `FileSystemDirectoryReader.readEntries()` yields AT MOST 100 entries per
 *     call and must be re-called until it returns empty. A single call silently
 *     truncates — and this project's own test corpus is a 104-file folder, so
 *     the bug would look like "four files went missing" and nothing else.
 */
export async function filesFromDataTransfer(
  dt: DataTransfer,
): Promise<{ files: File[]; dropped: number }> {
  // Synchronous snapshot, before any await. See hazard 1.
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items)) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  // No entry API (older Firefox, some synthetic events): fall back to the flat
  // list, which is correct for a file-only drop and simply cannot see folders.
  if (entries.length === 0) {
    return applyEntryCap(Array.from(dt.files));
  }

  const nodes = await Promise.all(entries.map(readEntry));
  return applyEntryCap(orderEntries(nodes.filter((n): n is TtDropNode => n !== null)));
}

async function readEntry(entry: FileSystemEntry): Promise<TtDropNode | null> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      (entry as FileSystemFileEntry).file(
        (f) => resolve(f),
        () => resolve(null),
      );
    });
    return file ? { name: entry.name, file } : null;
  }

  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: TtDropNode[] = [];

  // Hazard 2: read until a call returns empty, not once.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(
        (list) => resolve(list),
        () => resolve([]),
      );
    });
    if (batch.length === 0) break;
    for (const child of batch) {
      const node = await readEntry(child);
      if (node) children.push(node);
    }
  }

  return { name: entry.name, children };
}
