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
  /**
   * Which element the current player is bound to.
   *
   * The guard used to be `#player !== null`, which is a guard on the store's
   * LIFETIME rather than on the element — and the rail is destroyed and rebuilt
   * every time the session leaves `playing`/`paused` (`TtApp` renders it behind
   * an `{#if}`). So after a Stop the old player survived, bound to a node that
   * no longer existed, and the next `attach` refused to adopt the new one.
   */
  #mount: HTMLElement | null = null;
  /**
   * A `load`/`play` issued before the rail existed — docs/06 §2.
   *
   * `onStart` is synchronous by necessity (the gesture chain, `docs/05 §1`), but
   * the rail only renders once the state IS `playing` and hands its element over
   * from an `$effect`, which Svelte flushes afterwards. So the very first Start
   * called `load()` while `#player` was still null and the call went nowhere:
   * measured 2026-07-23 on `astro dev` — no iframe, and `iframe_api` never even
   * requested, because `loadApi()` only runs inside `TtYtPlayer.load()`.
   *
   * `TtYtPlayer` already solves the same problem one layer down with
   * `#pendingId`. This is that idea at the store boundary.
   */
  #pending: { track: TtTrack; play: boolean } | null = null;

  #overlay = $state<TtYtOverlayState | null>(null);
  /** docs/06 §4's countdown-to-skip, in ms. Null when no card is counting. */
  #skipInMs = $state<number | null>(null);
  #playing = $state(false);
  #positionMs = $state<number | null>(null);
  #durationMs = $state<number | null>(null);

  /** The track the player was last asked to load, for the docs/06 §2 backfill. */
  #trackId: string | null = null;
  /**
   * Ids already backfilled — the tick runs at 10 Hz and the patch must not.
   *
   * Keyed by track rather than a single flag so a queue that comes back round
   * under Repeat does not re-patch, and so a jump backwards does not either.
   */
  readonly #backfilled = new Set<string>();

  /** Set by the app shell, exactly as `playback.onEnded` is. */
  onAdvance: (() => void) | null = null;
  /**
   * docs/06 §2 — what the player learned about the current track.
   *
   * A callback rather than a direct `session.patchTrack` call, for the reason
   * `docs/12 §3.3` gives: stores do not reach into each other, the shell wires
   * them. Same shape as `onAdvance` directly above.
   */
  onMeta:
    | ((trackId: string, fields: { durationMs?: number; title?: string; artist?: string }) => void)
    | null = null;

  get overlay(): TtYtOverlayState | null {
    return this.#overlay;
  }
  /** Whole seconds left before the card skips itself — docs/06 §4. */
  get skipInSeconds(): number | null {
    return this.#skipInMs === null ? null : Math.max(0, Math.ceil(this.#skipInMs / 1000));
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
  /**
   * The rail hands over its 384×216 element.
   *
   * Idempotent **per element**, not per lifetime: Svelte re-runs the effect on
   * any re-render, and rebuilding the player for the same node would reload the
   * iframe mid-video. A DIFFERENT node is the opposite case — the rail was
   * destroyed and rebuilt — and there the old player has to go, or it stays
   * bound to a detached node forever.
   */
  attach(mount: HTMLElement): void {
    if (this.#player !== null && this.#mount === mount) return;
    // A new element means the rail remounted. The old iframe went with the old
    // DOM; destroying the player is what lets a second run exist at all.
    this.#player?.dispose();
    this.#mount = mount;
    this.#player = new TtYtPlayer(browserPlayerPorts(mount), {
      onAdvance: () => this.onAdvance?.(),
      onOverlay: (o) => {
        this.#overlay = o;
      },
      onStatus: (p) => {
        this.#playing = p;
      },
      onSkipIn: (ms) => {
        this.#skipInMs = ms;
      },
      // docs/12 §6's message rule: the code plus an opaque trackId, never a
      // title or a URL.
      onLog: (code, trackId) => ttLog.warn(code, '', trackId),
    });

    this.#flushPending();
  }

  /**
   * Replay a `load`/`play` that arrived before the rail did.
   *
   * The sequence is exactly what `load()` and `play()` would have done, in the
   * same order, because `applyVolume` needs the player's `#api` — which only
   * exists once `load()` has called `create()`.
   */
  #flushPending(): void {
    const pending = this.#pending;
    if (pending === null || this.#player === null) return;
    this.#pending = null;
    this.#player.load(pending.track);
    this.applyVolume();
    if (pending.play) this.#player.play();
  }

  load(track: TtTrack): void {
    this.#positionMs = null;
    this.#durationMs = null;
    this.#trackId = track.id;

    if (this.#player === null) {
      // Held, not dropped. `attach` is the only thing that can act on it, and it
      // is one microtask away — see `#pending`.
      this.#pending = { track, play: false };
      return;
    }

    this.#player.load(track);
    this.applyVolume();
  }

  play(): void {
    if (this.#player === null) {
      // Start issues `load(); play();` back to back, so this is the second half
      // of the same pre-mount pair rather than a separate case.
      if (this.#pending !== null) this.#pending.play = true;
      return;
    }
    this.#player.play();
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
    this.#backfill();
  }

  /**
   * Hand the track what the player now knows — docs/06 §2.
   *
   * Driven from the tick rather than from `onStateChange: PLAYING`, which is
   * what §2 literally names. PLAYING is too early: `getDuration()` returns 0
   * until the video has loaded enough to know, so a patch there would land the
   * spec's own "0 means not known yet" value into the track and every surface
   * would render a confident `0:00`. Duration arriving is the signal that the
   * player has finished learning, so it gates the whole patch — by which point
   * `getVideoData()` is populated too.
   */
  #backfill(): void {
    const id = this.#trackId;
    const durationMs = this.#durationMs;
    if (id === null || durationMs === null || this.#backfilled.has(id)) return;

    this.#backfilled.add(id);
    const { title, author } = this.#player?.videoData ?? { title: null, author: null };
    this.onMeta?.(id, {
      durationMs,
      ...(title === null ? {} : { title }),
      ...(author === null ? {} : { artist: author }),
    });
  }

  dispose(): void {
    this.#player?.dispose();
    this.#player = null;
    this.#mount = null;
    this.#trackId = null;
    // The backfill ledger is NOT cleared: the queue survives Stop (docs/02 §1),
    // so a track already patched must not be patched again on the next run.
    // A run that was stopped before the rail mounted must not have its track
    // replayed by the NEXT run's attach.
    this.#pending = null;
    this.#overlay = null;
    this.#skipInMs = null;
    this.#playing = false;
    this.#positionMs = null;
    this.#durationMs = null;
  }
}

export const yt = new YtStore();
