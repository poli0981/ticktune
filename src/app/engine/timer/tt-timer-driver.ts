import { TtTimer } from './tt-timer';
import type { TtTickSample, TtTimerLogCode } from './types';

/**
 * Browser wiring for the timer core — docs/04 §2-3.
 *
 * The facade components talk to, so no component ever touches Worker, rAF or
 * Wake Lock directly (docs/12 §3.2). Imports nothing from Svelte, so the
 * engine-purity lint zone still holds.
 *
 * Three cooperating sources, by design:
 *   - Worker, 200 ms: authoritative progression; emits `done` even when hidden.
 *   - rAF: rendering only, and only while visible — it recomputes from the same
 *     derived clock, so pausing it cannot desync anything.
 *   - visibility/focus latch: the safety net for the case docs/04 §2 is honest
 *     about, where a hidden AND silent tab gets its worker throttled too.
 */

export interface TtTimerDriverOptions {
  onRemaining: (remainingMs: number) => void;
  onDone: (info: { late: boolean; overshootMs: number }) => void;
  onLog?: (code: TtTimerLogCode | 'TT-SYS-202', detail?: Record<string, number>) => void;
  /** Spike S2 only — see TtTickSample and docs/15 §S2. */
  onSample?: (sample: TtTickSample) => void;
}

export class TtTimerDriver {
  readonly #timer: TtTimer;
  readonly #opts: TtTimerDriverOptions;

  #worker: Worker | null = null;
  #raf: number | null = null;
  #wakeLock: WakeLockSentinel | null = null;
  #wakeLockWarned = false;
  #disposed = false;

  constructor(opts: TtTimerDriverOptions) {
    this.#opts = opts;
    this.#timer = new TtTimer({
      onDone: (info) => {
        void this.#releaseWakeLock();
        this.#stopRaf();
        this.#postToWorker({ type: 'stop' });
        opts.onDone(info);
      },
      onLog: (code, detail) => opts.onLog?.(code, detail),
      ...(opts.onSample ? { onSample: opts.onSample } : {}),
    });

    document.addEventListener('visibilitychange', this.#onVisibility);
    window.addEventListener('focus', this.#onVisibility);
  }

  get remainingMs(): number {
    return this.#timer.remainingMs;
  }

  get phase() {
    return this.#timer.phase;
  }

  start(durationMs: number): void {
    this.#timer.start(durationMs);
    this.#syncWorker();
    this.#startRaf();
    void this.#requestWakeLock();
    this.#emit();
  }

  pause(): void {
    this.#timer.pause();
    this.#postToWorker({ type: 'stop' });
    this.#stopRaf();
    void this.#releaseWakeLock();
    this.#emit();
  }

  resume(): void {
    this.#timer.resume();
    this.#syncWorker();
    this.#startRaf();
    void this.#requestWakeLock();
    this.#emit();
  }

  reset(): void {
    this.#timer.reset();
    this.#postToWorker({ type: 'stop' });
    this.#stopRaf();
    void this.#releaseWakeLock();
    this.#emit();
  }

  dispose(): void {
    this.#disposed = true;
    document.removeEventListener('visibilitychange', this.#onVisibility);
    window.removeEventListener('focus', this.#onVisibility);
    this.#stopRaf();
    void this.#releaseWakeLock();
    this.#worker?.terminate();
    this.#worker = null;
  }

  // ── worker ────────────────────────────────────────────────────────────────

  #ensureWorker(): Worker {
    this.#worker ??= (() => {
      const w = new Worker(new URL('./tt-timer.worker.ts', import.meta.url), { type: 'module' });
      w.addEventListener('message', (e: MessageEvent<{ type: string }>) => {
        // The worker is the authoritative source of `done`, but the core owns
        // the single-fire latch, so a worker `done` and a latch `done` racing
        // still produce exactly one event.
        if (e.data.type === 'done' || e.data.type === 'tick') this.#timer.tick();
        this.#emit();
      });
      return w;
    })();
    return this.#worker;
  }

  #postToWorker(msg: { type: 'start'; endAtEpoch: number } | { type: 'stop' }): void {
    if (msg.type === 'stop' && this.#worker === null) return;
    this.#ensureWorker().postMessage(msg);
  }

  #syncWorker(): void {
    const endAt = this.#timer.state.endAtEpoch;
    if (endAt !== null) this.#postToWorker({ type: 'start', endAtEpoch: endAt });
  }

  // ── rAF (rendering only) ──────────────────────────────────────────────────

  #startRaf(): void {
    if (this.#raf !== null || typeof requestAnimationFrame === 'undefined') return;
    const frame = () => {
      this.#raf = null;
      if (this.#disposed || this.#timer.phase !== 'running') return;
      this.#emit();
      // Stops while hidden (docs/04 §2) — it is rendering only, and the
      // visibility latch resyncs exactly on return because time is derived.
      if (!document.hidden) this.#raf = requestAnimationFrame(frame);
    };
    this.#raf = requestAnimationFrame(frame);
  }

  #stopRaf(): void {
    if (this.#raf !== null) {
      cancelAnimationFrame(this.#raf);
      this.#raf = null;
    }
  }

  #emit(): void {
    this.#opts.onRemaining(this.#timer.remainingMs);
  }

  // ── visibility latch ──────────────────────────────────────────────────────

  /**
   * docs/04 §2/§6. On becoming visible: resync immediately (exact, because time
   * is derived), restart rendering, re-acquire the Wake Lock the browser
   * auto-released, and — the important part — fire a LATE `done` if zero was
   * crossed while we were away and the worker did not manage to report it.
   */
  #onVisibility = (): void => {
    if (document.hidden || this.#timer.phase !== 'running') return;
    const remaining = this.#timer.remainingMs;
    this.#timer.tick(remaining <= 0);
    this.#emit();
    if (this.#timer.phase === 'running') {
      this.#startRaf();
      void this.#requestWakeLock();
    }
  };

  // ── wake lock (never fatal, docs/04 §3) ───────────────────────────────────

  async #requestWakeLock(): Promise<void> {
    if (this.#wakeLock !== null) return;
    try {
      this.#wakeLock = await navigator.wakeLock.request('screen');
      this.#wakeLock.addEventListener('release', () => {
        this.#wakeLock = null;
      });
    } catch {
      // Unsupported, denied, or not user-visible. Log once and carry on — the
      // countdown is unaffected, only the screensaver is.
      if (!this.#wakeLockWarned) {
        this.#wakeLockWarned = true;
        this.#opts.onLog?.('TT-SYS-202');
      }
    }
  }

  async #releaseWakeLock(): Promise<void> {
    const lock = this.#wakeLock;
    this.#wakeLock = null;
    try {
      await lock?.release();
    } catch {
      /* already released by the browser — nothing to do */
    }
  }
}
