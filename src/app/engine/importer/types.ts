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
  /** Created lazily on play, revoked on remove/replace (docs/05 §3). */
  objectUrl?: string;
  codec?: string;
  bitrateKbps?: number;
  sampleRateHz?: number;
  channels?: number;
  fileSizeBytes?: number;
  fileName?: string;
  coverArtUrl?: string;

  // ── YouTube only ──────────────────────────────────────────────────────────
  videoId?: string;
  thumbnailUrl?: string;
  sourceUrl?: string;

  addedAt: number;
}

/** Codes the local import pipeline can emit. Registered in docs/12 §6. */
export type TtImportCode =
  | 'TT-IMP-001' // unsupported format / canPlayType negative
  | 'TT-IMP-002' // longer than 10:02
  | 'TT-IMP-003' // playlist total would exceed 91:00
  | 'TT-IMP-004' // the mode's queue count cap would be exceeded
  | 'TT-IMP-005' // duplicate
  | 'TT-IMP-006' // metadata parse failed — imported with a file-name title
  | 'TT-IMP-007' // tag unreliable — file-name fallback
  | 'TT-IMP-008'; // dropped entry count exceeded the pre-scan cap

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
