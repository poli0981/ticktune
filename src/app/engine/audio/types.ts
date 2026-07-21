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
  | 'TT-PLY-103'; // chime could not be scheduled

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
  /** Object-URL creation, so the ledger stays testable (docs/05 §3). */
  createUrl: (file: File) => string;
  revokeUrl: (url: string) => void;
}

/** What the engine reports outward. State flows engine → state → components. */
export interface TtAudioEvents {
  onLog: (code: TtAudioLogCode, detail?: Record<string, number | string>) => void;
  /** A wrap was detected on the hard loop — docs/03 §2's "Loop ×N". */
  onLoop: (count: number) => void;
  onStatus: (status: TtPlaybackStatus) => void;
}

export type TtPlaybackStatus = 'idle' | 'playing' | 'paused' | 'blocked' | 'error';
