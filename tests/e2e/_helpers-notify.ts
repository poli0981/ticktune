import type { Page } from '@playwright/test';

/**
 * The finish notification's test seam — docs/04 §2 (v2.0), docs/13 §3.
 *
 * Two things Playwright cannot do for real: hide a tab (every page it drives
 * reports `visible` — spike S5 measured exactly that) and show an OS
 * notification it can read back. So, like `_helpers-clock.ts`:
 *
 * - **Visibility** is overridden on `Document.prototype` and flipped with
 *   `setHidden`, which also fires `visibilitychange` — the event the driver
 *   forwards to the worker, which is what decides at zero.
 * - **The worker's `Notification`** is replaced, inside a blob module that then
 *   imports the real worker, by a recorder that reports each show and close
 *   back to the page. `workerNotification: false` removes it instead — Safari's
 *   shape, where the page must take over.
 * - **The page's `Notification`** is a recorder too, granted, so the Settings
 *   switch can be turned on and the page fallback can be seen.
 *
 * Everything lands in `window.__ttNotes`; `notes(page)` reads it.
 */
export async function installNotifyStub(
  page: Page,
  opts: { workerNotification?: boolean } = {},
): Promise<void> {
  await page.addInitScript((workerNotification: boolean) => {
    type Note = { kind: string; title?: string; body?: string; tag?: string };
    const w = window as unknown as {
      __ttNotes: Note[];
      __ttHidden: boolean;
      __ttFocused: number;
      __ttSetHidden: (h: boolean) => void;
      __ttClickNote: () => void;
    };
    w.__ttNotes = [];
    w.__ttHidden = false;
    w.__ttFocused = 0;

    Object.defineProperty(Document.prototype, 'hidden', {
      configurable: true,
      get: () => w.__ttHidden,
    });
    Object.defineProperty(Document.prototype, 'visibilityState', {
      configurable: true,
      get: () => (w.__ttHidden ? 'hidden' : 'visible'),
    });
    w.__ttSetHidden = (h: boolean) => {
      w.__ttHidden = h;
      document.dispatchEvent(new Event('visibilitychange'));
    };

    const realFocus = window.focus.bind(window);
    window.focus = () => {
      w.__ttFocused += 1;
      realFocus();
    };

    class PageNotification {
      static permission = 'granted';
      static requestPermission = () => Promise.resolve('granted');
      onclick: (() => void) | null = null;
      constructor(title: string, o: { body?: string; tag?: string } = {}) {
        w.__ttNotes.push({ kind: 'page-show', title, body: o.body ?? '', tag: o.tag ?? '' });
      }
      close() {
        w.__ttNotes.push({ kind: 'page-close' });
      }
    }
    (window as unknown as { Notification: unknown }).Notification = PageNotification;

    const RealWorker = window.Worker;
    const workers: Worker[] = [];
    window.Worker = class extends RealWorker {
      constructor(url: string | URL, o?: WorkerOptions) {
        const real = new URL(String(url), location.href).href;
        const stub = workerNotification
          ? `self.Notification = class {
               static get permission() { return 'granted'; }
               constructor(title, o = {}) {
                 this.onclick = null; last = this;
                 postMessage({ __ttNote: 'show', title, body: o.body, tag: o.tag });
               }
               close() { postMessage({ __ttNote: 'close' }); }
             };`
          : `self.Notification = undefined;`;
        const src = `
          let last = null;
          ${stub}
          const held = [];
          let ready = false;
          self.addEventListener('message', (e) => {
            if (e.data && e.data.__ttClickNote) {
              e.stopImmediatePropagation();
              if (last && last.onclick) last.onclick(new Event('click'));
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
          ...o,
          type: 'module',
        });
        this.addEventListener('message', (e: MessageEvent<{ __ttNote?: string } & Note>) => {
          if (!e.data || typeof e.data.__ttNote !== 'string') return;
          e.stopImmediatePropagation();
          w.__ttNotes.push({
            kind: `worker-${e.data.__ttNote}`,
            ...(e.data.title === undefined ? {} : { title: e.data.title }),
            ...(e.data.body === undefined ? {} : { body: e.data.body }),
            ...(e.data.tag === undefined ? {} : { tag: e.data.tag }),
          });
        });
        workers.push(this);
      }
    };
    w.__ttClickNote = () => {
      for (const worker of workers) worker.postMessage({ __ttClickNote: true });
    };
  }, opts.workerNotification ?? true);
}

export async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    (window as unknown as { __ttSetHidden: (h: boolean) => void }).__ttSetHidden(h);
  }, hidden);
}

export async function notes(
  page: Page,
): Promise<Array<{ kind: string; title?: string; body?: string; tag?: string }>> {
  return page.evaluate(
    () => (window as unknown as { __ttNotes: Array<{ kind: string }> }).__ttNotes,
  );
}

export async function clickNote(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __ttClickNote: () => void }).__ttClickNote());
}

export async function focusCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __ttFocused: number }).__ttFocused);
}
