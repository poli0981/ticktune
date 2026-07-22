import { isAccepted } from './tt-accept';
import { mapTags } from './tt-metadata';
import { TT_QUEUE_CAP, TT_MAX_PLAYLIST_TOTAL_MS, isPlayable } from './tt-queue-rules';
import type {
  TtImportInput,
  TtImportPorts,
  TtImportResult,
  TtImportSkip,
  TtRawTags,
  TtTrack,
} from './types';

/**
 * The local import pipeline — docs/02 §4.
 *
 * Pure over `TtImportPorts`: no DOM, no music-metadata, no clock. What that buys
 * is that every rejection boundary below is a unit test rather than a Playwright
 * run against a real file.
 */

/** docs/02 §4 — 10:02. Inclusive: 602 000 is accepted, 602 001 is not. */
export const TT_MAX_TRACK_MS = 602_000;

/**
 * docs/02 §4 step 5. Deliberately a heuristic, not a content hash: 95 files at
 * ~10 MB is far too much to hash on the import path, and name+size+duration
 * collides only for files that are, for the user's purposes, the same track.
 */
export function dedupeKey(fileName: string, sizeBytes: number, durationMs: number | null): string {
  return `${fileName}::${sizeBytes}::${durationMs ?? '?'}`;
}

function keyOf(t: TtTrack): string {
  return dedupeKey(t.fileName ?? '', t.fileSizeBytes ?? 0, t.durationMs);
}

/**
 * Runs the pipeline over an already-flattened file list.
 *
 * Step 0's directory flattening and entry cap happen before this
 * (`tt-drop-order.ts` + the driver); what step 0 contributes HERE is the
 * capacity check, hoisted ahead of every per-file await.
 *
 * That hoist is the whole point of the reordering: the original spec ran the
 * duration decode for every dropped file and only then checked the count cap, so
 * an N-file drop performed N sequential probes to add at most 95 tracks — and in
 * Single mode, at most one. A 40-file drop now parses exactly once.
 */
export async function importFiles(
  input: TtImportInput,
  ports: TtImportPorts,
): Promise<TtImportResult> {
  const { files, mode, queue, allowDuplicates } = input;

  const added: TtTrack[] = [];
  const skipped: TtImportSkip[] = [];
  const notes: TtImportSkip[] = [];

  // ── step 0: capacity, before any per-file work ────────────────────────────
  const existing = queue.filter(isPlayable).length;
  const capacity = Math.max(0, TT_QUEUE_CAP[mode] - existing);

  const accepted = files.slice(0, capacity);
  for (const over of files.slice(capacity)) {
    skipped.push({ code: 'TT-IMP-004', fileName: over.name });
  }

  const seen = new Set(queue.map(keyOf));
  // Seeded from PLAYABLE tracks, matching the capacity check above. The two
  // disagreed until P3: an errored track freed a count slot while still
  // spending its duration against the 91:00 cap, so a playlist could refuse an
  // import to protect budget it was not actually using. Single mode never had
  // two tracks, so nothing could reach it.
  let totalMs = queue.filter(isPlayable).reduce((sum, t) => sum + (t.durationMs ?? 0), 0);

  for (const file of accepted) {
    // ── step 1: allow-list × live probe ─────────────────────────────────────
    if (!isAccepted(file.name, ports.canPlay)) {
      skipped.push({ code: 'TT-IMP-001', fileName: file.name });
      continue;
    }

    // ── step 2: tags (parse failure is non-fatal — docs/02 §4) ──────────────
    let raw: TtRawTags | null;
    try {
      raw = await ports.parseTags(file);
    } catch {
      raw = null;
    }
    const mapped = mapTags(raw, file.name);

    // ── step 3: duration. Parse first, element probe only as a fallback ─────
    // docs/05 §5: parseBlob's duration is authoritative and costs a median
    // 11 ms; the probe costs an object URL and a media load.
    let durationMs = mapped.durationMs ?? null;
    if (durationMs === null) {
      try {
        durationMs = await ports.probeDuration(file);
      } catch {
        durationMs = null;
      }
    }

    if (durationMs !== null && durationMs > TT_MAX_TRACK_MS) {
      skipped.push({ code: 'TT-IMP-002', fileName: file.name });
      continue;
    }

    // ── step 4: aggregate (Playlist only) ───────────────────────────────────
    if (mode === 'playlist' && totalMs + (durationMs ?? 0) > TT_MAX_PLAYLIST_TOTAL_MS) {
      skipped.push({ code: 'TT-IMP-003', fileName: file.name });
      continue;
    }

    // ── step 5: dedupe ──────────────────────────────────────────────────────
    const key = dedupeKey(file.name, file.size, durationMs);
    if (!allowDuplicates && seen.has(key)) {
      skipped.push({ code: 'TT-IMP-005', fileName: file.name });
      continue;
    }

    // ── step 6: push ────────────────────────────────────────────────────────
    if (mapped.note) notes.push({ code: mapped.note, fileName: file.name });
    seen.add(key);
    totalMs += durationMs ?? 0;

    // The id is minted first because the cover URL is keyed by it — docs/05 §3
    // counts cover URLs per track, and a URL registered under the wrong key
    // would never be revoked when the track is removed.
    const id = ports.newId();
    const cover = raw?.coverArt
      ? ports.makeCoverUrl(id, raw.coverArt.bytes, raw.coverArt.mime)
      : null;

    added.push({
      id,
      source: 'local',
      status: 'ok',
      title: mapped.title,
      artist: mapped.artist,
      ...(mapped.album === undefined ? {} : { album: mapped.album }),
      ...(mapped.year === undefined ? {} : { year: mapped.year }),
      ...(mapped.genre === undefined ? {} : { genre: mapped.genre }),
      ...(mapped.trackNo === undefined ? {} : { trackNo: mapped.trackNo }),
      durationMs,
      file,
      ...(mapped.codec === undefined ? {} : { codec: mapped.codec }),
      ...(mapped.bitrateKbps === undefined ? {} : { bitrateKbps: mapped.bitrateKbps }),
      ...(mapped.sampleRateHz === undefined ? {} : { sampleRateHz: mapped.sampleRateHz }),
      ...(mapped.channels === undefined ? {} : { channels: mapped.channels }),
      ...(cover === null ? {} : { coverArtUrl: cover }),
      fileSizeBytes: file.size,
      fileName: file.name,
      addedAt: ports.now(),
    });
  }

  return { added, skipped, notes };
}
