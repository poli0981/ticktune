import { TtAudioEngine } from './tt-audio-engine';
import { restoreFadeGain } from './tt-audio-graph';
import type { TtChimePlan } from './tt-chime';
import { planEndBehavior, runEndBehavior, type TtEndConfig } from './tt-end-behavior';
import type { TtAudioEvents, TtAudioPorts, TtDeckId, TtGainPort, TtMediaPort } from './types';

/**
 * The whole impure surface of the audio engine — docs/05 §1.
 *
 * Named `*-driver.ts` deliberately: `vitest.config.ts` excludes that pattern
 * from the engine coverage gate, because unit-testing this file would mean
 * mocking every Web Audio API and then asserting the mocks (docs/13 §1's
 * carve-out). It is covered where it actually runs — Playwright.
 *
 * Everything that DECIDES anything lives in `tt-audio-engine.ts` and its pure
 * siblings; this file only wires.
 */

/** docs/05 §6 — sized here so the analyser exists from the first play. */
const FFT_SIZE = 2048;

/**
 * The docs/05 §1 graph, built once:
 *
 *   <audio>[i] → MediaElementSource → deckGain[i] → userGain → fadeGain → Analyser → destination
 *   chime oscillators → chimeGain → destination
 *
 * Exported with `buildTtGraph` and `ttGraphPorts` so spike S4b measures THIS
 * graph rather than a hand-built copy of it — the old harness built one master
 * gain where the app has two, and could not see the very collision docs/05 §1
 * splits them to avoid.
 */
export interface TtGraph {
  readonly ctx: AudioContext;
  readonly elements: readonly [HTMLAudioElement, HTMLAudioElement];
  /** The pre-gain taps — only spike S4b reads them. */
  readonly sources: readonly [MediaElementAudioSourceNode, MediaElementAudioSourceNode];
  readonly deckGains: readonly [GainNode, GainNode];
  readonly userGain: GainNode;
  readonly fadeGain: GainNode;
  readonly analyser: AnalyserNode;
  readonly chimeGain: GainNode;
}

export function buildTtGraph(ctx: AudioContext): TtGraph {
  const userGain = ctx.createGain();
  const fadeGain = ctx.createGain();
  // docs/05 §7: straight to destination, bypassing BOTH userGain and
  // fadeGain — the fade is running when the chime fires, and routing the
  // attention signal through it would fade the signal out too.
  const chimeGain = ctx.createGain();
  chimeGain.gain.value = 0;
  chimeGain.connect(ctx.destination);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;

  userGain.connect(fadeGain).connect(analyser).connect(ctx.destination);

  // Both decks are built ONCE, up front: createMediaElementSource may be
  // called only once per element, so the engine swaps `.src` rather than
  // creating nodes per track. Building them lazily throws on the second load.
  const deck = () => {
    const el = new Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const source = ctx.createMediaElementSource(el);
    source.connect(gain).connect(userGain);
    return { el, gain, source };
  };
  const a = deck();
  const b = deck();

  return {
    ctx,
    elements: [a.el, b.el],
    sources: [a.source, b.source],
    deckGains: [a.gain, b.gain],
    userGain,
    fadeGain,
    analyser,
    chimeGain,
  };
}

function gainPort(node: GainNode): TtGainPort {
  return {
    get value() {
      return node.gain.value;
    },
    setValue: (v, t) => node.gain.setValueAtTime(v, t),
    setCurve: (values, start, duration) => node.gain.setValueCurveAtTime(values, start, duration),
    cancelScheduled: (from) => node.gain.cancelScheduledValues(from),
  };
}

function mediaPort(el: HTMLAudioElement): TtMediaPort {
  return {
    setSrc: (url) => {
      el.src = url;
    },
    play: () => el.play(),
    pause: () => el.pause(),
    setLoop: (loop) => {
      el.loop = loop;
    },
    get currentTimeS() {
      return el.currentTime;
    },
    get durationS() {
      return el.duration;
    },
  };
}

/** The engine's ports over a built graph. `onResume` runs after `ctx.resume()`. */
export function ttGraphPorts(graph: TtGraph, onResume: () => void = () => {}): TtAudioPorts {
  const ctx = graph.ctx;
  return {
    ctx: {
      get nowS() {
        return ctx.currentTime;
      },
      get state() {
        return ctx.state as 'suspended' | 'running' | 'closed';
      },
      resume: async () => {
        await ctx.resume();
        onResume();
      },
    },
    deck: (id: TtDeckId) => mediaPort(graph.elements[id]),
    deckGain: (id: TtDeckId) => gainPort(graph.deckGains[id]),
    userGain: gainPort(graph.userGain),
    fadeGain: gainPort(graph.fadeGain),
    createUrl: (source) => URL.createObjectURL(source),
    revokeUrl: (url) => {
      URL.revokeObjectURL(url);
    },
    delay: (ms) =>
      new Promise((resolve) => {
        window.setTimeout(resolve, ms);
      }),
  };
}

export class TtAudioDriver {
  readonly #graph: TtGraph;
  readonly #engine: TtAudioEngine;
  readonly #events: TtAudioEvents;
  // The type argument is load-bearing: `getByteTimeDomainData` takes a
  // `Uint8Array<ArrayBuffer>`, and a bare `Uint8Array` widens to
  // `ArrayBufferLike`, which admits SharedArrayBuffer and does not satisfy it.
  readonly #rmsBuffer: Uint8Array<ArrayBuffer>;
  #disposed = false;

  constructor(events: TtAudioEvents) {
    this.#events = events;
    // docs/05 §1: created at boot, resumed only on a gesture. Constructing it
    // suspended is correct and expected — `unlock()` is what changes that.
    this.#graph = buildTtGraph(new AudioContext());
    // Backed by an explicit ArrayBuffer: `getByteTimeDomainData` is typed
    // `Uint8Array<ArrayBuffer>`, and the bare constructor widens to
    // `ArrayBufferLike`, which does not satisfy it.
    this.#rmsBuffer = new Uint8Array(new ArrayBuffer(FFT_SIZE));

    for (const el of this.#graph.elements) {
      el.addEventListener('timeupdate', () => this.#engine.onTimeUpdate());
      el.addEventListener('error', () => this.#engine.onMediaError());
      // Playlist advance (docs/02 §5). Forwarded only — every decision about
      // what plays next lives in the engine and the play-order module, because
      // this file is excluded from the coverage gate by name (docs/13 §1) and
      // logic parked here would be silently untested.
      el.addEventListener('ended', () => this.#engine.onEnded());
    }

    this.#engine = new TtAudioEngine(this.#ports(), events);
    this.#publishState();

    window.addEventListener('pagehide', this.#onPageHide);
  }

  get engine(): TtAudioEngine {
    return this.#engine;
  }

  /** Peak RMS of the current analyser frame — the E2E "is it audible" seam. */
  get peakRms(): number {
    this.#graph.analyser.getByteTimeDomainData(this.#rmsBuffer);
    let sum = 0;
    for (const v of this.#rmsBuffer) {
      const d = (v - 128) / 128;
      sum += d * d;
    }
    return Math.sqrt(sum / this.#rmsBuffer.length);
  }

  /**
   * How many frequency bins a frame carries — `fftSize / 2` (docs/05 §6).
   *
   * Published so the visualizer can size its buffer ONCE rather than allocating
   * per frame. A 1 KB allocation sixty times a second is exactly the kind of
   * pressure that shows up later as the jank the adaptive-degrade path is
   * trying to explain.
   */
  get binCount(): number {
    return this.#graph.analyser.frequencyBinCount;
  }

  /**
   * Fill a caller-supplied buffer with the current frame — docs/05 §6.
   *
   * Fill rather than return, for the allocation reason above, and a pair of
   * plain methods rather than exposing the `AnalyserNode` because docs/12 §3.2
   * keeps Web Audio types out of every component. What crosses this seam is a
   * byte array; `tt-visualizer.ts` turns it into numbers to draw, and it is
   * pure precisely because this method is the only impure part.
   */
  readFrequencyData(into: Uint8Array<ArrayBuffer>): void {
    this.#graph.analyser.getByteFrequencyData(into);
  }

  readTimeDomainData(into: Uint8Array<ArrayBuffer>): void {
    this.#graph.analyser.getByteTimeDomainData(into);
  }

  /**
   * MUST be called synchronously inside the gesture handler, before any
   * `await` — WebKit does not count a resume that happens after the task has
   * yielded (docs/05 §1).
   */
  async unlock(): Promise<void> {
    await this.#engine.unlock();
    this.#publishState();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    window.removeEventListener('pagehide', this.#onPageHide);
    this.#engine.dispose();
    void this.#graph.ctx.close();
  }

  /** docs/05 §3: object URLs are revoked on pagehide. */
  #onPageHide = (): void => {
    this.#engine.dispose();
  };

  /**
   * The seam E2E observes (docs/13 §3). Without it, "the fixture plays" passes
   * identically on a silently-suspended context.
   */
  #publishState(): void {
    const status = this.#engine.status;
    document.documentElement.dataset['ttAudio'] =
      status === 'blocked'
        ? 'blocked'
        : this.#graph.ctx.state === 'running'
          ? 'running'
          : 'suspended';
  }

  #ports(): TtAudioPorts {
    return ttGraphPorts(this.#graph, () => this.#publishState());
  }

  /** Re-arm the fade stage after a run — Restart and Back both need it. */
  resetFade(): void {
    restoreFadeGain(this.#ports());
  }

  /**
   * docs/02 §5 — the End Behavior, committed to the audio clock in one
   * synchronous block so it survives the main thread stalling right after
   * (docs/04 §2). Returns the plan so the caller can act on `endAction`.
   */
  runEndBehavior(cfg: TtEndConfig, muted: boolean): ReturnType<typeof planEndBehavior> {
    const plan = planEndBehavior(cfg, muted, this.#graph.ctx.currentTime);
    runEndBehavior(plan, this.#ports(), {
      scheduleChime: (chime) => this.#scheduleChime(chime),
      onLog: (code) => this.#events.onLog(code),
    });

    // The seam docs/13 §3 asserts instead of "a chime file was requested" —
    // there is no request to observe now, and "it ran" is the stronger claim.
    document.documentElement.dataset['ttChimeSched'] = plan.chime
      ? String(Math.round(plan.chime.endsAtS * 1000))
      : '';

    const fadeEndsMs = plan.fadeMs;
    window.setTimeout(() => {
      document.documentElement.dataset['ttFadeDone'] = String(Date.now());
    }, fadeEndsMs);

    return plan;
  }

  /**
   * Two oscillators with a decaying envelope, scheduled and forgotten.
   *
   * `onended` on the last note is what increments the count, so the seam
   * asserts the chime actually SOUNDED rather than that it was scheduled — a
   * suspended context schedules happily and plays nothing.
   */
  #scheduleChime(plan: TtChimePlan): void {
    const ctx = this.#graph.ctx;
    plan.notes.forEach((note, i) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.hz, note.startS);

      env.gain.setValueAtTime(0, note.startS);
      env.gain.linearRampToValueAtTime(note.peak, note.startS + 0.01);
      // exponentialRamp cannot reach 0, so decay to a floor and stop.
      env.gain.exponentialRampToValueAtTime(0.0001, note.stopS);

      osc.connect(env).connect(this.#graph.chimeGain);
      this.#graph.chimeGain.gain.setValueAtTime(1, note.startS);

      osc.start(note.startS);
      osc.stop(note.stopS);

      if (i === plan.notes.length - 1) {
        osc.onended = () => {
          const el = document.documentElement;
          el.dataset['ttChimeCount'] = String(Number(el.dataset['ttChimeCount'] ?? 0) + 1);
        };
      }
    });
  }

  /** Publishes the status seam after any engine call that can change it. */
  refresh(): void {
    this.#publishState();
  }
}
