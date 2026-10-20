import { describe, expect, it } from 'vitest';
import {
  createTimerWorkerCore,
  type TtFinishNotice,
  type TtShownNotice,
  type TtWorkerOut,
  type TtWorkerPorts,
} from '../../src/app/engine/timer/tt-timer-worker-core';

/**
 * The timer worker's decisions — docs/04 §2, v2.0's finish notification
 * (spike S5, docs/15 §S5).
 *
 * What S5 measured is the worker keeping time while hidden; what this pins is
 * everything the worker DECIDES around that: one notification, only when the
 * page is away at zero and asked for one, never for a stopped or paused run,
 * closed when the page comes back — and an honest failure where it cannot.
 */

const NOTICE: TtFinishNotice = {
  title: 'TickTune',
  body: 'Time is up',
  tag: 'ticktune-finish',
  lang: 'en',
  icon: '/icons/icon-192.png',
};

function rig(opts: { notify?: boolean; permission?: string; throws?: boolean } = {}) {
  let now = 1_000_000;
  let interval: (() => void) | null = null;
  const posts: TtWorkerOut[] = [];
  const shown: Array<TtShownNotice & { notice: TtFinishNotice; closed: boolean }> = [];
  const ports: TtWorkerPorts = {
    now: () => now,
    post: (m) => posts.push(m),
    setInterval: (fn) => {
      interval = fn;
      return 1;
    },
    clearInterval: () => {
      interval = null;
    },
    notify:
      opts.notify === false
        ? null
        : (notice) => {
            if (opts.throws) throw new TypeError('Illegal constructor');
            const n = {
              notice,
              closed: false,
              onclick: null as TtShownNotice['onclick'],
              close() {
                n.closed = true;
              },
            };
            shown.push(n);
            return n;
          },
    permission: () => opts.permission ?? 'granted',
  };
  const core = createTimerWorkerCore(ports);
  return {
    core,
    posts,
    shown,
    /** Move the clock and run one interval tick, as the worker would. */
    advance(ms: number) {
      now += ms;
      interval?.();
    },
    start(inMs: number) {
      core.handle({ type: 'start', endAtEpoch: now + inMs });
    },
    types: () => posts.map((p) => p.type).filter((t) => t !== 'tick'),
  };
}

describe('the tick — unchanged by v2.0', () => {
  it('derives the remaining time and fires done exactly once', () => {
    const r = rig();
    r.start(1_000);
    expect(r.posts[0]).toEqual({ type: 'tick', remainingMs: 1_000 });
    r.advance(600);
    r.advance(600);
    r.advance(600);
    expect(r.types()).toEqual(['done']);
    expect(r.posts.filter((p) => p.type === 'tick').at(-1)).toEqual({
      type: 'tick',
      remainingMs: 0,
    });
  });
});

describe('the finish notification — docs/04 §2', () => {
  it('hidden at zero with a notice armed: exactly one, with the notice as given', () => {
    const r = rig();
    r.core.handle({ type: 'notice', notice: NOTICE });
    r.core.handle({ type: 'visibility', hidden: true });
    r.start(1_000);
    r.advance(1_000);
    r.advance(1_000); // a late tick must not notify twice
    expect(r.shown).toHaveLength(1);
    expect(r.shown[0]!.notice).toEqual(NOTICE);
    expect(r.types()).toEqual(['done', 'notified']);
  });

  it('visible at zero: none — the page is right there', () => {
    const r = rig();
    r.core.handle({ type: 'notice', notice: NOTICE });
    r.core.handle({ type: 'visibility', hidden: false });
    r.start(1_000);
    r.advance(1_000);
    expect(r.shown).toHaveLength(0);
    expect(r.types()).toEqual(['done']);
  });

  it('it is the visibility AT ZERO that counts, not at the start', () => {
    const r = rig();
    r.core.handle({ type: 'notice', notice: NOTICE });
    r.core.handle({ type: 'visibility', hidden: true });
    r.start(1_000);
    r.core.handle({ type: 'visibility', hidden: false }); // came back before zero
    r.advance(1_000);
    expect(r.shown).toHaveLength(0);
  });

  it('no notice armed: none, hidden or not', () => {
    const r = rig();
    r.core.handle({ type: 'visibility', hidden: true });
    r.start(1_000);
    r.advance(1_000);
    expect(r.shown).toHaveLength(0);
    expect(r.types()).toEqual(['done']);
  });

  it('a disarmed notice (pause, stop, back) stays silent', () => {
    const r = rig();
    r.core.handle({ type: 'notice', notice: NOTICE });
    r.core.handle({ type: 'notice', notice: null });
    r.core.handle({ type: 'visibility', hidden: true });
    r.start(1_000);
    r.advance(1_000);
    expect(r.shown).toHaveLength(0);
  });

  it('a stopped run never reaches zero, so never notifies', () => {
    const r = rig();
    r.core.handle({ type: 'notice', notice: NOTICE });
    r.core.handle({ type: 'visibility', hidden: true });
    r.start(1_000);
    r.core.handle({ type: 'stop' });
    r.advance(5_000);
    expect(r.shown).toHaveLength(0);
    expect(r.types()).toEqual([]);
  });

  it('a re-anchored deadline (TT-SYS-201) still gives exactly one, at the new time', () => {
    const r = rig();
    r.core.handle({ type: 'notice', notice: NOTICE });
    r.core.handle({ type: 'visibility', hidden: true });
    r.start(1_000);
    r.advance(500);
    r.start(2_000); // the driver re-sends the deadline after a clock jump
    r.advance(1_000);
    expect(r.shown).toHaveLength(0);
    r.advance(1_000);
    expect(r.shown).toHaveLength(1);
  });

  it('dismiss closes it — the user came back', () => {
    const r = rig();
    r.core.handle({ type: 'notice', notice: NOTICE });
    r.core.handle({ type: 'visibility', hidden: true });
    r.start(1_000);
    r.advance(1_000);
    r.core.handle({ type: 'dismiss' });
    expect(r.shown[0]!.closed).toBe(true);
  });

  it('a click is reported to the page and closes the notification', () => {
    const r = rig();
    r.core.handle({ type: 'notice', notice: NOTICE });
    r.core.handle({ type: 'visibility', hidden: true });
    r.start(1_000);
    r.advance(1_000);
    r.shown[0]!.onclick?.(new Event('click'));
    expect(r.types()).toEqual(['done', 'notified', 'notificationClick']);
    expect(r.shown[0]!.closed).toBe(true);
  });
});

describe('where the worker cannot — the page decides what is left', () => {
  it('no Notification in this worker (Safari): says so', () => {
    const r = rig({ notify: false });
    r.core.handle({ type: 'notice', notice: NOTICE });
    r.core.handle({ type: 'visibility', hidden: true });
    r.start(1_000);
    r.advance(1_000);
    expect(r.posts).toContainEqual({ type: 'notifyFailed', reason: 'unsupported' });
  });

  it('permission gone: says so rather than throwing', () => {
    const r = rig({ permission: 'denied' });
    r.core.handle({ type: 'notice', notice: NOTICE });
    r.core.handle({ type: 'visibility', hidden: true });
    r.start(1_000);
    r.advance(1_000);
    expect(r.shown).toHaveLength(0);
    expect(r.posts).toContainEqual({ type: 'notifyFailed', reason: 'denied' });
  });

  it('a constructor that throws is an error report, and done still fired first', () => {
    const r = rig({ throws: true });
    r.core.handle({ type: 'notice', notice: NOTICE });
    r.core.handle({ type: 'visibility', hidden: true });
    r.start(1_000);
    r.advance(1_000);
    expect(r.types()).toEqual(['done', 'notifyFailed']);
    expect(r.posts).toContainEqual({ type: 'notifyFailed', reason: 'error' });
  });
});
