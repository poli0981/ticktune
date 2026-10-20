/// <reference lib="webworker" />

/**
 * Spike S5 worker — docs/15 §S5.
 *
 * The question: does a notification created by a DEDICATED WORKER at the
 * deadline arrive on time while the tab is hidden and silent? S2 measured the
 * main thread finishing minutes late and only inferred that the worker kept
 * time. This worker keeps the same 200 ms derived tick as tt-timer.worker.ts,
 * records the gaps between its own ticks (the number S2 never had), and at the
 * deadline calls `new Notification()` itself if the page last said it was
 * hidden. Results go to IndexedDB from HERE, so a discarded tab still reports.
 *
 * Throwaway: a harness, not the feature.
 */

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const TICK_MS = 200;

interface Start {
  type: 'start';
  runId: string;
  endAtEpoch: number;
  minutes: number;
  notify: boolean;
  hidden: boolean;
  title: string;
  body: string;
  /** `?label=` — names the run in `pnpm s5`'s report. */
  label?: string;
  /** `?collect=1` — `pnpm s5` serves the harness and gathers every patch at /__s5. */
  collect?: boolean;
}
type InMsg = Start | { type: 'visibility'; hidden: boolean } | { type: 'stop' };

export interface TtS5Record {
  runId: string;
  label?: string;
  ua?: string;
  minutes: number;
  endAtEpoch: number;
  startedAt: number;
  /** The worker's own clock when it crossed the deadline. */
  firedAt?: number;
  lateMs?: number;
  hiddenAtFire?: boolean;
  notified?: boolean;
  shownAt?: number;
  shownLateMs?: number;
  error?: string;
  ticks?: number;
  maxTickGapMs?: number;
  ticksOver1s?: number;
  workerHasNotification: boolean;
  permission: string;
  /** Written by the page. */
  pageSawFireAt?: number;
  pageLateMs?: number;
  clickAt?: number;
  focusedAfterClick?: boolean;
  visibility?: Array<[number, boolean]>;
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ticktune-s5', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('runs', { keyPath: 'runId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('ticktune-s5 open failed'));
  });
}

let collect = false;

/**
 * Merge `patch` into the run's record — and, under `pnpm s5`, post it to the
 * script's own server too (same origin): the script reads the browser it
 * launched without attaching to a single page.
 */
async function save(runId: string, patch: Partial<TtS5Record>): Promise<void> {
  if (collect)
    void fetch('/__s5', { method: 'POST', body: JSON.stringify({ runId, patch }) }).catch(() => {});
  const d = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction('runs', 'readwrite');
      const store = tx.objectStore('runs');
      const get = store.get(runId);
      get.onsuccess = () => store.put({ ...(get.result as object | undefined), ...patch, runId });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('save failed'));
    });
  } finally {
    d.close();
  }
}

let run: Start | null = null;
let hidden = false;
let handle: ReturnType<typeof setInterval> | null = null;
let fired = false;
let lastTick = 0;
let maxGap = 0;
let over1s = 0;
let ticks = 0;

function tick(): void {
  const mono = performance.now();
  if (lastTick) {
    const gap = mono - lastTick;
    if (gap > maxGap) maxGap = gap;
    if (gap > 1000) over1s++;
  }
  lastTick = mono;
  ticks++;
  if (!run || fired) return;

  const now = Date.now();
  if (now < run.endAtEpoch) return;
  fired = true;
  const r = run;
  const rec: Partial<TtS5Record> = {
    firedAt: now,
    lateMs: now - r.endAtEpoch,
    hiddenAtFire: hidden,
    notified: false,
    ticks,
    maxTickGapMs: Math.round(maxGap),
    ticksOver1s: over1s,
  };
  if (r.notify && hidden) {
    try {
      if (typeof Notification === 'undefined') rec.error = 'no Notification in this worker';
      else if (Notification.permission !== 'granted')
        rec.error = `permission ${Notification.permission}`;
      else {
        const n = new Notification(r.title, { body: r.body, tag: `tt-s5-${r.runId}` });
        rec.notified = true;
        n.onshow = () => {
          const shownAt = Date.now();
          void save(r.runId, { shownAt, shownLateMs: shownAt - r.endAtEpoch });
        };
        n.onclick = () => {
          ctx.postMessage({ type: 'click', runId: r.runId, at: Date.now() });
          n.close();
        };
      }
    } catch (e) {
      rec.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
  }
  void save(r.runId, rec);
  ctx.postMessage({ type: 'fired', runId: r.runId, ...rec });
  if (handle !== null) clearInterval(handle);
  handle = null;
}

ctx.addEventListener('message', (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'start') {
    run = msg;
    collect = msg.collect === true;
    hidden = msg.hidden;
    fired = false;
    lastTick = 0;
    maxGap = 0;
    over1s = 0;
    ticks = 0;
    void save(msg.runId, {
      ...(msg.label === undefined ? {} : { label: msg.label }),
      ua: navigator.userAgent,
      minutes: msg.minutes,
      endAtEpoch: msg.endAtEpoch,
      startedAt: Date.now(),
      workerHasNotification: typeof Notification !== 'undefined',
      permission: typeof Notification === 'undefined' ? 'n/a' : Notification.permission,
    });
    if (handle !== null) clearInterval(handle);
    handle = setInterval(tick, TICK_MS);
  } else if (msg.type === 'visibility') {
    hidden = msg.hidden;
  } else if (handle !== null) {
    clearInterval(handle);
    handle = null;
  }
});
