import type { TtMode } from '../../../lib/tt-domain-types';

/**
 * Importer types — docs/02 §2 (the track model) and §4 (the pipeline).
 *
 * `TtTrack` lives here rather than in a shared types file because the importer
 * is what mints tracks; P4's YouTube engine imports the type from here rather
 * than declaring a parallel one.
 */

/*
 * Reachable through `TtTrack` by inference, so not exported until a module
 * actually names them — knip fails the build on unused exports (docs/12 §5).
 * P4's YouTube engine is the likely first caller.
 */
type TtSource = 'local' | 'youtube';
type TtStatus = 'ok' | 'pending' | 'error';

/** docs/02 §2, verbatim. Missing text renders `N/A`, missing numbers `–`. */
export interface TtTrack {
  /** `crypto.randomUUID()` — opaque, so docs/12 §6's "safe to paste" holds. */
  id: string;
  source: TtSource;
  status: TtStatus;

  title: string;
  artist: string;
  album?: string;
  year?: string;
  genre?: string;
  trackNo?: string;
  /** null until known. YouTube fills it after cue (docs/06 §5). */
  durationMs: number | null;

  // ── local only ────────────────────────────────────────────────────────────
  /** Session RAM, and the sole owner of the bytes. Never persisted (D3). */
  file?: File;
  /*
   * `objectUrl` was declared here from the first revision and nothing ever
   * wrote or read it — the media URL lives in the ledger under
   * `media:<trackId>` (docs/05 §3), which is what "revoked on removal" actually
   * operates on. Removed in P3 rather than left as a trap: a field that only
   * ever holds `undefined` is the shape of the coverArtUrl bug, which survived
   * a whole phase because every path around it behaved correctly.
   */
  codec?: string;
  bitrateKbps?: number;
  sampleRateHz?: number;
  channels?: number;
  fileSizeBytes?: number;
  fileName?: string;
  coverArtUrl?: string;

  // ── YouTube only — declared here, WRITTEN by P4's importer (docs/06 §5) ────
  videoId?: string;
  thumbnailUrl?: string;
  sourceUrl?: string;

  addedAt: number;
}

/**
 * Codes an import can emit — local or YouTube. Registered in docs/12 §6.
 *
 * One union across both sources on purpose: `TtImportSkip` is what the summary
 * toast renders, and a second parallel type would mean a second `MESSAGES` map
 * for TtToast to fall out of sync with. The YouTube half is import-time only —
 * play-time codes belong to the player, not to this.
 */
export type TtImportCode =
  | 'TT-IMP-001' // unsupported format / canPlayType negative
  | 'TT-IMP-002' // longer than 10:02
  | 'TT-IMP-003' // playlist total would exceed 91:00
  | 'TT-IMP-004' // the mode's queue count cap would be exceeded
  | 'TT-IMP-005' // duplicate (local key, or videoId in YouTube mode)
  | 'TT-IMP-006' // metadata parse failed — imported with a file-name title
  | 'TT-IMP-007' // tag unreliable — file-name fallback
  | 'TT-IMP-008' // dropped entry count exceeded the pre-scan cap
  | 'TT-YT-001' // oEmbed pre-check failed transiently — kept as `pending`
  | 'TT-YT-002' // not a YouTube video link
  | 'TT-YT-003' // the 50-link cap would be exceeded
  | 'TT-YT-004' // oEmbed failed for a reason nobody has classified
  | 'TT-YT-100' // deleted, never existed, or private
  | 'TT-YT-101'; // embedding disabled by the owner

/**
 * Tags as the importer consumes them — deliberately NOT music-metadata's shape.
 *
 * The mapping rules (docs/05 §5) are the part worth testing, and they should be
 * testable without the parser, a real file, or a browser. `tt-import-driver.ts`
 * adapts `parseBlob`'s output into this; everything downstream is pure.
 */
export interface TtRawTags {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  year?: string | number | null;
  genre?: string | null;
  trackNo?: string | number | null;
  durationMs?: number | null;
  codec?: string | null;
  container?: string | null;
  bitrateKbps?: number | null;
  sampleRateHz?: number | null;
  channels?: number | null;
  /** e.g. `['ID3v2.3','ID3v1']`. Drives the docs/05 §5 `onlyV1` rule. */
  tagTypes: string[];
  /**
   * First embedded picture — docs/05 §5. Raw bytes, not a URL: creating the
   * object URL is impure and has to go through the ledger that owns the
   * docs/05 §3 accounting, so the pipeline hands the bytes to a port instead of
   * minting a URL nothing is tracking.
   */
  coverArt?: { bytes: Uint8Array; mime: string } | null;
}

/**
 * Everything impure the pipeline needs, injected.
 *
 * This is what keeps `tt-import.ts` inside the coverage gate: the browser lives
 * behind these five functions, and `tt-import-driver.ts` is the only module that
 * implements them (docs/13 §1's `*-driver.ts` carve-out).
 */
export interface TtImportPorts {
  newId: () => string;
  now: () => number;
  /** `HTMLAudioElement.canPlayType` — '' , 'maybe' or 'probably'. */
  canPlay: (mime: string) => string;
  /** Rejects/returns null when the file cannot be parsed (→ TT-IMP-006). */
  parseTags: (file: File) => Promise<TtRawTags | null>;
  /** Fallback only, when the parse yields no duration (docs/05 §5). */
  probeDuration: (file: File) => Promise<number | null>;
  /**
   * Registers an embedded cover with the object-URL ledger and returns its
   * blob URL — docs/05 §3, where cover URLs are created at import and counted
   * against the `queueLength + 2` bound. Returns null when it cannot.
   */
  makeCoverUrl: (trackId: string, bytes: Uint8Array, mime: string) => string | null;
  /**
   * Called once per file as the batch walks it — docs/02 §4's progress
   * indicator, deferred from P2 to P3 because Single mode imports one file at a
   * median 11 ms and a spinner would only flash.
   *
   * **Optional on purpose.** Making it required would edit every `makePorts`
   * factory in the unit suite to add a callback none of those tests care about,
   * which is a lot of churn to prove a port exists. The pipeline is unchanged
   * when it is absent.
   *
   * @param done files finished, INCLUDING rejected ones — the bar tracks work
   *   completed, not tracks added, or it would stall on a batch of duplicates.
   * @param total files the batch will actually walk, after the step-0 cap.
   */
  onProgress?: (done: number, total: number) => void;
}

export interface TtImportInput {
  files: File[];
  mode: TtMode;
  /** The queue as it stands. Capacity is measured against it. */
  queue: TtTrack[];
  /** docs/02 §3.1 `allowDuplicates` — bypasses the §4 step-5 check. */
  allowDuplicates: boolean;
}

/** One rejected or skipped file. */
export interface TtImportSkip {
  code: TtImportCode;
  /**
   * ⚠️ UI ONLY. docs/12 §6 forbids a user string in a log `message`, and a file
   * name is exactly that. The toast may show it; the log entry carries the code.
   */
  fileName: string;
}

export interface TtImportResult {
  added: TtTrack[];
  skipped: TtImportSkip[];
  /** Non-fatal codes raised by files that were still added (006 / 007). */
  notes: TtImportSkip[];
}
