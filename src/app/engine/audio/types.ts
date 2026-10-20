/**
 * The port interfaces that ARE the pure/impure boundary — docs/05 §1.
 *
 * Everything the audio engine needs from the browser is one of these methods.
 * `tt-audio-driver.ts` is the only module that implements them against real Web
 * Audio and real media elements; every decision the engine makes is testable
 * against fakes, which is what keeps it inside the `src/app/engine/` coverage
 * gate (docs/13 §1).
 */

/** The two decks of docs/05 §1's A/B graph. */
export type TtDeckId = 0 | 1;

/*
 * Reachable through `TtAudioEvents`; not exported until a module names it,
 * because knip fails the build on unused exports (docs/12 §5).
 */
type TtAudioLogCode =
  | 'TT-PLY-100' // playback blocked by the autoplay policy
  | 'TT-PLY-101' // playback error on a local track
  | 'TT-PLY-103' // chime could not be scheduled
  | 'TT-PLY-105'; // resume() never completed — no usable audio output

/** A gain node, as far as the engine is concerned. */
export interface TtGainPort {
  /** Immediate set. Throws in real Web Audio if a curve is active — see §1. */
  setValue: (value: number, atTime: number) => void;
  /** `setValueCurveAtTime`. Never called with durationS === 0 (RangeError). */
  setCurve: (values: Float32Array, startTime: number, durationS: number) => void;
  cancelScheduled: (fromTime: number) => void;
  readonly value: number;
}

/** One `HTMLAudioElement`, behind the four calls the engine actually makes. */
export interface TtMediaPort {
  setSrc: (url: string) => void;
  play: () => Promise<void>;
  pause: () => void;
  setLoop: (loop: boolean) => void;
  readonly currentTimeS: number;
  readonly durationS: number;
}

interface TtCtxPort {
  /** `AudioContext.currentTime`, in seconds. The clock every fade is on. */
  readonly nowS: number;
  readonly state: 'suspended' | 'running' | 'closed';
  resume: () => Promise<void>;
}

/**
 * The graph of docs/05 §1.
 *
 * `userGain` and `fadeGain` are separate nodes and must stay separate: Web Audio
 * rejects any automation scheduled inside an active `setValueCurveAtTime` window
 * with NotSupportedError, and `AudioParam.value =` is specified as
 * `setValueAtTime`, so it throws too. One shared node means a user touching
 * volume during the end fade crashes the End Behavior.
 */
export interface TtAudioPorts {
  ctx: TtCtxPort;
  deck: (id: TtDeckId) => TtMediaPort;
  deckGain: (id: TtDeckId) => TtGainPort;
  userGain: TtGainPort;
  fadeGain: TtGainPort;
  /**
   * Object-URL creation, so the ledger stays testable (docs/05 §3). Takes a
   * Blob rather than a File because embedded cover art arrives as raw bytes,
   * not as a file the user picked.
   */
  createUrl: (source: Blob) => string;
  revokeUrl: (url: string) => void;
  /**
   * A timer, injected so the engine stays free of globals and its timeouts are
   * drivable from a unit test. Needed because `AudioContext.resume()` can hang
   * forever rather than rejecting — see `TtAudioEngine.unlock`.
   */
  delay: (ms: number) => Promise<void>;
}

/** What the engine reports outward. State flows engine → state → components. */
export interface TtAudioEvents {
  onLog: (code: TtAudioLogCode, detail?: Record<string, number | string>) => void;
  /** A wrap was detected on the hard loop — docs/03 §2's "Loop ×N". */
  onLoop: (count: number) => void;
  /**
   * The current track played to its end — docs/02 §5's playlist advance.
   *
   * Fires only when the deck was loaded with `loop: false`, because
   * `element.loop = true` emits no `ended` at all (docs/05 §2). That is not a
   * limitation to work around here: it is exactly why Single mode needs no mode
   * check on this path, and why the loop counter is derived from a `currentTime`
   * regression instead.
   */
  onEnded: () => void;
  onStatus: (status: TtPlaybackStatus) => void;
  /**
   * The loaded track could not be decoded or played — docs/02 §6.
   *
   * Separate from `onLog` because it is an instruction to the QUEUE, not a
   * diagnostic: the shell marks the track `error` and moves on. Before v1.1 the
   * engine only logged TT-PLY-101 and set its status, nothing told the session,
   * and a playlist stopped dead on the first undecodable file. Optional so the
   * engine's unit fakes need not care.
   */
  onError?: (trackId: string) => void;
  /**
   * The number of live object URLs changed — docs/05 §3's bound, docs/09 §5's
   * leak canary. Optional: only the debug panel shows it.
   */
  onLiveUrls?: (count: number) => void;
}

export type TtPlaybackStatus = 'idle' | 'playing' | 'paused' | 'blocked' | 'error';
