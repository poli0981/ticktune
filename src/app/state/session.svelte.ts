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

  get state(): TtAppState {
    return this.#state;
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
    return this.#countdownMs >= TT_MIN_COUNTDOWN_MS && this.#countdownMs <= TT_MAX_COUNTDOWN_MS;
  }

  /** boot → gate | setup. Boot must always reach one of them (docs/02 §1). */
  booted(needsGate: boolean): void {
    this.#state = needsGate ? 'gate' : 'setup';
  }

  /** The legal-gate Accept click. Also the autoplay-unlock gesture (docs/05 §1). */
  gateAccepted(): void {
    if (this.#state === 'gate') this.#state = 'setup';
  }

  start(): void {
    if (!this.canStart) return;
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
