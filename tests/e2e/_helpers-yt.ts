import { expect, type Page } from '@playwright/test';
import { acceptLegalGate, gotoApp } from './_helpers';

/**
 * The YouTube seams — docs/13 §3 and §4.
 *
 * ## Why a stub and not the real thing
 *
 * `docs/13 §4` forbids CI depending on YouTube's servers, and it is right to:
 * an age gate, a takedown or a bad day at Google would turn this suite red for
 * a reason that has nothing to do with the code. Everything below stubs the two
 * network boundaries and nothing else — the app's own modules run untouched.
 *
 * ## Both seams are the app's real ones
 *
 * `TtYtPlayerPorts.create` is documented as the injection seam, but it is NOT
 * reachable from a test: `yt.svelte.ts` calls `browserPlayerPorts(mount)`
 * directly. The seams that ARE reachable sit one level lower, in the driver:
 *
 * 1. The `<script src="https://www.youtube.com/iframe_api">` it appends —
 *    intercepted with `page.route`, which is deliberately preferred over
 *    `page.addInitScript` setting `window.YT`. Routing exercises the real
 *    `loadApi()` (the script tag, the `onYouTubeIframeAPIReady` callback, the
 *    shared in-flight promise) and proves the app requests exactly that URL;
 *    pre-setting the global bypasses all of it via the short-circuit.
 * 2. `fetch('/api/yt/oembed?id=…')` — a RELATIVE URL, so same-origin, so
 *    `page.route` intercepts it cleanly.
 *
 * ⚠️ The oEmbed stub is not optional decoration. Playwright's `webServer` is
 * `astro preview`, which does not run the Worker, so `/api/yt/oembed` really
 * does 404 into the static page under E2E — the exact regression
 * `src/lib/tt-yt-cause.ts` documents.
 */

/** Recorded by the stub player so a spec can assert what the driver asked for. */
export interface TtYtProbe {
  /** The options object passed to `new YT.Player(el, opts)`. */
  opts: { host?: string; width?: number; height?: number };
  /** Every method call, in order: `['loadVideoById:abc', 'playVideo', …]`. */
  calls: string[];
  /** How many players were constructed — a remount must build a second. */
  built: number;
}

declare global {
  interface Window {
    __ttYt?: TtYtProbe;
    __ttYtFire?: {
      ready: () => void;
      state: (s: number) => void;
      error: (c: number) => void;
    };
  }
}

/**
 * Serve a fake IFrame API in place of YouTube's.
 *
 * The stub replaces the mount element with an `about:blank` iframe at the same
 * 384×216 the real player uses, because the ToS assertions measure a real box
 * in a real layout — an unreplaced `<div>` would measure the slot rather than
 * the player and would pass even if the player never arrived.
 *
 * Must be called BEFORE navigation.
 */
export async function installFakeYt(page: Page): Promise<void> {
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: `
        (function () {
          window.__ttYt = { opts: {}, calls: [], built: 0 };
          var probe = window.__ttYt;

          function Player(el, opts) {
            probe.built += 1;
            probe.opts = { host: opts.host, width: opts.width, height: opts.height };

            // The real API replaces the element it is given. Match that, so the
            // geometry assertions measure the player and not the empty slot.
            var frame = document.createElement('iframe');
            frame.setAttribute('data-testid', 'tt-yt-frame');
            frame.src = 'about:blank';
            frame.width = String(opts.width);
            frame.height = String(opts.height);
            frame.style.border = '0';
            el.replaceWith(frame);

            var ev = opts.events || {};
            window.__ttYtFire = {
              ready: function () { ev.onReady && ev.onReady({ target: this }); },
              state: function (s) { ev.onStateChange && ev.onStateChange({ data: s }); },
              error: function (c) { ev.onError && ev.onError({ data: c }); },
            };

            var record = function (name) {
              return function (arg) {
                probe.calls.push(arg === undefined ? name : name + ':' + arg);
              };
            };
            this.loadVideoById = record('loadVideoById');
            this.playVideo = record('playVideo');
            this.pauseVideo = record('pauseVideo');
            this.setVolume = record('setVolume');
            this.mute = record('mute');
            this.unMute = record('unMute');
            // Non-zero, because 0 is the API's "not known yet" and the docs/06
            // §2 backfill is gated on duration arriving.
            this.getDuration = function () { return 212.5; };
            this.getCurrentTime = function () { return 0; };
            this.getVideoData = function () {
              return { title: 'Từ trình phát', author: 'Kênh trình phát' };
            };
            this.destroy = function () {
              probe.calls.push('destroy');
              if (frame.parentNode) frame.replaceWith(document.createElement('div'));
            };

            // The real player is ready asynchronously; firing synchronously
            // from the constructor would run before the driver has assigned it.
            var self = this;
            setTimeout(function () { ev.onReady && ev.onReady({ target: self }); }, 0);
          }

          window.YT = { Player: Player, PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 } };
          if (typeof window.onYouTubeIframeAPIReady === 'function') {
            window.onYouTubeIframeAPIReady();
          }
        })();
      `,
    }),
  );
}

/** What the stubbed edge should answer for one video id. */
export interface TtOembedReply {
  status: number;
  /** The Worker's JSON body. Omit for a 200 with generic metadata. */
  body?: Record<string, unknown>;
  /**
   * Answer as HTML instead of JSON — the static-404 shape.
   *
   * The ONLY case that should use this is the one reproducing what `astro
   * preview` and a captive portal both do. Every other case must stay JSON, or
   * `ytCauseFromResponse` downgrades it to `upstream_unreachable` and the spec
   * passes for a reason that has nothing to do with the status it named.
   */
  html?: boolean;
}

/**
 * Stand in for the Worker.
 *
 * @param table id → reply. An id with no entry gets a 200 with metadata, so a
 *   spec only has to describe the failures it is about.
 */
export async function mockOembed(
  page: Page,
  table: Record<string, TtOembedReply> = {},
): Promise<void> {
  await page.route('**/api/yt/oembed*', (route) => {
    const id = new URL(route.request().url()).searchParams.get('id') ?? '';
    const reply: TtOembedReply = table[id] ?? {
      status: 200,
      body: {
        title: `Video ${id}`,
        author_name: `Channel ${id}`,
        thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      },
    };

    if (reply.html === true) {
      return route.fulfill({
        status: reply.status,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><title>404</title><p>Not found</p>',
      });
    }

    // Exactly what `worker/index.ts` sets. The content type is what earns a
    // status the right to be read as a cause (src/lib/tt-yt-cause.ts).
    return route.fulfill({
      status: reply.status,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(reply.body ?? { error: 'unavailable' }),
    });
  });
}

/** Both stubs, then the app, gate cleared. */
export async function gotoYouTubeApp(
  page: Page,
  table: Record<string, TtOembedReply> = {},
  path = '/app/',
): Promise<void> {
  await installFakeYt(page);
  await mockOembed(page, table);
  await gotoApp(page, path);
  await page.getByTestId('tt-tab-youtube').click();
}

/**
 * Open the app as someone who has been here before.
 *
 * The legal gate only renders when the stored version differs, so a returning
 * user never passes through it — and the gate is one of the three autoplay
 * unlock sites (`docs/05 §1`). Every other spec in this suite starts with empty
 * storage and therefore always unlocks, which is precisely why the dead End
 * Behavior in YouTube mode survived a phase: the suite could not express a user
 * who skips the gate. Accepting once and reloading is that user.
 */
export async function gotoYouTubeAppReturning(
  page: Page,
  table: Record<string, TtOembedReply> = {},
  settings: Record<string, unknown> = {},
): Promise<void> {
  await installFakeYt(page);
  await mockOembed(page, table);
  await page.goto('/app/');
  await acceptLegalGate(page);
  if (Object.keys(settings).length > 0) await seedSettings(page, settings);
  await page.reload();
  await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);
  await expect(page.locator('[role=dialog]')).toHaveCount(0);
  await page.getByTestId('tt-tab-youtube').click();
}

/**
 * Patch the stored settings row, the way a returning user's would look.
 *
 * Call between the first visit and the reload — the store reads once at boot.
 */
export async function seedSettings(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (fields) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const req = indexedDB.open('ticktune');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    if (!db.objectStoreNames.contains('settings')) throw new Error('settings store missing');
    await new Promise((res, rej) => {
      const store = db.transaction('settings', 'readwrite').objectStore('settings');
      const get = store.get('app');
      get.onsuccess = () => {
        const put = store.put({ ...get.result, ...fields, key: 'app' });
        put.onsuccess = () => res(null);
        put.onerror = () => rej(put.error);
      };
      get.onerror = () => rej(get.error);
    });
  }, patch);
}

/**
 * Record whether the `endFlash` element EVER rendered.
 *
 * It lives for 400 ms, so polling for it with `toBeVisible` is a race that would
 * pass or fail on machine speed. An observer armed before the app boots turns a
 * transient into a durable fact — and the flash is the only user-visible proof
 * that `runEndBehavior()` returned a plan at all.
 */
export async function watchForFlash(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __ttFlashSeen?: boolean }).__ttFlashSeen = false;
    const arm = (): void => {
      new MutationObserver(() => {
        if (document.querySelector('[data-testid=tt-flash]')) {
          (window as unknown as { __ttFlashSeen?: boolean }).__ttFlashSeen = true;
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) arm();
    else document.addEventListener('DOMContentLoaded', arm);
  });
}

/** Whether the flash was seen since the last navigation. */
export async function flashSeen(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as { __ttFlashSeen?: boolean }).__ttFlashSeen === true,
  );
}

/** Paste ids into the YouTube box and wait for the queue to settle. */
export async function stageLinks(
  page: Page,
  ids: string[],
  expectRows = ids.length,
): Promise<void> {
  await page
    .getByTestId('tt-yt-input')
    .fill(ids.map((id) => `https://www.youtube.com/watch?v=${id}`).join('\n'));
  await page.getByTestId('tt-yt-add').click();
  await expect(page.getByTestId('tt-queue-row')).toHaveCount(expectRows);
}

/** What the driver asked the player to do, in order. */
export async function ytCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__ttYt?.calls ?? []);
}

/** The options the driver constructed the player with. */
export async function ytProbe(page: Page): Promise<TtYtProbe> {
  return page.evaluate(() => window.__ttYt ?? { opts: {}, calls: [], built: 0 });
}

/** Drive the player's callbacks from the page. */
export async function fireYt(
  page: Page,
  event: 'ready' | 'ended' | 'playing' | 'paused',
): Promise<void> {
  await page.evaluate((e) => {
    const fire = window.__ttYtFire;
    if (!fire) throw new Error('the fake player was never constructed');
    if (e === 'ready') fire.ready();
    else if (e === 'ended') fire.state(0);
    else if (e === 'playing') fire.state(1);
    else fire.state(2);
  }, event);
}

/** Report a player error — S1 measured 150 for every real cause. */
export async function fireYtError(page: Page, code = 150): Promise<void> {
  await page.evaluate((c) => {
    const fire = window.__ttYtFire;
    if (!fire) throw new Error('the fake player was never constructed');
    fire.error(c);
  }, code);
}
