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
  #liveUrls = $state(0);

  /** The loaded track is Single mode's, so the loop style applies to it. */
  #single = false;
  /** What the shell said comes next — the track a crossfade lands on. */
  #nextTrack: TtTrack | null = null;

  /**
   * The end-of-run pause, scheduled for when the fade finishes.
   *
   * 🔴 It used to be fire-and-forget. With `endAction` restart/loop the next run
   * starts 400 ms after zero — and the previous run's timer then paused the NEW
   * run's audio at `endFadeMs` (2 s by default): the countdown kept going in
   * silence with ▶ on the transport. "Chạy lại" inside the fade did the same.
   * Every action that starts or stops playback cancels it now.
   */
  #fadePause: ReturnType<typeof setTimeout> | null = null;

  /** Set by the app shell so a finished track can advance the queue. */
  onEnded: (() => void) | null = null;
  /** Set by the app shell: the loaded track failed to decode — docs/02 §6. */
  onError: ((trackId: string) => void) | null = null;
  /**
   * Set by the app shell: a crossfade into `trackId` became real (docs/05 §2).
   * The shell advances the queue here — once; the outgoing track's `ended`,
   * if it comes, is dropped by the engine.
   */
  onCrossfade: ((trackId: string) => void) | null = null;

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
  /**
   * docs/09 §5's leak canary, for the ?ttdebug=1 panel. Pushed by the ledger
   * on every change: read through the engine's plain getter it was never
   * re-read, so the panel showed the count from its first render, forever.
   */
  get liveUrls(): number {
    return this.#liveUrls;
  }
  get peakRms(): number {
    return this.#driver?.peakRms ?? 0;
  }

  /**
   * The visualizer's window onto the analyser — docs/05 §6.
   *
   * Deliberately NOT reactive. These are read from a `requestAnimationFrame`
   * loop sixty times a second, and a `$state` field written at that rate would
   * schedule sixty Svelte flushes per second across the whole component tree
   * for a value only one canvas reads. The rune stores own state that the UI
   * derives from; a frame buffer is neither.
   *
   * Returns 0 / no-ops before the driver is built, which is the state every
   * page view starts in and the one a visualizer mounted at boot would hit.
   */
  get binCount(): number {
    return this.#driver?.binCount ?? 0;
  }

  readFrequencyData(into: Uint8Array<ArrayBuffer>): void {
    this.#driver?.readFrequencyData(into);
  }

  readTimeDomainData(into: Uint8Array<ArrayBuffer>): void {
    this.#driver?.readTimeDomainData(into);
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
      // Only for the track this store still holds: a failure reported for a
      // track that has since been replaced is stale, and acting on it would
      // skip the one now playing.
      onError: (trackId) => {
        if (this.#track?.id === trackId) this.onError?.(trackId);
      },
      onLiveUrls: (n) => {
        this.#liveUrls = n;
      },
      onCrossfade: (trackId) => this.#crossfaded(trackId),
    });
    this.#driver.engine.setCrossfade(settings.current.crossfadeMs);
    return this.#driver;
  }

  /** The engine swapped decks: the incoming track is the current one now. */
  #crossfaded(trackId: string): void {
    const next = this.#nextTrack;
    if (next?.id === trackId) {
      this.#track = next;
      this.#loops = 1;
      this.#positionMs = 0;
      this.#durationMs = next.durationMs;
    }
    this.onCrossfade?.(trackId);
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

  #cancelFadePause(): void {
    if (this.#fadePause !== null) clearTimeout(this.#fadePause);
    this.#fadePause = null;
  }

  /**
   * @param single true in Single mode, where `singleLoopStyle` decides how the
   *   track loops (docs/05 §2) — read here, at every load. A playlist track
   *   loads with no loop **so that `ended` fires at all**: `element.loop = true`
   *   emits no `ended` event, which is why Single mode needs no mode check on
   *   the advance path.
   */
  async load(track: TtTrack, single: boolean): Promise<void> {
    this.#cancelFadePause();
    const driver = this.#ensure();
    this.#track = track;
    this.#single = single;
    this.#loops = 1;
    this.#positionMs = 0;
    this.#durationMs = track.durationMs;
    driver.engine.load(track, single ? settings.current.singleLoopStyle : 'none');
    driver.engine.setVolume(settings.current.volume, settings.current.muted);
    driver.refresh();
  }

  async play(): Promise<void> {
    this.#cancelFadePause();
    const driver = this.#ensure();
    await driver.engine.play();
    driver.refresh();
  }

  pause(): void {
    this.#driver?.engine.pause();
    this.#driver?.refresh();
  }

  stop(): void {
    this.#cancelFadePause();
    this.#driver?.engine.stop();
    this.#driver?.resetFade();
    this.#driver?.refresh();
    this.#loops = 1;
    this.#positionMs = 0;
  }

  applyVolume(): void {
    this.#driver?.engine.setVolume(settings.current.volume, settings.current.muted);
  }

  /** `crossfadeMs` reaches the engine — from the next transition on (05 §2). */
  applyCrossfade(): void {
    this.#driver?.engine.setCrossfade(settings.current.crossfadeMs);
    this.#driver?.refresh();
  }

  /** `singleLoopStyle` reaches the track already looping, not just the next load. */
  applyLoopStyle(): void {
    if (this.#single) this.#driver?.engine.setLoopMode(settings.current.singleLoopStyle);
  }

  /**
   * What the queue would play next — the shell keeps it current
   * (`session.peekNext()`). The engine arms it ahead and fades into it.
   */
  setNext(track: TtTrack | null): void {
    this.#nextTrack = track;
    this.#driver?.engine.setNext(track);
  }

  /** Re-arm the fade stage before a run — see runEndBehavior. */
  resetFade(): void {
    this.#cancelFadePause();
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
    this.#cancelFadePause();
    this.#fadePause = setTimeout(() => {
      this.#fadePause = null;
      this.#driver?.engine.pause();
    }, plan.fadeMs);
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
    this.#cancelFadePause();
    this.#driver?.dispose();
    this.#driver = null;
    this.#track = null;
    this.#status = 'idle';
  }
}

export const playback = new PlaybackStore();
