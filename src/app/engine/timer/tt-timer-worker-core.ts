/**
 * The timer worker's logic, without the worker — docs/04 §2 (v2.0).
 *
 * `tt-timer.worker.ts` used to be the logic. It is now the wiring: it hands
 * this core the worker's real clock, `postMessage`, timers and `Notification`,
 * and everything that decides anything lives here, where a unit test can drive
 * it with fakes. Pure TS, no DOM, no Svelte (docs/12 §3.1).
 *
 * ## The finish notification (spike S5, `15 §S5`)
 *
 * The tick stays the 200 ms derived one: `remaining = endAt − now()` every
 * time, so a throttled interval reports the truth rather than a count of how
 * often it ran (`04 §1`). What v2.0 adds is what S5 measured: at the deadline,
 * if the page last said it was hidden and a notice is armed, THIS worker shows
 * the notification — 40/40 on time across four browsers, where the page itself
 * may not run for minutes (S2). The page arms the notice, reports visibility,
 * and dismisses the notification when its user comes back.
 *
 * Where the worker has no `Notification` (Safari), or permission is gone, it
 * says so and the page decides what is left to do.
 */

/** What the notification says. Generic by rule: never a title or file name. */
export interface TtFinishNotice {
  title: string;
  body: string;
  tag: string;
  lang: string;
  icon: string;
}

export type TtWorkerIn =
  | { type: 'start'; endAtEpoch: number }
  | { type: 'stop' }
  | { type: 'visibility'; hidden: boolean }
  | { type: 'notice'; notice: TtFinishNotice | null }
  | { type: 'dismiss' };

export type TtWorkerOut =
  | { type: 'tick'; remainingMs: number }
  | { type: 'done' }
  | { type: 'notified' }
  | { type: 'notifyFailed'; reason: 'unsupported' | 'denied' | 'error' }
  | { type: 'notificationClick' };

/** The part of a shown `Notification` the core touches. */
export interface TtShownNotice {
  close(): void;
  onclick: ((ev: Event) => unknown) | null;
}

export interface TtWorkerPorts {
  now(): number;
  post(msg: TtWorkerOut): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  /** `new Notification(...)` — or null where this worker has none (Safari). */
  notify: ((notice: TtFinishNotice) => TtShownNotice) | null;
  permission(): string;
}

const TT_TICK_MS = 200;

export interface TtTimerWorkerCore {
  handle(msg: TtWorkerIn): void;
}

export function createTimerWorkerCore(ports: TtWorkerPorts): TtTimerWorkerCore {
  let handle: unknown = null;
  let endAtEpoch: number | null = null;
  /** docs/04 §6: exactly once, ever, per run. */
  let doneFired = false;
  /** Until told otherwise the page is in front — a notice is for its absence. */
  let hidden = false;
  let notice: TtFinishNotice | null = null;
  let shown: TtShownNotice | null = null;

  function stop(): void {
    if (handle !== null) {
      ports.clearInterval(handle);
      handle = null;
    }
    endAtEpoch = null;
  }

  function dismiss(): void {
    shown?.close();
    shown = null;
  }

  /** At the deadline: one notification, only if the page is away and asked. */
  function announce(): void {
    if (notice === null || !hidden) return;
    if (ports.notify === null) {
      ports.post({ type: 'notifyFailed', reason: 'unsupported' });
      return;
    }
    if (ports.permission() !== 'granted') {
      ports.post({ type: 'notifyFailed', reason: 'denied' });
      return;
    }
    try {
      dismiss();
      const n = ports.notify(notice);
      n.onclick = () => {
        ports.post({ type: 'notificationClick' });
        n.close();
        if (shown === n) shown = null;
      };
      shown = n;
      ports.post({ type: 'notified' });
    } catch {
      ports.post({ type: 'notifyFailed', reason: 'error' });
    }
  }

  function tick(): void {
    if (endAtEpoch === null) return;
    // Derived, never accumulated — see the module note.
    const remainingMs = Math.max(0, endAtEpoch - ports.now());
    ports.post({ type: 'tick', remainingMs });

    if (remainingMs <= 0 && !doneFired) {
      doneFired = true;
      ports.post({ type: 'done' });
      announce();
      stop();
    }
  }

  return {
    handle(msg) {
      switch (msg.type) {
        case 'start':
          stop();
          doneFired = false;
          endAtEpoch = msg.endAtEpoch;
          handle = ports.setInterval(tick, TT_TICK_MS);
          tick(); // report immediately rather than after the first interval
          break;
        case 'stop':
          stop();
          break;
        case 'visibility':
          hidden = msg.hidden;
          break;
        case 'notice':
          notice = msg.notice;
          break;
        case 'dismiss':
          dismiss();
          break;
      }
    },
  };
}
