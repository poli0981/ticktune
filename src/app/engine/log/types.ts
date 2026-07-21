/** Log engine types — docs/02 §7, registry in docs/12 §6. */

export type TtLogLevel = 'info' | 'warn' | 'error';

/** `TT-AAA-nnn` (docs/12 §1). Registered in docs/12 §6 *before* first use. */
export type TtLogCode = `TT-${string}-${string}`;

export interface TtLogEntry {
  ts: number;
  level: TtLogLevel;
  code: TtLogCode;
  /**
   * Code-adjacent context only — **never** a raw file name, tag value, track
   * title or any other user string (docs/12 §6 message-content rule). That rule
   * is what makes the bug template's "contains no personal files" promise true
   * by construction rather than by reviewer diligence.
   */
  message: string;
  /** nanoid — opaque, so it carries nothing identifying. */
  trackId?: string;
}

/** Shape of Settings → Diagnostics → Copy Diagnostics (docs/02 §7). */
export interface TtDiagnostics {
  app: 'TickTune';
  version: string;
  ua: string;
  capturedAt: string;
  mode: string;
  settings: Record<string, unknown>;
  /** Last 50 entries, oldest first. */
  log: TtLogEntry[];
}
