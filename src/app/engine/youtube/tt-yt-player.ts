import type { TtTrack } from '../importer/types';

/**
 * The YouTube player state machine — docs/06 §2 and §4.
 *
 * Pure over `TtYtPlayerPorts`, which is the whole point: the IFrame API cannot
 * run in a unit test, cannot run in CI at all (docs/13 §4 — nothing may depend
 * on YouTube's servers), and cannot be driven by Playwright. Behind an injected
 * `create` it can be all three.
 *
 * What lives here is every DECISION: when to advance, how an error maps to an
 * overlay, how long before the skip fires. `tt-yt-player-driver.ts` loads the
 * script and constructs the real player and does nothing else.
 */

/** The `YT.PlayerState` values this app reacts to. */
export const YT_ENDED = 0;
export const YT_PLAYING = 1;
export const YT_PAUSED = 2;

/**
 * docs/06 §4 — how long a typed overlay shows before the queue moves on.
 *
 * One value, not the table's two: `02 §6`'s separate 3 s path for `onError 100`
 * folded into the 150 row when spike S1 established that 100 never fires. Two
 * constants where one code can arrive would be two behaviours nobody can tell
 * apart.
 */
export const OVERLAY_SKIP_MS = 5_000;

/**
 * What `getVideoData()` returns — docs/06 §2.
 *
 * ⚠️ **Not in YouTube's published IFrame Player API reference.** It is long
 * established and universally present, but nothing contractually stops a future
 * build dropping it, so every field is optional and the driver treats a missing
 * method as "we learned nothing" rather than as an error.
 */
export interface TtYtVideoData {
  title?: string;
  author?: string;
  video_id?: string;
}

/** The subset of `YT.Player` this app uses. Nothing else may be called. */
export interface TtYtPlayerApi {
  loadVideoById: (videoId: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  /** YouTube's scale is **0–100**, not the 0–1 the Web Audio gain uses. */
  setVolume: (volume: number) => void;
  mute: () => void;
  unMute: () => void;
  /** Seconds, and 0 until the video is loaded enough to know. */
  getDuration: () => number;
  getCurrentTime: () => number;
  /** docs/06 §2's title/channel backfill. Empty object when unavailable. */
  getVideoData: () => TtYtVideoData;
  destroy: () => void;
}

export interface TtYtPlayerEvents {
  onReady: () => void;
  onStateChange: (state: number) => void;
  onError: (code: number) => void;
}

export interface TtYtPlayerPorts {
  /**
   * Construct the player. **Must** target `youtube-nocookie.com`.
   *
   * The host is the driver's business, but it is asserted rather than trusted —
   * `tests/unit/tt-yt-player-driver.test.ts`. `host` defaults to
   * `www.youtube.com`, which sets cookies, and the shipped CSP still permits
   * that origin in `frame-src`, so a missing option would violate CLAUDE.md
   * invariant 2 with nothing to catch it. (This sentence claimed the assertion
   * existed for a phase in which it did not; the test is what made it true.)
   */
  create: (events: TtYtPlayerEvents) => TtYtPlayerApi;
  /** Injected so the 5 s skip is drivable by fake timers. */
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (handle: number) => void;
}

/** What the rail renders over the player area — docs/06 §4. */
export interface TtYtOverlayState {
  /** i18n key stem. Hardcoded VI until P5 (docs/08 §3.1). */
  key: 'yt.err.blocked' | 'yt.err.gone' | 'yt.err.invalid' | 'yt.err.player';
  code: 'TT-YT-150' | 'TT-YT-100' | 'TT-YT-002' | 'TT-YT-005';
  /**
   * True only for `yt.err.blocked`, where the cause genuinely cannot be
   * narrowed: S1 measured age-restricted and region-blocked as identical from
   * the outside — both 200 from oEmbed, both `onError 150`. The overlay says so
   * rather than picking one and sounding certain.
   */
  ambiguous: boolean;
}

export interface TtYtPlayerHost {
  /** The track finished, or its overlay timed out. Advance the queue. */
  onAdvance: () => void;
  onOverlay: (overlay: TtYtOverlayState | null) => void;
  /**
   * Milliseconds until the card skips itself, or null when nothing is counting.
   *
   * docs/06 §4 lists a countdown-to-skip among the card's five parts. Without it
   * the card sat still and then vanished, which reads as the app losing its
   * place rather than as a decision it announced.
   */
  onSkipIn?: (remainingMs: number | null) => void;
  onStatus: (playing: boolean) => void;
  onLog: (code: TtYtOverlayState['code'] | 'TT-YT-005', trackId?: string) => void;
}

/**
 * docs/06 §4, and every row of it is now the same row.
 *
 * S1 measured `onError 150` for six distinct causes and never saw 100 at all,
 * on either host, cued or played. The other codes stay mapped because they are
 * cheap and a future sighting should land somewhere honest — but nothing may
 * *depend* on them arriving.
 */
export function overlayForError(code: number): TtYtOverlayState {
  if (code === 100) return { key: 'yt.err.gone', code: 'TT-YT-100', ambiguous: false };
  if (code === 2) return { key: 'yt.err.invalid', code: 'TT-YT-002', ambiguous: false };
  if (code === 5) return { key: 'yt.err.player', code: 'TT-YT-005', ambiguous: false };
  // 101, 150, and anything unmeasured. The honest bucket is the common one here.
  return { key: 'yt.err.blocked', code: 'TT-YT-150', ambiguous: true };
}

export class TtYtPlayer {
  readonly #ports: TtYtPlayerPorts;
  readonly #host: TtYtPlayerHost;

  #api: TtYtPlayerApi | null = null;
  #track: TtTrack | null = null;
  #skipTimer: number | null = null;
  #countdownTimer: number | null = null;
  #pendingId: string | null = null;

  constructor(ports: TtYtPlayerPorts, host: TtYtPlayerHost) {
    this.#ports = ports;
    this.#host = host;
  }

  get ready(): boolean {
    return this.#api !== null;
  }

  /** Seconds → ms for the docs/03 §2 Z7 bar, or null before the player knows. */
  get positionMs(): number | null {
    return this.#api === null ? null : toMs(this.#api.getCurrentTime());
  }

  /**
   * docs/06 §2 — `getDuration()` is what backfills `durationMs`, because oEmbed
   * does not carry it and the Data API is post-1.0. It returns 0 until the video
   * has loaded, so 0 is reported as **unknown** rather than as a zero-length
   * track: `positionText` renders `–` for null and `0:00` for zero, and the
   * second would be a confident lie.
   */
  get durationMs(): number | null {
    return this.#api === null ? null : toMs(this.#api.getDuration());
  }

  /**
   * docs/06 §2 — title and channel from the player itself.
   *
   * Only useful when oEmbed did not answer, which is exactly the `pending` case:
   * `tt-yt-import.ts` writes `title: ''` and `artist: ''` there, and every
   * surface then renders `N/A` for a video that plays perfectly well.
   *
   * Empty strings come back as null so `docs/02 §2`'s fallback rule stays the
   * one that decides what a missing value looks like.
   */
  get videoData(): { title: string | null; author: string | null } {
    const data = this.#api?.getVideoData();
    return { title: nonEmpty(data?.title), author: nonEmpty(data?.author) };
  }

  /**
   * Load a track, creating the player on first use.
   *
   * **One instance, reused** (docs/06 §2). Destroying and rebuilding per track
   * would reload the iframe, drop the gesture chain that authorised playback,
   * and flash an empty 384×216 hole where the ToS requires a visible player.
   */
  load(track: TtTrack): void {
    this.#clearSkip();
    this.#host.onOverlay(null);
    this.#track = track;

    const videoId = track.videoId;
    if (videoId === undefined) return;

    if (this.#api === null) {
      // The API is not up yet; remember what to play and let `attach` do it.
      this.#pendingId = videoId;
      this.#api = this.#ports.create({
        onReady: () => this.#onReady(),
        onStateChange: (s) => this.#onStateChange(s),
        onError: (c) => this.#onError(c),
      });
      return;
    }

    this.#api.loadVideoById(videoId);
  }

  play(): void {
    this.#api?.playVideo();
  }

  pause(): void {
    this.#api?.pauseVideo();
  }

  /**
   * @param volume the app's 0–1 value. Converted here, once.
   *
   * The scale mismatch is the trap: `setVolume(0.8)` is a silent player, not a
   * loud one, and it looks exactly like a mute bug.
   */
  applyVolume(volume: number, muted: boolean): void {
    if (this.#api === null) return;
    this.#api.setVolume(Math.round(Math.min(1, Math.max(0, volume)) * 100));
    if (muted) this.#api.mute();
    else this.#api.unMute();
  }

  dispose(): void {
    this.#clearSkip();
    this.#api?.destroy();
    this.#api = null;
    this.#track = null;
  }

  #onReady(): void {
    const id = this.#pendingId;
    this.#pendingId = null;
    if (id !== null) this.#api?.loadVideoById(id);
    this.#api?.playVideo();
  }

  #onStateChange(state: number): void {
    if (state === YT_PLAYING) this.#host.onStatus(true);
    else if (state === YT_PAUSED) this.#host.onStatus(false);
    else if (state === YT_ENDED) {
      this.#host.onStatus(false);
      this.#host.onAdvance();
    }
  }

  #onError(code: number): void {
    const overlay = overlayForError(code);
    this.#host.onLog(overlay.code, this.#track?.id);
    this.#host.onOverlay(overlay);
    this.#host.onStatus(false);

    // docs/06 §4 — the card is readable, then the queue moves on by itself. A
    // user who does not want to wait has the Skip now button.
    this.#clearSkip();
    this.#skipTimer = this.#ports.setTimer(() => {
      // Cleared through the same path "Bỏ qua ngay" takes, so the two cannot
      // leave different state behind: without this the counter's last published
      // value stayed at 1 s after the card had already gone, and the countdown
      // timer was left pending.
      this.#skipTimer = null;
      this.#clearSkip();
      this.#host.onOverlay(null);
      this.#host.onAdvance();
    }, OVERLAY_SKIP_MS);
    // §4 lists a countdown-to-skip among the card's five parts, and it was the
    // one nobody built: the card simply sat there and then vanished, so the
    // automatic advance looked like the app losing its place.
    this.#tickCountdown(OVERLAY_SKIP_MS);
  }

  /**
   * Drive the card's remaining-seconds readout — docs/06 §4.
   *
   * Uses the same injected timer as the skip itself, so a test that controls one
   * controls both, and so the two can never disagree about how long is left.
   */
  #tickCountdown(remainingMs: number): void {
    this.#host.onSkipIn?.(remainingMs);
    if (remainingMs <= 0) return;
    this.#countdownTimer = this.#ports.setTimer(() => {
      this.#countdownTimer = null;
      // Guard: "Bỏ qua ngay" or the next load clears the skip, and a stray tick
      // afterwards would redraw a counter over a card that is gone.
      if (this.#skipTimer === null) return;
      this.#tickCountdown(remainingMs - 1_000);
    }, 1_000);
  }

  /** "Skip now" — the same path the timer takes, minus the wait. */
  skipNow(): void {
    this.#clearSkip();
    this.#host.onOverlay(null);
    this.#host.onAdvance();
  }

  #clearSkip(): void {
    if (this.#skipTimer !== null) this.#ports.clearTimer(this.#skipTimer);
    this.#skipTimer = null;
    if (this.#countdownTimer !== null) this.#ports.clearTimer(this.#countdownTimer);
    this.#countdownTimer = null;
    this.#host.onSkipIn?.(null);
  }
}

/**
 * YouTube reports seconds, and **0 for "not known yet"** rather than null.
 *
 * Passing that 0 through would render `0:00`, which reads as a real value.
 * Null renders `–` (hard invariant 5), which is what we actually know.
 */
function toMs(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * 1000);
}

/** '' is missing, not a title. Same reasoning as `toMs`'s zero. */
function nonEmpty(v: string | undefined): string | null {
  return v === undefined || v.trim() === '' ? null : v;
}
