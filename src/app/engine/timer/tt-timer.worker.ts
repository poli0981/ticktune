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
 *
 * v2.0: only the wiring is left here. The logic — the derived tick, the
 * exactly-once `done`, and the finish notification spike S5 measured — is
 * `tt-timer-worker-core.ts`, which a unit test can drive with fakes.
 */

import { createTimerWorkerCore, type TtWorkerIn } from './tt-timer-worker-core';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const hasNotification = typeof Notification !== 'undefined';

const core = createTimerWorkerCore({
  now: () => Date.now(),
  post: (msg) => ctx.postMessage(msg),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  // Safari has no Notification in a worker; the page takes over (`04 §2`).
  notify: hasNotification
    ? (n) => new Notification(n.title, { body: n.body, tag: n.tag, lang: n.lang, icon: n.icon })
    : null,
  permission: () => (hasNotification ? Notification.permission : 'unsupported'),
});

ctx.addEventListener('message', (e: MessageEvent<TtWorkerIn>) => core.handle(e.data));
