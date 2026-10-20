/**
 * Spike S4b probe — one AudioWorklet per measured stage (docs/15 §S4).
 *
 * Input 0 is the signal BEFORE the gain under test, input 1 the signal AFTER
 * it. For every 128-frame render quantum it reports the mean square of each,
 * the largest second difference after the gain (continuous across blocks, so a
 * step at a block edge is not missed) and the clipped-sample count — exact to
 * the frame, which polling an Analyser from rAF never was.
 *
 * Loaded with Vite's `?worker&url`; its globals are declared here rather than
 * pulled in as a dependency.
 */

declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  ctor: new (options?: unknown) => AudioWorkletProcessor,
): void;

interface Block {
  f: number;
  pre: number;
  post: number;
  d2: number;
  clip: number;
}

const BATCH = 32;

function meanSquare(chans: Float32Array[]): number {
  let s = 0;
  let n = 0;
  for (const ch of chans) {
    for (const v of ch) s += v * v;
    n += ch.length;
  }
  return n ? s / n : 0;
}

class TtS4bProbe extends AudioWorkletProcessor {
  #batch: Block[] = [];
  #x1 = 0;
  #x2 = 0;
  #on = true;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<string>) => {
      if (e.data === 'reset') {
        this.#batch = [];
      } else if (e.data === 'flush') {
        this.#flush();
        this.port.postMessage('flushed');
      } else if (e.data === 'stop') {
        this.#flush();
        this.#on = false;
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.#on) return false;
    const pre = inputs[0] ?? [];
    const post = inputs[1] ?? [];

    let clip = 0;
    for (const ch of post) for (const v of ch) if (Math.abs(v) >= 0.999) clip++;

    let d2 = 0;
    const c0 = post[0];
    if (c0) {
      let x1 = this.#x1;
      let x2 = this.#x2;
      for (const x of c0) {
        const d = Math.abs(x - 2 * x1 + x2);
        if (d > d2) d2 = d;
        x2 = x1;
        x1 = x;
      }
      this.#x1 = x1;
      this.#x2 = x2;
    } else {
      // A silent input arrives with no channels: the next sample follows zeros.
      this.#x1 = 0;
      this.#x2 = 0;
    }

    this.#batch.push({ f: currentFrame, pre: meanSquare(pre), post: meanSquare(post), d2, clip });
    if (this.#batch.length >= BATCH) this.#flush();
    return true;
  }

  #flush(): void {
    if (this.#batch.length === 0) return;
    this.port.postMessage(this.#batch);
    this.#batch = [];
  }
}

registerProcessor('tt-s4b-probe', TtS4bProbe);
