import type { TtTrack } from '../importer/types';
import {
  TT_DECLICK_S,
  TT_PAUSE_MARGIN_S,
  TT_XFADE_ARM_LEAD_S,
  TT_XFADE_GUARD_S,
  TT_XFADE_LATENCY_S,
  TT_XFADE_MARGIN_S,
  crossfadePlan,
  curve,
  gainIn,
  gainOut,
  triggerDurationS,
} from './tt-crossfade';
import { applyVolume, silenceDecks } from './tt-audio-graph';
import { detectWrap } from './tt-loop-count';
import { TtUrlLedger, urlKey } from './tt-object-urls';
import type { TtAudioEvents, TtAudioPorts, TtDeckId, TtLoopMode, TtPlaybackStatus } from './types';

/**
 * The deck state machine — docs/05 §1-§3, pure over `TtAudioPorts`.
 *
 * Two decks, built once up front because `createMediaElementSource` may be
 * called only ONCE per element: their `.src` is swapped, never their nodes.
 * Since v2.0 both are used — the crossfade spike S4b measured, moved in here
 * when it passed (docs/15 §S4b):
 *
 * - the ACTIVE deck plays the current track; the IDLE one is armed with what
 *   comes next `TT_XFADE_ARM_LEAD_S` before the trigger;
 * - on each `timeupdate` of the active deck, `crossfadePlan()` decides; at
 *   `start` both curves are scheduled on the audio clock and the idle deck
 *   plays;
 * - the transition becomes REAL only when that `play()` resolves: then the
 *   decks swap roles and the shell hears `onCrossfade` — exactly once. An
 *   `ended`, `error` or `timeupdate` from any deck but the active one is
 *   dropped, which is what keeps a fading-out track from advancing the queue a
 *   second time;
 * - every load goes to the deck that is NOT sounding, so the old one can be
 *   ramped out rather than cut (the "tách" on ⏭).
 */

/**
 * How long to wait for `resume()` before deciding the audio output is unusable.
 * Generous: a real context resumes in single-digit milliseconds, so anything
 * near this is not "slow", it is "never".
 */
const RESUME_TIMEOUT_MS = 3_000;

/** docs/05 §2's ceiling on the setting; `clampSettings` holds the same. */
const MAX_FADE_MS = 5_000;

const other = (d: TtDeckId): TtDeckId => (d === 0 ? 1 : 0);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** A crossfade in flight. `startS` is where the WHOLE curve would have begun. */
interface TtXfade {
  readonly from: TtDeckId;
  readonly to: TtDeckId;
  readonly track: TtTrack;
  readonly effS: number;
  startS: number;
  /** The incoming deck's `play()` resolved — the transition is real. */
  committed: boolean;
}

export class TtAudioEngine {
  readonly #ports: TtAudioPorts;
  readonly #events: TtAudioEvents;
  readonly #ledger: TtUrlLedger;

  /** Set once `resume()` has proved unusable; stops retrying on every play. */
  #audioOutputDead = false;

  #deck: TtDeckId = 0;
  #track: TtTrack | null = null;
  /** Which track each deck holds — the media-URL bound closes on this. */
  readonly #on: [string | null, string | null] = [null, null];
  /** Track ids whose media URL this engine acquired and has not released. */
  readonly #held = new Set<string>();
  #loop: TtLoopMode = 'none';
  #status: TtPlaybackStatus = 'idle';
  #loops = 1;
  #prevTimeS = 0;

  #fadeMs = 0;
  /** What the queue would play next — the shell's `peekNext()`. */
  #next: TtTrack | null = null;
  #xfade: TtXfade | null = null;
  /** A crossfade paused at this progress; null when none is held. */
  #heldU: number | null = null;
  /** This track will not crossfade: declined, or its incoming deck failed. */
  #noXfade = false;
  /**
   * Bumped by every transition or interruption, so a timer or a `play()`
   * settling for a transition that has since been superseded does nothing.
   */
  #gen = 0;

  constructor(ports: TtAudioPorts, events: TtAudioEvents) {
    this.#ports = ports;
    this.#events = events;
    this.#ledger = new TtUrlLedger(ports.createUrl, ports.revokeUrl, (n) => events.onLiveUrls?.(n));
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

  /** Whether a crossfade is in flight — paused ones included. */
  get crossfading(): boolean {
    return this.#xfade !== null;
  }

  /** The fade the next transition will use, in ms — 0 is a hard cut. */
  get crossfadeMs(): number {
    return this.#fadeMs;
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
   * Register an embedded cover with the ledger — docs/05 §3.
   *
   * Lives here rather than in the importer so cover URLs are counted against
   * the same `queueLength + 2` bound as media URLs, and so removing a track
   * revokes both. Idempotent per track, like every other ledger entry.
   */
  acquireCoverUrl(trackId: string, bytes: Uint8Array, mime: string): string {
    const blob = new Blob([bytes as BlobPart], { type: mime });
    return this.#ledger.acquire(urlKey(trackId, 'cover'), blob);
  }

  /** docs/02 §6 — a removed track releases its media URL and its cover. */
  releaseTrack(trackId: string): void {
    this.#held.delete(trackId);
    this.#ledger.releaseTrack(trackId);
  }

  /**
   * Read through a method, not inline: `ctx.state` is a getter whose value
   * changes when `resume()` succeeds, but TypeScript narrows it at the early
   * return above and then insists the later comparison is unreachable.
   */
  #isRunning(): boolean {
    return this.#ports.ctx.state === 'running';
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
    if (this.#isRunning()) return;
    if (this.#audioOutputDead) return;

    try {
      // ⚠️ `resume()` can HANG rather than reject. Measured on CI 2026-07-21:
      // in headless Firefox with no audio output device, it never settles — so
      // a bare `await` here means `play()` never runs, and the app sits there
      // having "started" with no sound, no error and no log entry. A machine
      // with a disabled or absent sound device reaches the same state.
      //
      // The race is the whole fix: past the timeout we report it and carry on.
      await Promise.race([
        this.#ports.ctx.resume(),
        this.#ports.delay(RESUME_TIMEOUT_MS).then(() => {
          throw new Error('resume-timeout');
        }),
      ]);
    } catch {
      if (!this.#isRunning()) {
        // Once per session: this is a property of the machine, and repeating it
        // on every play would bury the rest of the log.
        this.#audioOutputDead = true;
        this.#events.onLog('TT-PLY-105');
      }
    }
  }

  /**
   * The fade for the NEXT transition, in ms — 0 is a hard cut (docs/05 §2).
   * A crossfade already sounding keeps the length it started with.
   */
  setCrossfade(ms: number): void {
    this.#fadeMs = Math.min(MAX_FADE_MS, Math.max(0, Number.isFinite(ms) ? ms : 0));
    this.#applyElementLoop();
  }

  /** Single mode's loop style for the track already loaded (docs/05 §2). */
  setLoopMode(loop: TtLoopMode): void {
    this.#loop = loop;
    this.#applyElementLoop();
  }

  /**
   * What the queue would play next, or null when nothing would — the shell
   * keeps this current (`session.peekNext()`). A deck armed with a track that
   * is no longer next gives it back.
   */
  setNext(track: TtTrack | null): void {
    this.#next = track;
    if (this.#xfade) return;
    const idle = other(this.#deck);
    const armed = this.#on[idle];
    if (armed !== null && armed !== track?.id && armed !== this.#track?.id) {
      this.#ports.deck(idle).unload();
      this.#on[idle] = null;
      this.#releaseUnused();
    }
  }

  /**
   * Load a track — onto a deck that is not sounding.
   *
   * While the active deck plays, the new track goes to the idle one and the old
   * one is ramped out over `TT_DECLICK_S` before it pauses: `setSrc` on a
   * playing element is a step, the click every ⏭ used to make. If the idle deck
   * is already armed with this track it is used as it is — that is S4b's Z2,
   * the 0 s switch: 11–24 ms from `ended` to the next track. Mid-crossfade, the
   * outgoing deck — already the quieter one — takes the new track.
   *
   * Media URLs go when no deck holds their track any more. Covers stay: the
   * track is still in the queue, and its info modal, the Setup preview and the
   * cover backdrop point at that URL (they go with the track — v1.1.1).
   */
  load(track: TtTrack, loop: TtLoopMode): void {
    const xf = this.#xfade;
    const wasPlaying = this.#status === 'playing';
    const idle = other(this.#deck);
    const target: TtDeckId = xf
      ? xf.from
      : wasPlaying || this.#on[idle] === track.id
        ? idle
        : this.#deck;

    this.#endXfade();
    for (const d of [0, 1] as const) {
      if (d === target) continue;
      const sounding = wasPlaying && (d === this.#deck || d === xf?.to || d === xf?.from);
      if (sounding) this.#declickThenStop(d);
      else if (this.#on[d] !== this.#next?.id) this.#unload(d);
    }

    this.#deck = target;
    this.#track = track;
    this.#loop = loop;
    this.#loops = 1;
    this.#prevTimeS = 0;
    this.#noXfade = false;

    if (!track.file) {
      this.#fail('TT-PLY-101', track.id);
      return;
    }

    // Keyed by TRACK, not by deck — docs/05 §3's bound only closes that way.
    const url = this.#ledger.acquire(urlKey(track.id, 'media'), track.file);
    const media = this.#ports.deck(target);
    if (this.#on[target] !== track.id) {
      media.setSrc(url);
      this.#setOn(target, track.id);
    }
    this.#applyElementLoop();
    const now = this.#ports.ctx.nowS;
    const gain = this.#ports.deckGain(target);
    gain.cancelScheduled(now);
    gain.setValue(1, now);
    this.#releaseUnused();
  }

  async play(): Promise<void> {
    if (this.#track === null) return;

    // docs/05 §1: guard again before every play — Safari re-suspends.
    if (this.#ports.ctx.state !== 'running') await this.unlock();

    if (this.#xfade && this.#heldU !== null) {
      await this.#resumeXfade();
      return;
    }

    const track = this.#track;
    try {
      await this.#ports.deck(this.#deck).play();
      this.#setStatus('playing');
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      /*
       * Three different failures arrive here, and only one of them is "blocked".
       *
       * - `AbortError`: a newer `load()` replaced `src` while this play was
       *   pending — rapid ⏭, a removed track. The newer play owns the status;
       *   reporting anything here was a false TT-PLY-100 per skip.
       * - The media failed (`NotSupportedError` and friends). The element's
       *   `error` event usually fires FIRST and `#fail` has already set `error`;
       *   overwriting it with `blocked` turned a corrupt file into an autoplay
       *   complaint and hid it from the queue. If the event did not fire, fail now.
       * - `NotAllowedError`: the autoplay policy refused. Report it and stay
       *   honest about the state: claiming "playing" here is how a silent app
       *   looks like a working one.
       */
      if (name === 'AbortError' || this.#track !== track) return;
      if (name !== 'NotAllowedError') {
        if (this.#status !== 'error') this.#fail('TT-PLY-101', track.id);
        return;
      }
      this.#status = 'blocked';
      this.#events.onLog('TT-PLY-100');
      this.#events.onStatus('blocked');
    }
  }

  /**
   * Pause. Mid-crossfade both curves are HELD where they are and ramped to zero
   * before the elements pause (S4b: `pause()` on a playing element is a step,
   * 6–8 clicks a run without the ramp); `play()` resumes the same curves from
   * there instead of restarting them.
   */
  pause(): void {
    if (this.#status !== 'playing') return;
    const xf = this.#xfade;
    if (xf?.committed) {
      const now = this.#ports.ctx.nowS;
      const u = clamp01((now - xf.startS) / xf.effS);
      this.#gen += 1;
      for (const [d, v] of [
        [xf.from, gainOut(u)],
        [xf.to, gainIn(u)],
      ] as const) {
        const gain = this.#ports.deckGain(d);
        gain.holdAt(now, v);
        gain.rampTo(0, now + TT_DECLICK_S);
      }
      this.#heldU = u;
      const g = this.#gen;
      void this.#ports.delay((TT_DECLICK_S + TT_PAUSE_MARGIN_S) * 1000).then(() => {
        if (g !== this.#gen || this.#heldU === null) return;
        this.#ports.deck(xf.from).pause();
        this.#ports.deck(xf.to).pause();
      });
      this.#setStatus('paused');
      return;
    }
    if (xf) this.#abandonXfade();
    this.#ports.deck(this.#deck).pause();
    this.#setStatus('paused');
  }

  stop(): void {
    this.#endXfade();
    this.#ports.deck(0).pause();
    this.#ports.deck(1).pause();
    silenceDecks(this.#ports);
    this.#setStatus('idle');
  }

  setVolume(volume: number, muted: boolean): void {
    applyVolume(this.#ports, volume, muted);
  }

  /**
   * A deck's `timeupdate` (~4 Hz) — the loop counter and the crossfade trigger.
   *
   * Only the ACTIVE deck's clock means anything: a fading-out deck keeps
   * reporting until it pauses. `element.loop = true` emits no `ended`, so a
   * hard-loop wrap is only visible as `currentTime` going backwards (05 §2).
   */
  onTimeUpdate(deck: TtDeckId = this.#deck): void {
    if (deck !== this.#deck || this.#track === null) return;
    const media = this.#ports.deck(deck);
    const current = media.currentTimeS;

    if (this.#hardLooping()) {
      if (detectWrap(this.#prevTimeS, current, media.durationS)) {
        this.#loops += 1;
        this.#events.onLoop(this.#loops);
      }
      this.#prevTimeS = current;
      return;
    }
    this.#prevTimeS = current;
    if (this.#status !== 'playing' || this.#xfade) return;

    // A loop crossfade fades into its own track; a playlist into the next.
    const incoming = this.#loop === 'crossfade' ? this.#track : this.#next;
    if (incoming === null) return;
    const durationS = triggerDurationS(media.durationS, this.#track.durationMs);
    if (durationS === null) {
      this.#decline();
      return;
    }
    if (durationS - current <= TT_XFADE_ARM_LEAD_S + this.#fadeMs / 1000) this.#arm(incoming);
    if (this.#fadeMs <= 0 || this.#noXfade) return;

    const plan = crossfadePlan({
      durationS,
      currentTimeS: current,
      nowS: this.#ports.ctx.nowS,
      fadeMs: this.#fadeMs,
      incomingDurationS: incoming.durationMs !== null ? incoming.durationMs / 1000 : null,
      marginS: TT_XFADE_MARGIN_S,
      latencyS: TT_XFADE_LATENCY_S,
      guardS: TT_XFADE_GUARD_S,
    });
    if (plan.kind === 'start') this.#startXfade(incoming, plan.startS, plan.effS);
    else if (plan.kind === 'never') this.#decline();
  }

  /**
   * A deck's `ended` — docs/02 §5's playlist advance, reported, not resolved:
   * which track comes next is the play order's business (docs/02 §5.1).
   *
   * Dropped unless it is the ACTIVE deck's: the outgoing deck of a crossfade can
   * reach its end after the queue has already moved, and counting that would
   * skip a track. A loop crossfade that could not fade loops here, by hand.
   */
  onEnded(deck: TtDeckId = this.#deck): void {
    if (this.#track === null || deck !== this.#deck) return;
    if (this.#loop === 'crossfade') {
      this.#loops += 1;
      this.#events.onLoop(this.#loops);
      void this.#ports.deck(deck).play();
      return;
    }
    this.#setStatus('idle');
    this.#events.onEnded();
  }

  /**
   * A deck's `error` — docs/02 §6, TT-PLY-101. An armed or outgoing deck's
   * failure is not the current track's: it is reported when its turn comes.
   */
  onMediaError(deck: TtDeckId = this.#deck): void {
    if (deck !== this.#deck) return;
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
    this.#endXfade();
    this.#ports.deck(0).pause();
    this.#ports.deck(1).pause();
    this.#ledger.releaseAll();
    this.#held.clear();
    this.#on[0] = null;
    this.#on[1] = null;
    this.#track = null;
    this.#next = null;
    this.#setStatus('idle');
  }

  /** The element loops by itself: Single mode's hard style, or a 0 s crossfade. */
  #hardLooping(): boolean {
    return this.#loop === 'hard' || (this.#loop === 'crossfade' && this.#fadeMs <= 0);
  }

  #applyElementLoop(): void {
    if (this.#track === null) return;
    this.#ports.deck(this.#deck).setLoop(this.#hardLooping());
  }

  #setOn(d: TtDeckId, trackId: string): void {
    this.#on[d] = trackId;
    this.#held.add(trackId);
  }

  /** Every media URL no deck holds any more goes back to the ledger. */
  #releaseUnused(): void {
    for (const id of this.#held) {
      if (id === this.#on[0] || id === this.#on[1]) continue;
      this.#held.delete(id);
      this.#ledger.release(urlKey(id, 'media'));
    }
  }

  #unload(d: TtDeckId): void {
    if (this.#on[d] === null) return;
    const media = this.#ports.deck(d);
    media.pause();
    media.unload();
    this.#on[d] = null;
  }

  /** Ramp a sounding deck out, then pause and empty it — unless reused meanwhile. */
  #declickThenStop(d: TtDeckId): void {
    const now = this.#ports.ctx.nowS;
    const gain = this.#ports.deckGain(d);
    gain.holdAt(now, gain.value);
    gain.rampTo(0, now + TT_DECLICK_S);
    const holding = this.#on[d];
    void this.#ports.delay((TT_DECLICK_S + TT_PAUSE_MARGIN_S) * 1000).then(() => {
      if (this.#on[d] !== holding || d === this.#deck) return;
      this.#unload(d);
      this.#releaseUnused();
    });
  }

  /** Arm the idle deck with `track`, silent, ready for the trigger or `ended`. */
  #arm(track: TtTrack): void {
    if (this.#xfade || !track.file) return;
    const idle = other(this.#deck);
    if (this.#on[idle] === track.id) return;
    const url = this.#ledger.acquire(urlKey(track.id, 'media'), track.file);
    const media = this.#ports.deck(idle);
    media.pause();
    media.setLoop(false);
    media.setSrc(url);
    const now = this.#ports.ctx.nowS;
    const gain = this.#ports.deckGain(idle);
    gain.cancelScheduled(now);
    gain.setValue(0, now);
    this.#setOn(idle, track.id);
    this.#releaseUnused();
  }

  /** No crossfade for this track — logged once, and `ended` takes over. */
  #decline(): void {
    if (this.#noXfade || this.#fadeMs <= 0) return;
    this.#noXfade = true;
    if (this.#track) this.#events.onLog('TT-PLY-106', { trackId: this.#track.id });
  }

  #startXfade(incoming: TtTrack, startS: number, effS: number): void {
    this.#arm(incoming);
    const from = this.#deck;
    const to = other(from);
    if (this.#on[to] !== incoming.id) return;

    const outGain = this.#ports.deckGain(from);
    const inGain = this.#ports.deckGain(to);
    outGain.cancelScheduled(startS);
    outGain.setCurve(curve('out'), startS, effS);
    inGain.cancelScheduled(startS);
    inGain.setCurve(curve('in'), startS, effS);

    this.#xfade = { from, to, track: incoming, startS, effS, committed: false };
    const g = ++this.#gen;
    this.#events.onCrossfadeActive?.(true);
    this.#ports
      .deck(to)
      .play()
      .then(
        () => this.#commitXfade(g),
        (err: unknown) => this.#refuseXfade(g, err),
      );
  }

  /** The incoming deck plays: the decks swap roles, and the queue hears it once. */
  #commitXfade(g: number): void {
    const xf = this.#xfade;
    if (g !== this.#gen || xf === null) return;
    xf.committed = true;
    // By the mode, not by the id: a one-track playlist on repeat fades into
    // its own track too, and that is still the queue's advance to hear.
    const looping = this.#loop === 'crossfade';
    this.#deck = xf.to;
    this.#track = xf.track;
    this.#prevTimeS = 0;
    this.#noXfade = false;
    if (looping) {
      this.#loops += 1;
      this.#events.onLoop(this.#loops);
    } else {
      this.#loops = 1;
      this.#events.onCrossfade?.(xf.track.id);
    }
    this.#scheduleFinish(g, xf.startS + xf.effS);
  }

  /**
   * The incoming deck would not play: the outgoing track plays out at full
   * level and no advance has happened — `ended` will make it, once.
   */
  #refuseXfade(g: number, err: unknown): void {
    const xf = this.#xfade;
    if (g !== this.#gen || xf === null) return;
    const now = this.#ports.ctx.nowS;
    const u = clamp01((now - xf.startS) / xf.effS);
    const outGain = this.#ports.deckGain(xf.from);
    outGain.holdAt(now, gainOut(u));
    outGain.rampTo(1, now + TT_DECLICK_S);
    const inGain = this.#ports.deckGain(xf.to);
    inGain.holdAt(now, gainIn(u));
    inGain.rampTo(0, now + TT_DECLICK_S);
    this.#ports.deck(xf.to).pause();
    this.#xfade = null;
    this.#gen += 1;
    this.#noXfade = true;
    const name = err instanceof Error ? err.name : '';
    if (name !== 'AbortError') {
      this.#events.onLog(name === 'NotAllowedError' ? 'TT-PLY-100' : 'TT-PLY-108', {
        trackId: xf.track.id,
      });
    }
    this.#events.onCrossfadeActive?.(false);
  }

  #scheduleFinish(g: number, endS: number): void {
    const ms = Math.max(0, (endS - this.#ports.ctx.nowS) * 1000) + 20;
    void this.#ports.delay(ms).then(() => this.#finishXfade(g));
  }

  /** The curves have run: the outgoing deck stops and gives its file back. */
  #finishXfade(g: number): void {
    const xf = this.#xfade;
    if (g !== this.#gen || xf === null || this.#heldU !== null) return;
    this.#xfade = null;
    const now = this.#ports.ctx.nowS;
    const outGain = this.#ports.deckGain(xf.from);
    outGain.cancelScheduled(now);
    outGain.setValue(0, now);
    this.#unload(xf.from);
    this.#releaseUnused();
    this.#events.onCrossfadeActive?.(false);
  }

  async #resumeXfade(): Promise<void> {
    const xf = this.#xfade;
    const u = this.#heldU;
    if (xf === null || u === null) return;
    const g = ++this.#gen;
    try {
      await Promise.all([this.#ports.deck(xf.from).play(), this.#ports.deck(xf.to).play()]);
    } catch {
      if (g !== this.#gen) return;
      // A resume the browser refused leaves the run as it was: paused.
      this.#events.onLog('TT-PLY-100');
      return;
    }
    if (g !== this.#gen) return;
    const t = this.#ports.ctx.nowS;
    for (const [d, v] of [
      [xf.from, gainOut(u)],
      [xf.to, gainIn(u)],
    ] as const) {
      const gain = this.#ports.deckGain(d);
      gain.cancelScheduled(t);
      gain.setValue(0, t);
      gain.rampTo(v, t + TT_DECLICK_S);
    }
    // After the ramp's end event: a curve may not overlap one.
    const t2 = t + TT_DECLICK_S + 0.001;
    const rem = (1 - u) * xf.effS;
    this.#heldU = null;
    this.#setStatus('playing');
    if (rem < 0.01) {
      this.#finishXfade(g);
      return;
    }
    this.#ports.deckGain(xf.from).setCurve(curve('out', u), t2, rem);
    this.#ports.deckGain(xf.to).setCurve(curve('in', u), t2, rem);
    xf.startS = t2 - u * xf.effS;
    this.#scheduleFinish(g, t2 + rem);
  }

  /** A crossfade whose incoming deck never started: the outgoing one carries on. */
  #abandonXfade(): void {
    const xf = this.#xfade;
    if (xf === null) return;
    const now = this.#ports.ctx.nowS;
    const outGain = this.#ports.deckGain(xf.from);
    outGain.cancelScheduled(now);
    outGain.setValue(1, now);
    const inGain = this.#ports.deckGain(xf.to);
    inGain.cancelScheduled(now);
    inGain.setValue(0, now);
    this.#ports.deck(xf.to).pause();
    this.#xfade = null;
    this.#gen += 1;
    this.#events.onCrossfadeActive?.(false);
  }

  /** Forget any crossfade without touching the decks — the caller decides. */
  #endXfade(): void {
    const had = this.#xfade !== null;
    this.#xfade = null;
    this.#heldU = null;
    this.#gen += 1;
    if (had) this.#events.onCrossfadeActive?.(false);
  }

  #fail(code: 'TT-PLY-101', trackId: string): void {
    this.#ports.deck(this.#deck).pause();
    this.#status = 'error';
    this.#events.onLog(code, { trackId });
    this.#events.onStatus('error');
    // Deferred: `#fail` can run synchronously inside `load()`, i.e. inside the
    // very call the shell is making — acting on the queue re-entrantly from
    // there would load the next track before the first load returned.
    const onError = this.#events.onError;
    if (onError) queueMicrotask(() => onError(trackId));
  }

  #setStatus(status: TtPlaybackStatus): void {
    this.#status = status;
    this.#events.onStatus(status);
  }
}
