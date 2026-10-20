import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtTimerDriver } from '../../src/app/engine/timer/tt-timer-driver';

/**
 * The driver's side of the worker contract — docs/04 §1-2.
 *
 * The core is pure and tested on its own (tt-timer.test.ts). What only the
 * driver can get wrong is the WIRING: which deadline the worker holds. Until
 * v1.1.1 a TT-SYS-201 re-anchor moved the core's deadline and never told the
 * worker, so a forward clock jump ran the worker's stale copy out early — it
 * posted `done`, stopped, and a visible tab sat at 0.000.
 *
 * A stand-in Worker records what the driver posts and lets a test speak for
 * the worker. Both clocks are faked: `setSystemTime` moves the wall clock
 * alone — exactly how a clock change looks from inside the page — while
 * `advanceTimersByTime` moves both, which is real time passing.
 */

type Msg = { type: 'start'; endAtEpoch: number } | { type: 'stop' };

class FakeWorker {
  static last: FakeWorker | null = null;
  readonly posted: Msg[] = [];
  readonly #listeners = new Map<string, Array<(e: { data: unknown }) => void>>();

  constructor() {
    FakeWorker.last = this;
  }
  addEventListener(type: string, fn: (e: { data: unknown }) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), fn]);
  }
  postMessage(msg: Msg): void {
    this.posted.push(msg);
  }
  terminate(): void {}
  /** The worker speaking: a tick or a done, as tt-timer.worker.ts posts them. */
  say(data: { type: 'tick'; remainingMs: number } | { type: 'done' }): void {
    for (const fn of this.#listeners.get('message') ?? []) fn({ data });
  }
  lastStart(): number | undefined {
    const starts = this.posted.filter((m) => m.type === 'start');
    return starts.at(-1)?.endAtEpoch;
  }
}

let driver: TtTimerDriver | null = null;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  vi.setSystemTime(1_800_000_000_000);
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  driver?.dispose();
  driver = null;
  FakeWorker.last = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function make() {
  const onDone = vi.fn();
  const logs: string[] = [];
  driver = new TtTimerDriver({
    onRemaining: () => {},
    onDone,
    onLog: (code) => logs.push(code),
  });
  const worker = FakeWorker.last;
  if (!worker) throw new Error('the driver did not create its worker eagerly');
  return { driver, worker, onDone, logs };
}

describe('the re-anchored deadline reaches the worker — docs/04 §1', () => {
  it('re-sends the shifted deadline when the wall clock jumps forward', () => {
    const { driver, worker, onDone, logs } = make();
    driver.start(10_000);
    const original = worker.lastStart();
    expect(original).toBe(1_800_000_000_000 + 10_000);

    worker.say({ type: 'tick', remainingMs: 10_000 }); // primes both clock samples
    vi.setSystemTime(Date.now() + 60_000); // the user moves the clock 1 min ahead
    worker.say({ type: 'done' }); // the worker's stale copy ran out early

    expect(logs).toContain('TT-SYS-201');
    expect(worker.lastStart()).toBe((original ?? 0) + 60_000);
    expect(onDone).not.toHaveBeenCalled();
    expect(driver.phase).toBe('running');
  });

  it('a throttling gap is not a jump, and sends nothing new', () => {
    const { driver, worker } = make();
    driver.start(10_000);
    worker.say({ type: 'tick', remainingMs: 10_000 });
    const starts = worker.posted.length;

    worker.say({ type: 'tick', remainingMs: 9_800 });
    expect(worker.posted).toHaveLength(starts);
  });
});

describe('an unexplained early done — the TT-SYS-208 safety net', () => {
  it('re-sends the deadline and logs TT-SYS-208 once', () => {
    const { driver, worker, onDone, logs } = make();
    driver.start(10_000);
    worker.say({ type: 'tick', remainingMs: 10_000 });
    const starts = worker.posted.filter((m) => m.type === 'start').length;

    worker.say({ type: 'done' }); // no jump: the worker is simply wrong

    expect(onDone).not.toHaveBeenCalled();
    expect(worker.posted.filter((m) => m.type === 'start')).toHaveLength(starts + 1);
    expect(logs.filter((c) => c === 'TT-SYS-208')).toHaveLength(1);
  });

  it('is rate-limited, so a worker stuck saying done cannot spin', () => {
    const { driver, worker, logs } = make();
    driver.start(10_000);
    worker.say({ type: 'tick', remainingMs: 10_000 });
    const before = worker.posted.length;

    worker.say({ type: 'done' });
    worker.say({ type: 'done' });
    worker.say({ type: 'done' });

    expect(worker.posted.length - before).toBe(1);
    expect(logs.filter((c) => c === 'TT-SYS-208')).toHaveLength(1);
  });

  it('a real done still finishes, and never triggers the net', () => {
    const { driver, worker, onDone, logs } = make();
    driver.start(1_000);
    worker.say({ type: 'tick', remainingMs: 1_000 });
    vi.advanceTimersByTime(1_000); // fake Date moves with the timers
    worker.say({ type: 'done' });

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(logs).not.toContain('TT-SYS-208');
  });
});
