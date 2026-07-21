import type { TtTrack } from '../importer/types';
import { applyVolume, silenceDecks } from './tt-audio-graph';
import { detectWrap } from './tt-loop-count';
import { TtUrlLedger, urlKey } from './tt-object-urls';
import type { TtAudioEvents, TtAudioPorts, TtDeckId, TtPlaybackStatus } from './types';

/**
 * The deck state machine — docs/05 §1-§3, pure over `TtAudioPorts`.
 *
 * Single mode only in P2: one track, hard loop. The A/B pair exists in the graph
 * already because `createMediaElementSource` may be called only ONCE per
 * element, so the decks are created up front and their `.src` is swapped —
 * building them lazily per track would throw on the second load. The crossfade
 * loop style, which is what the second deck is otherwise for, is behind
 * docs/15 §S4b.
 */
export class TtAudioEngine {
  readonly #ports: TtAudioPorts;
  readonly #events: TtAudioEvents;
  readonly #ledger: TtUrlLedger;

  #deck: TtDeckId = 0;
  #track: TtTrack | null = null;
  #status: TtPlaybackStatus = 'idle';
  #loops = 1;
  #prevTimeS = 0;

  constructor(ports: TtAudioPorts, events: TtAudioEvents) {
    this.#ports = ports;
    this.#events = events;
    this.#ledger = new TtUrlLedger(ports.createUrl, ports.revokeUrl);
  }

  get status(): TtPlaybackStatus {
    return this.#status;
  }

  /** docs/03 §2 Z4 — the current playthrough index, ×1 on the first pass. */
  get loops(): number {
    return this.#loops;
  }

  /** Live object URLs. The docs/09 §5 leak canary, surfaced for the debug panel. */
  get liveUrls(): number {
    return this.#ledger.size;
  }

  /** Media position for Z7 (docs/03 §2). Not a countdown — docs/04 §4 owns those. */
  get positionMs(): number {
    return Math.round(this.#ports.deck(this.#deck).currentTimeS * 1000);
  }

  /**
   * The element's own duration, which can differ from the tag's and can be
   * revised mid-playback on a VBR MP3 (docs/05 §2). Null until it settles.
   */
  get durationMs(): number | null {
    const d = this.#ports.deck(this.#deck).durationS;
    return Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : null;
  }

  /**
   * The autoplay-unlock gesture (docs/05 §1).
   *
   * Idempotent, and called from all three gesture sites — the gate Accept, Start,
   * and the play button — because the gate only renders on a version change, so
   * a returning user would otherwise reach playback with a suspended context and
   * nothing would notice until nothing played.
   */
  async unlock(): Promise<void> {
    if (this.#ports.ctx.state === 'running') return;
    try {
      await this.#ports.ctx.resume();
    } catch {
      // Not fatal here: `play()` guards again and reports TT-PLY-100 if the
      // context is still not running when it actually matters.
    }
  }

  /**
   * Load a track onto the current deck. Revokes the previous track's URLs, so
   * repeatedly replacing the Single-mode track cannot accumulate them.
   */
  load(track: TtTrack, loop: boolean): void {
    const previous = this.#track;
    if (previous && previous.id !== track.id) this.#ledger.releaseTrack(previous.id);

    this.#track = track;
    this.#loops = 1;
    this.#prevTimeS = 0;

    if (!track.file) {
      this.#fail('TT-PLY-101', track.id);
      return;
    }

    // Keyed by TRACK, not by deck — docs/05 §3's bound only closes that way.
    const url = this.#ledger.acquire(urlKey(track.id, 'media'), track.file);
    const deck = this.#ports.deck(this.#deck);
    deck.setSrc(url);
    deck.setLoop(loop);
    this.#ports.deckGain(this.#deck).setValue(1, this.#ports.ctx.nowS);
  }

  async play(): Promise<void> {
    if (this.#track === null) return;

    // docs/05 §1: guard again before every play — Safari re-suspends.
    if (this.#ports.ctx.state !== 'running') await this.unlock();

    try {
      await this.#ports.deck(this.#deck).play();
      this.#setStatus('playing');
    } catch {
      // The autoplay policy refused. Report it and stay honest about the state:
      // claiming "playing" here is how a silent app looks like a working one.
      this.#status = 'blocked';
      this.#events.onLog('TT-PLY-100');
      this.#events.onStatus('blocked');
    }
  }

  pause(): void {
    if (this.#status !== 'playing') return;
    this.#ports.deck(this.#deck).pause();
    this.#setStatus('paused');
  }

  stop(): void {
    this.#ports.deck(this.#deck).pause();
    silenceDecks(this.#ports);
    this.#setStatus('idle');
  }

  setVolume(volume: number, muted: boolean): void {
    applyVolume(this.#ports, volume, muted);
  }

  /**
   * Called from the media element's `timeupdate` (~4 Hz).
   *
   * This is the whole of the loop counter: `element.loop = true` emits no
   * `ended`, so a wrap is only visible as `currentTime` going backwards
   * (docs/05 §2).
   */
  onTimeUpdate(): void {
    const deck = this.#ports.deck(this.#deck);
    const current = deck.currentTimeS;
    if (detectWrap(this.#prevTimeS, current, deck.durationS)) {
      this.#loops += 1;
      this.#events.onLoop(this.#loops);
    }
    this.#prevTimeS = current;
  }

  /** The element's `error` event — docs/02 §6, TT-PLY-101. */
  onMediaError(): void {
    if (this.#track) this.#fail('TT-PLY-101', this.#track.id);
  }

  /**
   * Release everything. `pagehide` and queue clear (docs/05 §3).
   *
   * Note it does NOT touch the timer: the two engines meet at exactly two points
   * and teardown is not one of them (docs/04 §5). A decode failure stopping the
   * countdown would be the worse bug.
   */
  dispose(): void {
    this.#ports.deck(0).pause();
    this.#ports.deck(1).pause();
    this.#ledger.releaseAll();
    this.#track = null;
    this.#setStatus('idle');
  }

  #fail(code: 'TT-PLY-101', trackId: string): void {
    this.#ports.deck(this.#deck).pause();
    this.#status = 'error';
    this.#events.onLog(code, { trackId });
    this.#events.onStatus('error');
  }

  #setStatus(status: TtPlaybackStatus): void {
    this.#status = status;
    this.#events.onStatus(status);
  }
}
