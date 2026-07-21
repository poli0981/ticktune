import type { TtMode } from '../../lib/tt-domain-types';
import { browserImportPorts, filesFromDataTransfer } from '../engine/importer/tt-import-driver';
import { importFiles } from '../engine/importer/tt-import';
import { isReady, matchQueueLengthMs } from '../engine/importer/tt-queue-rules';
import type { TtImportResult, TtTrack } from '../engine/importer/types';
import { ttLog } from '../engine/log/tt-log';
import { finishReport } from '../engine/timer/tt-late';
import { TT_MAX_COUNTDOWN_MS, TT_MIN_COUNTDOWN_MS } from '../engine/timer/tt-format';
import type { TtFinishInfo, TtFinishReport } from '../engine/timer/types';

/**
 * Session state — docs/02 §1 and §3.
 *
 * Everything here dies with the tab, by design. **No Dexie import appears in
 * this file**, and that is the point rather than an accident: hard invariant 1
 * says user media never leaves the browser and the queue is never persisted, so
 * the module that owns the queue is kept structurally unable to persist it.
 * Preferences live in settings.svelte.ts, which is the only module that talks to
 * IndexedDB.
 *
 * The state machine is docs/02 §1's, minus the parts that need a queue:
 *
 *     boot ──► gate ──► setup ──► playing ⇄ paused ──► finished
 *                         ▲          │                    │
 *                         └── stop ──┴──── back ──────────┤
 *                                          restart ───────┘
 *
 * P2 slice S2 owns the transitions the timer alone can make. `queue`, and the
 * `isReady` half that depends on it (docs/02 §1's `isQueueValid`), arrive with
 * the importer — at which point `canStart` gains a second clause and nothing
 * else here changes.
 */

/*
 * Not exported: consumers reach it through `session.state`, and knip fails the
 * build on unused exports (docs/12 §5). It gets exported by the slice whose
 * components actually name the type — the Setup/Player router.
 */
type TtAppState = 'boot' | 'gate' | 'setup' | 'playing' | 'paused' | 'finished';

class SessionStore {
  #state = $state<TtAppState>('boot');
  #countdownMs = $state(90_000);
  #finish = $state<TtFinishReport | null>(null);
  #queue = $state<TtTrack[]>([]);
  #importing = $state(false);
  #lastImport = $state<TtImportResult | null>(null);

  /**
   * P2 forces the effective mode to `single` without writing `lastMode`
   * (docs/03 §3). `TT_DEFAULT_SETTINGS.lastMode` is 'playlist', so a fresh
   * profile would otherwise land on a tab this phase has not built — and
   * clobbering the stored value would mean P3 has to repair it rather than
   * simply unlocking the tab.
   */
  readonly mode: TtMode = 'single';

  get state(): TtAppState {
    return this.#state;
  }

  get queue(): TtTrack[] {
    return this.#queue;
  }

  get importing(): boolean {
    return this.#importing;
  }

  /** The last batch's outcome, for the summary toast (docs/02 §4). */
  get lastImport(): TtImportResult | null {
    return this.#lastImport;
  }

  get track(): TtTrack | null {
    return this.#queue[0] ?? null;
  }

  get countdownMs(): number {
    return this.#countdownMs;
  }

  set countdownMs(ms: number) {
    this.#countdownMs = ms;
  }

  /** Null except on the Finished screen. docs/04 §2. */
  get finish(): TtFinishReport | null {
    return this.#finish;
  }

  /**
   * docs/02 §1: `ready` is a predicate on `setup`, not a state. An earlier
   * revision listed it as one, which left a user who had staged a queue with no
   * specified way back to edit it.
   */
  get canStart(): boolean {
    return isReady(this.mode, this.#queue, this.#countdownMs);
  }

  /** True when only the countdown is out of range — for the input's own hint. */
  get countdownInRange(): boolean {
    return this.#countdownMs >= TT_MIN_COUNTDOWN_MS && this.#countdownMs <= TT_MAX_COUNTDOWN_MS;
  }

  /** docs/03 §3 — null when the button must be disabled. */
  get matchableMs(): number | null {
    return matchQueueLengthMs(this.#queue);
  }

  // ── import (docs/02 §4) ────────────────────────────────────────────────────

  /**
   * Single-flight. A second drop while a batch is in flight is IGNORED with a
   * toast rather than queued or aborted (docs/02 §4) — the operation is bounded
   * and sub-second, so the simplest defined behaviour is the right one.
   */
  async importDropped(dt: DataTransfer): Promise<void> {
    if (this.#importing) return;
    const { files, dropped } = await filesFromDataTransfer(dt);
    await this.#runImport(files, dropped);
  }

  async importPicked(list: FileList | null): Promise<void> {
    if (this.#importing || !list) return;
    await this.#runImport(Array.from(list), 0);
  }

  async #runImport(files: File[], droppedByCap: number): Promise<void> {
    this.#importing = true;
    try {
      if (droppedByCap > 0) ttLog.warn('TT-IMP-008', `${droppedByCap} entries over the scan cap`);

      // docs/02 §4: a second import in Single mode REPLACES the held track,
      // because isQueueValid('single') requires exactly one — rejecting it
      // would strand a user who simply wants a different track.
      const replacing = this.mode === 'single' && files.length > 0;
      const queue = replacing ? [] : this.#queue;

      const result = await importFiles(
        { files, mode: this.mode, queue, allowDuplicates: false },
        browserImportPorts(),
      );

      // Every skip and every note gets a coded entry — docs/01 §2 principle 5.
      // The message carries no file name: docs/12 §6 makes the diagnostics
      // payload safe to paste publicly by construction, not by remembering.
      for (const s of [...result.skipped, ...result.notes]) ttLog.warn(s.code, '');

      if (result.added.length > 0) this.#queue = [...queue, ...result.added];
      this.#lastImport = result;
    } finally {
      this.#importing = false;
    }
  }

  /** docs/02 §6 — user removal. Revoking URLs is the audio engine's job. */
  removeTrack(id: string): void {
    this.#queue = this.#queue.filter((t) => t.id !== id);
    ttLog.info('TT-USR-001', '', id);
  }

  dismissImport(): void {
    this.#lastImport = null;
  }

  /** docs/02 §6 — a track that failed to decode is marked, not silently dropped. */
  markTrackError(id: string): void {
    this.#queue = this.#queue.map((t) => (t.id === id ? { ...t, status: 'error' as const } : t));
  }

  /** boot → gate | setup. Boot must always reach one of them (docs/02 §1). */
  booted(needsGate: boolean): void {
    this.#state = needsGate ? 'gate' : 'setup';
  }

  /** The legal-gate Accept click. Also the autoplay-unlock gesture (docs/05 §1). */
  gateAccepted(): void {
    if (this.#state === 'gate') this.#state = 'setup';
  }

  /**
   * @param force the `?ttdebug=1` timer-only Start (docs/15 §S2). Spike S2's
   *   cases 4–7 are still unrun and its silent case is audio-free by
   *   definition, so the harness needs a way past the queue predicate. Gated
   *   by the flag, exactly like the debug panel, and it collects nothing.
   */
  start(force = false): void {
    if (!force && !this.canStart) return;
    this.#finish = null;
    this.#state = 'playing';
  }

  pause(): void {
    if (this.#state === 'playing') this.#state = 'paused';
  }

  resume(): void {
    if (this.#state === 'paused') this.#state = 'playing';
  }

  /** Stop, from playing or paused. Returns to Setup with the run discarded. */
  stop(): void {
    if (this.#state === 'playing' || this.#state === 'paused') {
      this.#finish = null;
      this.#state = 'setup';
    }
  }

  /**
   * The countdown reached zero.
   *
   * `Date.now()` is read HERE, as the first thing the handler does, because
   * `finishReport` reconstructs the instant zero was reached by subtracting the
   * overshoot from it (docs/04 §2). Every statement between the timer firing and
   * this read adds to the error, and the case this exists for is precisely the
   * one where the main thread is stalled.
   */
  finished(info: TtFinishInfo): void {
    this.#finish = finishReport(info, Date.now());
    this.#state = 'finished';
  }

  /** Finished → setup. docs/03 §3.5 "Back to setup". */
  backToSetup(): void {
    this.#finish = null;
    this.#state = 'setup';
  }

  /** Finished → playing, same countdown. docs/02 §1 "Restart, same queue". */
  restart(): void {
    if (this.#state !== 'finished') return;
    this.#finish = null;
    this.#state = 'playing';
  }
}

export const session = new SessionStore();
