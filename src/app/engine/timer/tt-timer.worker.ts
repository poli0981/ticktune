/// <reference lib="webworker" />

/**
 * Authoritative tick source — docs/04 §2.
 *
 * Lives here rather than in a separate src/workers/ so the timer engine stays
 * one self-contained, framework-free unit (docs/01 §3-4).
 *
 * Why a worker at all: it fires the `done` event, so the End Behavior still
 * runs when the tab is hidden and the main thread's rAF loop has stopped.
 *
 * ⚠️ Honest caveat (docs/04 §2): being a worker is NOT an unconditional escape
 * from throttling — Chromium's intensive wake-up throttling of hidden pages
 * reaches their dedicated workers too, and the reliable exemption is the tab
 * being *audible*. TickTune has documented hidden-and-silent states, so the
 * main thread ALSO latches on visibilitychange/focus. Spike S2 measures the
 * real numbers; a late `done` is recoverable, a missed one is not.
 */

const TICK_MS = 200;

type InMsg = { type: 'start'; endAtEpoch: number } | { type: 'stop' };
type OutMsg = { type: 'tick'; remainingMs: number } | { type: 'done' };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let handle: ReturnType<typeof setInterval> | null = null;
let endAtEpoch: number | null = null;
/** docs/04 §6: exactly once, ever, per run. */
let doneFired = false;

function post(msg: OutMsg): void {
  ctx.postMessage(msg);
}

function stop(): void {
  if (handle !== null) {
    clearInterval(handle);
    handle = null;
  }
  endAtEpoch = null;
}

function tick(): void {
  if (endAtEpoch === null) return;
  // Derived, never accumulated — so a throttled interval reports the truth
  // rather than a count of how many times it managed to run.
  const remainingMs = Math.max(0, endAtEpoch - Date.now());
  post({ type: 'tick', remainingMs });

  if (remainingMs <= 0 && !doneFired) {
    doneFired = true;
    post({ type: 'done' });
    stop();
  }
}

ctx.addEventListener('message', (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'start') {
    stop();
    doneFired = false;
    endAtEpoch = msg.endAtEpoch;
    handle = setInterval(tick, TICK_MS);
    tick(); // report immediately rather than after the first interval
  } else if (msg.type === 'stop') {
    stop();
  }
});
