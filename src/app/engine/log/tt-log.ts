import type { TtDiagnostics, TtLogCode, TtLogEntry, TtLogLevel } from './types';

/**
 * In-memory log — docs/02 §7.
 *
 * Pure TS, no Svelte, no persistence. Nothing here is written to disk or sent
 * anywhere: the buffer dies with the tab, and the only way anything leaves the
 * machine is the user copying a diagnostics blob and pasting it themselves
 * (`legal/PRIVACY-POLICY.md §5`).
 */

export const TT_LOG_CAPACITY = 500;
/** Copy Diagnostics carries the tail, not the whole buffer (docs/02 §7). */
export const TT_DIAGNOSTICS_TAIL = 50;

export class TtLog {
  /** Ring buffer: fixed slots, monotonic write cursor. */
  readonly #slots: (TtLogEntry | undefined)[];
  readonly #capacity: number;
  #written = 0;
  #listeners = new Set<(e: TtLogEntry) => void>();
  readonly #now: () => number;

  constructor(capacity = TT_LOG_CAPACITY, now: () => number = () => Date.now()) {
    this.#capacity = capacity;
    this.#slots = new Array<TtLogEntry | undefined>(capacity);
    this.#now = now;
  }

  /** Total ever appended, including entries already overwritten. */
  get written(): number {
    return this.#written;
  }

  get size(): number {
    return Math.min(this.#written, this.#capacity);
  }

  add(level: TtLogLevel, code: TtLogCode, message = '', trackId?: string): TtLogEntry {
    const entry: TtLogEntry = {
      ts: this.#now(),
      level,
      code,
      message,
      ...(trackId === undefined ? {} : { trackId }),
    };
    this.#slots[this.#written % this.#capacity] = entry;
    this.#written++;
    for (const l of this.#listeners) l(entry);
    return entry;
  }

  info = (code: TtLogCode, message?: string, trackId?: string) =>
    this.add('info', code, message, trackId);
  warn = (code: TtLogCode, message?: string, trackId?: string) =>
    this.add('warn', code, message, trackId);
  error = (code: TtLogCode, message?: string, trackId?: string) =>
    this.add('error', code, message, trackId);

  /** Oldest first. Optionally filtered by level, as the Diagnostics viewer does. */
  entries(level?: TtLogLevel): TtLogEntry[] {
    const out: TtLogEntry[] = [];
    const start = Math.max(0, this.#written - this.#capacity);
    for (let i = start; i < this.#written; i++) {
      const e = this.#slots[i % this.#capacity];
      if (e && (!level || e.level === level)) out.push(e);
    }
    return out;
  }

  clear(): void {
    this.#slots.fill(undefined);
    this.#written = 0;
  }

  subscribe(fn: (e: TtLogEntry) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /**
   * docs/02 §7. Deliberately excludes the queue and any file names — the
   * message-content rule (docs/12 §6) keeps user strings out of `message` in the
   * first place, so this is safe to paste into a public issue without a scrub
   * step that someone would eventually forget.
   */
  diagnostics(input: {
    version: string;
    ua: string;
    mode: string;
    settings: Record<string, unknown>;
  }): TtDiagnostics {
    return {
      app: 'TickTune',
      version: input.version,
      ua: input.ua,
      capturedAt: new Date(this.#now()).toISOString(),
      mode: input.mode,
      settings: input.settings,
      log: this.entries().slice(-TT_DIAGNOSTICS_TAIL),
    };
  }
}

/** The app-wide buffer. */
export const ttLog = new TtLog();

/**
 * docs/02 §7: `window.onerror` + `unhandledrejection` append TT-SYS-3xx.
 *
 * Only the error's *name* is recorded, never its message: a stack or message can
 * contain a file name the user dropped in, and that would put a user string into
 * a payload we tell people is safe to paste publicly (docs/12 §6).
 * The full text still reaches the browser console for local debugging.
 */
export function installGlobalCapture(target: Window, log: TtLog = ttLog): () => void {
  const onError = (e: ErrorEvent) => {
    log.error('TT-SYS-300', errorName(e.error) || 'window.onerror');
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    log.error('TT-SYS-301', errorName(e.reason) || 'unhandledrejection');
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}

function errorName(err: unknown): string {
  if (err instanceof Error) return err.name;
  if (typeof err === 'string') return 'string';
  return typeof err;
}
