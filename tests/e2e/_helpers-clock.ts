import type { Page } from '@playwright/test';

/**
 * Move the WALL clock of the page and of its timer worker together — docs/04 §1.
 *
 * `page.clock` cannot test the re-anchor path: it fakes the page's timers and
 * `Date`, but a dedicated worker has its own global scope and its own `Date`
 * (docs/13 §3), so a fast-forward moves one side of the very contract under
 * test. This wraps `Worker` so the timer chunk loads inside a blob module
 * worker that installs the same offset first.
 *
 * `performance.now()` is left alone on both sides — which is exactly what a
 * user changing the system clock looks like from inside the page, and what the
 * core's skew rule measures.
 *
 * An init script: install before the first navigation.
 */
export async function installWallClockShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __ttWallOffset: number;
      __ttShiftWallClock: (ms: number) => void;
    };
    w.__ttWallOffset = 0;
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + w.__ttWallOffset;

    const RealWorker = window.Worker;
    const workers: Worker[] = [];
    window.Worker = class extends RealWorker {
      constructor(url: string | URL, opts?: WorkerOptions) {
        const real = new URL(String(url), location.href).href;
        // Messages that arrive before the real module has registered its own
        // listener are held and replayed, so an early `start` is not lost.
        const src = `
          let offset = ${w.__ttWallOffset};
          const realNow = Date.now.bind(Date);
          Date.now = () => realNow() + offset;
          const held = [];
          let ready = false;
          self.addEventListener('message', (e) => {
            if (e.data && typeof e.data.__ttWallOffset === 'number') {
              offset = e.data.__ttWallOffset;
              e.stopImmediatePropagation();
            } else if (!ready) {
              held.push(e.data);
              e.stopImmediatePropagation();
            }
          });
          await import(${JSON.stringify(real)});
          ready = true;
          for (const data of held) self.dispatchEvent(new MessageEvent('message', { data }));
        `;
        super(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), {
          ...opts,
          type: 'module',
        });
        workers.push(this);
      }
    };

    w.__ttShiftWallClock = (ms: number) => {
      w.__ttWallOffset += ms;
      for (const worker of workers) worker.postMessage({ __ttWallOffset: w.__ttWallOffset });
    };
  });
}

/** Jump the wall clock of the page and of every worker it created, by `ms`. */
export async function shiftWallClock(page: Page, ms: number): Promise<void> {
  await page.evaluate((delta) => {
    (window as unknown as { __ttShiftWallClock: (ms: number) => void }).__ttShiftWallClock(delta);
  }, ms);
}
