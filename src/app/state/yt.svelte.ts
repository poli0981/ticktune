import { ttLog } from '../engine/log/tt-log';
import type { TtTrack } from '../engine/importer/types';
import { browserPlayerPorts } from '../engine/youtube/tt-yt-player-driver';
import { TtYtPlayer, type TtYtOverlayState } from '../engine/youtube/tt-yt-player';
import { settings } from './settings.svelte';

/**
 * YouTube playback state — the docs/12 §3.3 seam, mirroring `playback.svelte.ts`.
 *
 * A separate store rather than a branch inside `playback`: that one owns an
 * `AudioContext`, a two-node master stage and an object-URL ledger, none of
 * which exist here. Threading a mode flag through it would mean every audio
 * method growing a "unless YouTube" clause, and `docs/12 §3.2` keeps
 * `YT.Player` out of components for the same reason it keeps `AudioContext`
 * out — components read runes here and call actions here.
 *
 * The player is created **lazily**, on the first `attach` from the rail, so a
 * user who never opens the YouTube tab never contacts Google.
 */
class YtStore {
  #player: TtYtPlayer | null = null;

  #overlay = $state<TtYtOverlayState | null>(null);
  #playing = $state(false);
  #positionMs = $state<number | null>(null);
  #durationMs = $state<number | null>(null);
  #online = $state(true);

  /** Set by the app shell, exactly as `playback.onEnded` is. */
  onAdvance: (() => void) | null = null;

  get overlay(): TtYtOverlayState | null {
    return this.#overlay;
  }
  get playing(): boolean {
    return this.#playing;
  }
  get positionMs(): number | null {
    return this.#positionMs;
  }
  get durationMs(): number | null {
    return this.#durationMs;
  }
  /** docs/10 §9 — false while the browser reports no connection. */
  get online(): boolean {
    return this.#online;
  }

  setOnline(online: boolean): void {
    this.#online = online;
  }

  /**
   * The rail hands over its 384×216 element. Idempotent: Svelte re-runs the
   * effect on any re-render, and rebuilding the player there would reload the
   * iframe mid-video.
   */
  attach(mount: HTMLElement): void {
    if (this.#player !== null) return;
    this.#player = new TtYtPlayer(browserPlayerPorts(mount), {
      onAdvance: () => this.onAdvance?.(),
      onOverlay: (o) => {
        this.#overlay = o;
      },
      onStatus: (p) => {
        this.#playing = p;
      },
      // docs/12 §6's message rule: the code plus an opaque trackId, never a
      // title or a URL.
      onLog: (code, trackId) => ttLog.warn(code, '', trackId),
    });
  }

  load(track: TtTrack): void {
    this.#player?.load(track);
    this.#positionMs = null;
    this.#durationMs = null;
    this.applyVolume();
  }

  play(): void {
    this.#player?.play();
  }

  pause(): void {
    this.#player?.pause();
  }

  skipNow(): void {
    this.#player?.skipNow();
  }

  /**
   * docs/06 §2 — the settings store stays the source of truth, so a level set
   * in YouTube mode survives a switch to Playlist and back. Only the *scale*
   * differs, and the conversion happens once, inside the player.
   */
  applyVolume(): void {
    this.#player?.applyVolume(settings.current.volume, settings.current.muted);
  }

  /** Pulled from the player's tick — docs/06 §2's duration backfill. */
  tick(): void {
    if (this.#player === null) return;
    this.#positionMs = this.#player.positionMs;
    this.#durationMs = this.#player.durationMs;
  }

  dispose(): void {
    this.#player?.dispose();
    this.#player = null;
    this.#overlay = null;
    this.#playing = false;
  }
}

export const yt = new YtStore();
