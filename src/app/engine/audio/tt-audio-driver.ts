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

export class TtAudioDriver {
  readonly #ctx: AudioContext;
  readonly #elements: HTMLAudioElement[] = [];
  readonly #deckGains: GainNode[] = [];
  readonly #userGain: GainNode;
  readonly #fadeGain: GainNode;
  readonly #analyser: AnalyserNode;
  readonly #chimeGain: GainNode;
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
    this.#ctx = new AudioContext();
    this.#userGain = this.#ctx.createGain();
    this.#fadeGain = this.#ctx.createGain();
    // docs/05 §7: straight to destination, bypassing BOTH userGain and
    // fadeGain — the fade is running when the chime fires, and routing the
    // attention signal through it would fade the signal out too.
    this.#chimeGain = this.#ctx.createGain();
    this.#chimeGain.gain.value = 0;
    this.#chimeGain.connect(this.#ctx.destination);
    this.#analyser = this.#ctx.createAnalyser();
    this.#analyser.fftSize = FFT_SIZE;
    // Backed by an explicit ArrayBuffer: `getByteTimeDomainData` is typed
    // `Uint8Array<ArrayBuffer>`, and the bare constructor widens to
    // `ArrayBufferLike`, which does not satisfy it.
    this.#rmsBuffer = new Uint8Array(new ArrayBuffer(FFT_SIZE));

    this.#userGain.connect(this.#fadeGain).connect(this.#analyser).connect(this.#ctx.destination);

    // Both decks are built ONCE, up front: createMediaElementSource may be
    // called only once per element, so the engine swaps `.src` rather than
    // creating nodes per track. Building them lazily throws on the second load.
    for (const id of [0, 1] as const) {
      const el = new Audio();
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      const gain = this.#ctx.createGain();
      gain.gain.value = 0;
      this.#ctx.createMediaElementSource(el).connect(gain).connect(this.#userGain);

      el.addEventListener('timeupdate', () => this.#engine.onTimeUpdate());
      el.addEventListener('error', () => this.#engine.onMediaError());
      // Playlist advance (docs/02 §5). Forwarded only — every decision about
      // what plays next lives in the engine and the play-order module, because
      // this file is excluded from the coverage gate by name (docs/13 §1) and
      // logic parked here would be silently untested.
      el.addEventListener('ended', () => this.#engine.onEnded());

      this.#elements[id] = el;
      this.#deckGains[id] = gain;
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
    this.#analyser.getByteTimeDomainData(this.#rmsBuffer);
    let sum = 0;
    for (const v of this.#rmsBuffer) {
      const d = (v - 128) / 128;
      sum += d * d;
    }
    return Math.sqrt(sum / this.#rmsBuffer.length);
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
    void this.#ctx.close();
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
      status === 'blocked' ? 'blocked' : this.#ctx.state === 'running' ? 'running' : 'suspended';
  }

  #gainPort(node: GainNode): TtGainPort {
    return {
      get value() {
        return node.gain.value;
      },
      setValue: (v, t) => node.gain.setValueAtTime(v, t),
      setCurve: (values, start, duration) => node.gain.setValueCurveAtTime(values, start, duration),
      cancelScheduled: (from) => node.gain.cancelScheduledValues(from),
    };
  }

  #mediaPort(el: HTMLAudioElement): TtMediaPort {
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

  #ports(): TtAudioPorts {
    const ctx = this.#ctx;
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
          this.#publishState();
        },
      },
      deck: (id: TtDeckId) => this.#mediaPort(this.#elements[id]!),
      deckGain: (id: TtDeckId) => this.#gainPort(this.#deckGains[id]!),
      userGain: this.#gainPort(this.#userGain),
      fadeGain: this.#gainPort(this.#fadeGain),
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
    const plan = planEndBehavior(cfg, muted, this.#ctx.currentTime);
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
    plan.notes.forEach((note, i) => {
      const osc = this.#ctx.createOscillator();
      const env = this.#ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.hz, note.startS);

      env.gain.setValueAtTime(0, note.startS);
      env.gain.linearRampToValueAtTime(note.peak, note.startS + 0.01);
      // exponentialRamp cannot reach 0, so decay to a floor and stop.
      env.gain.exponentialRampToValueAtTime(0.0001, note.stopS);

      osc.connect(env).connect(this.#chimeGain);
      this.#chimeGain.gain.setValueAtTime(1, note.startS);

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
