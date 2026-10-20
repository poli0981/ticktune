import { TtTimer } from './tt-timer';
import type { TtFinishNotice, TtWorkerIn, TtWorkerOut } from './tt-timer-worker-core';
import type { TtFinishInfo, TtTickSample, TtTimerLogCode } from './types';

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

/** The worker's cadence, mirrored by the main-thread fallback (docs/04 §2). */
const FALLBACK_TICK_MS = 200;

/** At most one deadline re-send per this window when the worker finishes early. */
const RESYNC_MIN_GAP_MS = 1_000;

export interface TtTimerDriverOptions {
  onRemaining: (remainingMs: number) => void;
  onDone: (info: TtFinishInfo) => void;
  onLog?: (
    code: TtTimerLogCode | 'TT-SYS-202' | 'TT-SYS-207' | 'TT-SYS-208',
    detail?: Record<string, number>,
  ) => void;
  /** Spike S2 only — see TtTickSample and docs/15 §S2. */
  onSample?: (sample: TtTickSample) => void;
  /**
   * The finish notification (v2.0, `04 §2`). `onNotifyFailed` is the page's cue
   * to show it itself — the worker has no `Notification` (Safari), the worker
   * is broken, or permission went away — or to log why it cannot.
   */
  onNotified?: () => void;
  onNotifyFailed?: (reason: 'unsupported' | 'denied' | 'error') => void;
  onNotificationClick?: () => void;
}

export class TtTimerDriver {
  readonly #timer: TtTimer;
  readonly #opts: TtTimerDriverOptions;

  #worker: Worker | null = null;
  /** Set once the worker could not start or errored; the fallback owns ticking. */
  #workerBroken = false;
  #fallback: ReturnType<typeof setInterval> | null = null;
  #raf: number | null = null;
  #wakeLock: WakeLockSentinel | null = null;
  #wakeLockWarned = false;
  #disposed = false;
  /** Bumped by every re-anchor, so a `done` the re-anchor explains is told apart. */
  #reanchors = 0;
  #earlyDoneWarned = false;
  #lastResyncAt = Number.NEGATIVE_INFINITY;
  /** Kept here as well as in the worker, for the broken-worker path. */
  #notice: TtFinishNotice | null = null;

  constructor(opts: TtTimerDriverOptions) {
    this.#opts = opts;
    this.#timer = new TtTimer({
      onDone: (info) => {
        void this.#releaseWakeLock();
        this.#stopRaf();
        this.#postToWorker({ type: 'stop' });
        // No worker to notify from: the page is all there is (TT-SYS-207 path).
        if (this.#workerBroken && this.#notice !== null && document.hidden) {
          opts.onNotifyFailed?.('unsupported');
        }
        opts.onDone(info);
      },
      onLog: (code, detail) => opts.onLog?.(code, detail),
      onReanchor: () => {
        this.#reanchors += 1;
        this.#syncWorker();
      },
      ...(opts.onSample ? { onSample: opts.onSample } : {}),
    });

    document.addEventListener('visibilitychange', this.#onVisibility);
    window.addEventListener('focus', this.#onVisibility);

    /*
     * Created EAGERLY, at app mount — not at the first Start.
     *
     * 🔴 The worker is a separate hashed chunk. Created lazily, a tab opened
     * before a redeploy asked for a file the new deploy no longer has: the
     * worker 404'd, nothing listened for its `error`, and because rAF only
     * repaints, `done` never fired while the tab was visible — the countdown
     * sat at 0.000 until a visibility change happened to run the latch. Loading
     * it at mount fetches it while the page and its assets still match.
     */
    this.#ensureWorker();
  }

  get remainingMs(): number {
    return this.#timer.remainingMs;
  }

  get phase() {
    return this.#timer.phase;
  }

  start(durationMs: number): void {
    this.#timer.start(durationMs);
    this.#earlyDoneWarned = false;
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

  /**
   * Arm (or disarm, with null) the finish notification for the current run —
   * v2.0, `04 §2`. The shell decides whether one is wanted; the worker decides
   * whether the moment calls for it (hidden at zero).
   */
  setNotice(notice: TtFinishNotice | null): void {
    this.#notice = notice;
    this.#tellWorker({ type: 'notice', notice });
  }

  /** Close a shown notification — the user is back, or the run is over. */
  dismissNotice(): void {
    this.#tellWorker({ type: 'dismiss' });
  }

  dispose(): void {
    this.#disposed = true;
    document.removeEventListener('visibilitychange', this.#onVisibility);
    window.removeEventListener('focus', this.#onVisibility);
    this.#stopRaf();
    this.#stopFallback();
    void this.#releaseWakeLock();
    this.#worker?.terminate();
    this.#worker = null;
  }

  // ── worker ────────────────────────────────────────────────────────────────

  #ensureWorker(): Worker | null {
    if (this.#worker !== null || this.#workerBroken) return this.#worker;
    if (typeof Worker === 'undefined') {
      this.#breakWorker();
      return null;
    }
    try {
      const w = new Worker(new URL('./tt-timer.worker.ts', import.meta.url), { type: 'module' });
      w.addEventListener('message', (e: MessageEvent<TtWorkerOut>) => {
        const msg = e.data;
        if (msg.type === 'notified') return void this.#opts.onNotified?.();
        if (msg.type === 'notifyFailed') return void this.#opts.onNotifyFailed?.(msg.reason);
        if (msg.type === 'notificationClick') return void this.#opts.onNotificationClick?.();
        // The worker is the authoritative source of `done`, but the core owns
        // the single-fire latch, so a worker `done` and a latch `done` racing
        // still produce exactly one event.
        if (e.data.type === 'done' || e.data.type === 'tick') {
          const reanchors = this.#reanchors;
          this.#timer.tick();
          const unexplained = this.#reanchors === reanchors;
          if (e.data.type === 'done' && this.#timer.phase === 'running' && unexplained) {
            this.#recoverEarlyDone();
          }
        }
        this.#emit();
      });
      // A chunk that 404s, or a throw inside the worker. Either way it will
      // never tick again, and silence here is a countdown that never ends.
      w.addEventListener('error', (e) => {
        e.preventDefault();
        this.#breakWorker();
      });
      this.#worker = w;
      // The worker starts out believing the page is in front; tell it the truth.
      w.postMessage({ type: 'visibility', hidden: document.hidden } satisfies TtWorkerIn);
    } catch {
      this.#breakWorker();
    }
    return this.#worker;
  }

  /** A message with no fallback meaning — dropped when there is no worker. */
  #tellWorker(msg: TtWorkerIn): void {
    this.#ensureWorker()?.postMessage(msg);
  }

  /**
   * The worker is gone for good: log TT-SYS-207 once and let a main-thread
   * interval carry the authoritative tick. It is throttled like any timer in a
   * hidden tab — exactly the case the visibility latch already covers — and
   * exact while visible, because time is derived (docs/04 §1).
   */
  #breakWorker(): void {
    if (this.#workerBroken) return;
    this.#workerBroken = true;
    this.#worker?.terminate();
    this.#worker = null;
    this.#opts.onLog?.('TT-SYS-207');
    if (this.#timer.phase === 'running') this.#startFallback();
  }

  #startFallback(): void {
    if (this.#fallback !== null) return;
    this.#fallback = setInterval(() => {
      this.#timer.tick();
      this.#emit();
    }, FALLBACK_TICK_MS);
  }

  #stopFallback(): void {
    if (this.#fallback !== null) clearInterval(this.#fallback);
    this.#fallback = null;
  }

  #postToWorker(msg: { type: 'start'; endAtEpoch: number } | { type: 'stop' }): void {
    const w = msg.type === 'stop' ? this.#worker : this.#ensureWorker();
    if (w !== null) {
      w.postMessage(msg);
      return;
    }
    if (!this.#workerBroken) return; // a stop before any worker existed
    if (msg.type === 'start') this.#startFallback();
    else this.#stopFallback();
  }

  #syncWorker(): void {
    const endAt = this.#timer.state.endAtEpoch;
    if (endAt !== null) this.#postToWorker({ type: 'start', endAtEpoch: endAt });
  }

  /**
   * The safety net under `onReanchor`. The worker reported `done` and stopped,
   * the core still has time left, and no re-anchor in this tick explains it.
   * Left alone nothing would tick again while the tab stays visible — rAF only
   * repaints — so re-send the deadline: at most once a second, logged once per
   * run (TT-SYS-208).
   */
  #recoverEarlyDone(): void {
    const now = performance.now();
    if (now - this.#lastResyncAt < RESYNC_MIN_GAP_MS) return;
    this.#lastResyncAt = now;
    if (!this.#earlyDoneWarned) {
      this.#earlyDoneWarned = true;
      this.#opts.onLog?.('TT-SYS-208');
    }
    this.#syncWorker();
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
    // First, and whatever the phase: the worker decides at zero whether the
    // page was away, so it must hear every change — including the one this
    // latch is about to ignore (v2.0, `04 §2`).
    this.#tellWorker({ type: 'visibility', hidden: document.hidden });
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
