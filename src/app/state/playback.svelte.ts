import type { TtEndAction } from '../../lib/tt-domain-types';
import { TtAudioDriver } from '../engine/audio/tt-audio-driver';
import type { TtPlaybackStatus } from '../engine/audio/types';
import { ttLog } from '../engine/log/tt-log';
import type { TtTrack } from '../engine/importer/types';
import { settings } from './settings.svelte';

/**
 * Playback state — the one-way seam of docs/12 §3.3.
 *
 * Components never see the driver: they read runes here and call actions here,
 * and the driver's events flow back in. That is what keeps `AudioContext` out of
 * every component (docs/12 §3.2) and what makes the whole audio path swappable
 * behind one module.
 *
 * The driver is created LAZILY, on the first action that needs it. Constructing
 * an `AudioContext` at module load would create a suspended context on every
 * page view including ones that never play anything, and — more practically —
 * would run in any test that imports this module.
 */
class PlaybackStore {
  #driver: TtAudioDriver | null = null;

  #status = $state<TtPlaybackStatus>('idle');
  #loops = $state(1);
  #track = $state<TtTrack | null>(null);
  #positionMs = $state(0);
  #durationMs = $state<number | null>(null);

  /** TT-SYS-205 is a property of the build, so it is reported once per session. */
  #loopStyleReported = false;

  /** Set by the app shell so a finished track can advance the queue. */
  onEnded: (() => void) | null = null;

  get status(): TtPlaybackStatus {
    return this.#status;
  }
  get loops(): number {
    return this.#loops;
  }
  get track(): TtTrack | null {
    return this.#track;
  }
  get positionMs(): number {
    return this.#positionMs;
  }
  get durationMs(): number | null {
    return this.#durationMs;
  }
  /** docs/09 §5's leak canary, for the ?ttdebug=1 panel. */
  get liveUrls(): number {
    return this.#driver?.engine.liveUrls ?? 0;
  }
  get peakRms(): number {
    return this.#driver?.peakRms ?? 0;
  }

  #ensure(): TtAudioDriver {
    this.#driver ??= new TtAudioDriver({
      onLog: (code, detail) => {
        // docs/12 §6: the message carries the code and non-identifying context
        // only — never a file name. `trackId` is opaque and safe.
        ttLog.warn(
          code,
          '',
          typeof detail?.['trackId'] === 'string' ? detail['trackId'] : undefined,
        );
      },
      onLoop: (n) => {
        this.#loops = n;
      },
      onEnded: () => this.onEnded?.(),
      onStatus: (s) => {
        this.#status = s;
      },
    });
    return this.#driver;
  }

  /**
   * docs/05 §2 — the Single-mode loop style, honoured rather than assumed.
   *
   * Through P2 nothing read `singleLoopStyle` at all: this call passed a literal
   * `true`, so a stored `'crossfade'` fell back to hard **silently** — the exact
   * behaviour docs/05 §2 forbids, and indistinguishable from correctness because
   * the fallback is what a listener hears either way. TT-SYS-205 is the notice
   * the doc always promised; `15 §S4b` is what it is waiting on.
   */
  #hardLoopForSingle(): boolean {
    if (settings.current.singleLoopStyle === 'crossfade' && !this.#loopStyleReported) {
      this.#loopStyleReported = true;
      ttLog.warn('TT-SYS-205', 'singleLoopStyle=crossfade unavailable, using hard');
    }
    return true;
  }

  /**
   * The autoplay-unlock gesture. Called from all three sites docs/05 §1 names:
   * the gate Accept, Start, and the play button.
   *
   * Returns the promise rather than awaiting internally so a caller inside a
   * gesture handler can fire it synchronously and await later — WebKit counts
   * the gesture only if `resume()` is reached before the task yields.
   */
  unlock(): Promise<void> {
    return this.#ensure().unlock();
  }

  /**
   * @param loop true in Single mode only. A playlist track loads with
   *   `loop: false` **so that `ended` fires at all** — `element.loop = true`
   *   emits no `ended` event (docs/05 §2), which is why Single mode needs no
   *   mode check on the advance path.
   */
  async load(track: TtTrack, loop: boolean): Promise<void> {
    const driver = this.#ensure();
    this.#track = track;
    this.#loops = 1;
    this.#positionMs = 0;
    this.#durationMs = track.durationMs;
    driver.engine.load(track, loop && this.#hardLoopForSingle());
    driver.engine.setVolume(settings.current.volume, settings.current.muted);
    driver.refresh();
  }

  async play(): Promise<void> {
    const driver = this.#ensure();
    await driver.engine.play();
    driver.refresh();
  }

  pause(): void {
    this.#driver?.engine.pause();
    this.#driver?.refresh();
  }

  stop(): void {
    this.#driver?.engine.stop();
    this.#driver?.resetFade();
    this.#driver?.refresh();
    this.#loops = 1;
    this.#positionMs = 0;
  }

  applyVolume(): void {
    this.#driver?.engine.setVolume(settings.current.volume, settings.current.muted);
  }

  /** Re-arm the fade stage before a run — see runEndBehavior. */
  resetFade(): void {
    this.#driver?.resetFade();
  }

  /**
   * The importer's cover-art port (docs/05 §3, §5).
   *
   * Bound as an arrow so it can be handed to `browserImportPorts` without
   * losing `this`, and so the driver is created on first import rather than
   * being required up front.
   */
  makeCoverUrl = (trackId: string, bytes: Uint8Array, mime: string): string | null => {
    try {
      return this.#ensure().engine.acquireCoverUrl(trackId, bytes, mime);
    } catch {
      // A cover is decoration. Losing one must never fail an import that is
      // otherwise fine (docs/02 §4 — parse problems are non-fatal).
      return null;
    }
  };

  /** docs/02 §6 — releases the track's media and cover URLs. */
  releaseTrack(trackId: string): void {
    this.#driver?.engine.releaseTrack(trackId);
  }

  /**
   * docs/02 §5 — fade, chime and flash at zero, then whatever `endAction` says.
   *
   * Returns the action rather than acting on it: restarting the countdown is
   * the session's business, and docs/12 §3.3 keeps the data flowing one way.
   * Returns null when there is nothing playing — the ?ttdebug=1 timer-only run.
   */
  runEndBehavior(): { flash: boolean; action: TtEndAction } | null {
    if (!this.#driver) return null;
    const s = settings.current;
    const plan = this.#driver.runEndBehavior(
      {
        endFadeMs: s.endFadeMs,
        endChime: s.endChime,
        endFlash: s.endFlash,
        endAction: s.endAction,
      },
      s.muted,
    );
    // The media element is paused after the fade has actually finished, not
    // before it — pausing first would cut the fade off at its first sample.
    setTimeout(() => this.#driver?.engine.pause(), plan.fadeMs);
    return { flash: plan.flash, action: plan.action };
  }

  /**
   * Pull the media position from the element — called from the player's tick.
   *
   * Pull rather than push because `timeupdate` fires at only ~4 Hz, which is
   * visibly steppy on a progress bar, and because the element is the only thing
   * that knows the truth after a VBR duration revision (docs/05 §2).
   */
  tick(): void {
    const engine = this.#driver?.engine;
    if (!engine) return;
    this.#positionMs = engine.positionMs;
    this.#durationMs = engine.durationMs ?? this.#track?.durationMs ?? null;
  }

  dispose(): void {
    this.#driver?.dispose();
    this.#driver = null;
    this.#track = null;
    this.#status = 'idle';
  }
}

export const playback = new PlaybackStore();
