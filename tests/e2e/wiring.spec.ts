import { expect, test, type Page } from './_fixtures';
import {
  dismissUnloadDialogs,
  gotoApp,
  setDuration,
  skipWithoutAudio,
  stageManyTracks,
  stagePlaylist,
  stageSingle,
  storedSettings,
} from './_helpers';
import { fireYt, gotoYouTubeApp, stageLinks, ytCalls } from './_helpers-yt';

/**
 * v1.1's runtime wiring fixes — one spec per defect, each written to fail on
 * the code it replaced.
 *
 * Every one of these was the project's signature shape: the engines were right
 * and unit-tested, and the bug lived in what the SHELL did between them — a
 * timer nobody cancelled, an event nobody listened to, a handler that bypassed
 * the engine. No engine test can see any of it; that is what this tier is for.
 */

const transport = (page: Page) => page.getByTestId('tt-playpause');

async function openSettings(page: Page): Promise<void> {
  await page.keyboard.press('s');
  await expect(page.getByTestId('tt-settings')).toBeVisible();
}

test.describe('runtime wiring — v1.1', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('a restarted run keeps its sound past the old fade', async ({ browserName, page }) => {
    await skipWithoutAudio(page, browserName);
    /*
     * The End Behavior scheduled `engine.pause()` for when the 2 s fade ended
     * and never cancelled it. `endAction: restart` re-runs 400 ms after zero, so
     * at ~2 s the OLD run's timer paused the NEW run: silence, ▶ on the
     * transport, countdown still going.
     *
     * Timeline at 5 s: zero at 5.0, re-run at 5.4, stale pause at 7.0, second
     * zero at 10.4. Sampled at ~8 s, comfortably inside the window.
     */
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await openSettings(page);
    await page.getByTestId('tt-set-endaction-restart').click();
    await page.keyboard.press('Escape');

    await stageSingle(page);
    await setDuration(page, 0, 0, 5);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(transport(page)).toHaveAttribute('aria-label', 'Tạm dừng');

    await page.waitForTimeout(8_000);
    await expect(page.getByTestId('tt-finished')).toHaveCount(0);
    await expect(transport(page)).toHaveAttribute('aria-label', 'Tạm dừng');
  });

  test('"Về thiết lập" inside the re-run window does not start a run', async ({ page }) => {
    /*
     * The re-run was a bare 400 ms setTimeout, and `session.start()` had no
     * state guard — so leaving Finished inside that window started the run the
     * user had just dismissed. The page clock holds the timer still while Back
     * is clicked, which makes the race deterministic instead of a coin toss.
     */
    dismissUnloadDialogs(page);
    await page.clock.install();
    await gotoApp(page);
    await openSettings(page);
    await page.getByTestId('tt-set-endaction-loop').click();
    await page.keyboard.press('Escape');

    await stageSingle(page);
    await setDuration(page, 0, 0, 2);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.getByTestId('tt-bottom-bar')).toBeVisible();

    // Past zero, then hold: the worker still ticks on real time and reports
    // `done`, but the 400 ms re-run timer cannot fire while the clock is paused.
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 2_600);
    await expect(page.getByTestId('tt-finished')).toBeVisible();

    await page.getByTestId('tt-finished-back').click();
    await expect(page.getByTestId('tt-setup')).toBeVisible();

    await page.clock.runFor(1_500);
    await expect(page.getByTestId('tt-setup')).toBeVisible();
    await expect(page.getByTestId('tt-bottom-bar')).toHaveCount(0);
  });

  test('removing the playing track plays the next one', async ({ browserName, page }) => {
    await skipWithoutAudio(page, browserName);
    /*
     * The rails called `session.removeTrack` directly: the cursor moved, the
     * engine was never told, the removed track kept playing — and when it
     * ended the queue advanced a second time, skipping a track.
     */
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageManyTracks(page, 3);
    await setDuration(page, 0, 1, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.getByTestId('tt-bar-title')).toHaveText('track-000');

    await page.getByTestId('tt-queue-remove').first().click();

    await expect(page.getByTestId('tt-bar-title')).toHaveText('track-001');
    await expect(page.getByTestId('tt-queue-row')).toHaveCount(2);
    await expect(transport(page)).toHaveAttribute('aria-label', 'Tạm dừng');
  });

  test('an undecodable track is marked and skipped — docs/02 §6', async ({ browserName, page }) => {
    await skipWithoutAudio(page, browserName);
    test.skip(
      browserName !== 'chromium',
      'corrupt.mp3 was measured failing at decode (MEDIA_ERR_SRC_NOT_SUPPORTED) on Chromium; other engines may play garbage frames as noise',
    );
    /*
     * The fixture was generated for exactly this case ("imports cleanly, fails
     * at decode", scripts/make-fixtures.ts) and no spec used it. The engine
     * logged TT-PLY-101 and nothing told the queue, so a playlist stopped dead
     * on the first bad file, with the row not even struck through.
     */
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stagePlaylist(page, ['corrupt.mp3', 'tone-5s.mp3']);
    await setDuration(page, 0, 1, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    const rows = page.getByTestId('tt-queue-row');
    await expect(rows.nth(0)).toHaveClass(/tt-error/);
    await expect(rows.nth(1).locator('[aria-current="true"]')).toHaveCount(1);
    await expect(page.getByTestId('tt-bar-title')).toHaveText('tone-5s');
    await expect(transport(page)).toHaveAttribute('aria-label', 'Tạm dừng');
  });

  test('⏭ while paused selects the next video WITHOUT playing it', async ({ page }) => {
    /*
     * `playTrack` always played: ⏭/⏮/double-click during a pause started the
     * music with the session paused and the countdown frozen. In YouTube mode
     * that is `loadVideoById` (which autoplays) plus `playVideo`; it is now a
     * cue, and resume plays it.
     */
    dismissUnloadDialogs(page);
    await gotoYouTubeApp(page);
    await stageLinks(page, ['jNQXAC9IVRw', '9bZkp7q19f0']);
    await setDuration(page, 0, 1, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.getByTestId('tt-yt-frame')).toBeVisible();
    await fireYt(page, 'playing');

    await transport(page).click();
    await expect.poll(() => ytCalls(page)).toContain('pauseVideo');
    const before = (await ytCalls(page)).length;

    await page.getByTestId('tt-next').click();
    await expect
      .poll(async () => (await ytCalls(page)).slice(before))
      .toContain('cueVideoById:9bZkp7q19f0');
    const after = (await ytCalls(page)).slice(before);
    expect(after).not.toContain('playVideo');
    expect(after).not.toContain('loadVideoById:9bZkp7q19f0');
  });

  test('Alt+↑ reorders a row without touching the volume', async ({ page }) => {
    /*
     * The row's handler reordered and called preventDefault; the window's
     * hotkey handler then ran anyway and moved the volume 5%. Every reorder.
     */
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stagePlaylist(page, ['tone-5s.mp3', 'tone-5s.wav']);
    await expect.poll(() => storedSettings(page)).not.toBeNull();
    const volume = (await storedSettings(page))?.['volume'];

    await page.getByTestId('tt-queue-grip').nth(1).focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(page.getByTestId('tt-queue-announce')).toContainText('1');

    await page.waitForTimeout(300);
    expect((await storedSettings(page))?.['volume']).toBe(volume);
  });

  test('Ctrl+S is the browser’s, not the settings hotkey', async ({ page }) => {
    // docs/03 §7's hotkeys are bare keys. Ctrl+F used to toggle fullscreen and
    // Ctrl+S opened the panel while the browser opened its save dialog.
    await gotoApp(page);
    // Blur rather than click: the page's centre is the drop zone, and clicking
    // it opens a native file chooser that swallows the keys that follow.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('tt-settings')).toHaveCount(0);
    await page.keyboard.press('s');
    await expect(page.getByTestId('tt-settings')).toBeVisible();
  });

  test('timer log codes reach Copy Diagnostics', async ({ page }) => {
    /*
     * The timer driver's codes went to console.warn under a comment claiming
     * that fed the diagnostics buffer; it never did. A refused Wake Lock is the
     * cheapest way to make the driver emit one (TT-SYS-202).
     */
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: { request: () => Promise.reject(new DOMException('no', 'NotAllowedError')) },
      });
    });
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 30);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.getByTestId('tt-bottom-bar')).toBeVisible();

    await openSettings(page);
    await expect(page.getByTestId('tt-set-log')).toContainText('TT-SYS-202');
  });

  test('a dead timer worker still finishes the countdown, and says so', async ({ page }) => {
    /*
     * The worker is a separate chunk. Created lazily with no `error` listener,
     * a tab open across a redeploy 404'd it and `done` never fired while the
     * tab was visible. A Worker that errors on construction stands in for the
     * missing chunk; the main-thread fallback must carry the run to zero.
     */
    await page.addInitScript(() => {
      class DeadWorker extends EventTarget {
        constructor() {
          super();
          setTimeout(() => this.dispatchEvent(new ErrorEvent('error', { message: '404' })), 0);
        }
        postMessage(): void {}
        terminate(): void {}
      }
      (window as unknown as { Worker: unknown }).Worker = DeadWorker;
    });
    await gotoApp(page);
    await page.getByTestId('tt-tab-single').click();
    await page.goto('/app/?ttdebug=1');
    await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);
    await setDuration(page, 0, 0, 2);
    await page.getByTestId('tt-debug-start').click();

    await expect(page.getByTestId('tt-finished')).toBeVisible({ timeout: 6_000 });
    await openSettings(page);
    await expect(page.getByTestId('tt-set-log')).toContainText('TT-SYS-207');
  });

  test('the legal gate stays usable on a short window', async ({ page }) => {
    // `main` is inert behind the gate, so the card has to scroll itself: on a
    // short window or at high zoom, Accept used to sit below the viewport.
    await page.setViewportSize({ width: 1100, height: 300 });
    await page.goto('/app/');
    await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);
    await page.getByTestId('tt-gate-agree').check();
    await page.getByTestId('tt-gate-accept').click();
    await expect(page.locator('[role=dialog]')).toBeHidden();
  });

  test('the context menu never covers the YouTube player, and Esc returns focus', async ({
    page,
  }) => {
    /*
     * The menu's "click anywhere to close" was a full-viewport transparent
     * layer. Opened from the queue under the player, it sat on top of the
     * player's rect for as long as the menu was open — docs/03 §2's carve-out.
     */
    dismissUnloadDialogs(page);
    await gotoYouTubeApp(page);
    await stageLinks(page, ['jNQXAC9IVRw', '9bZkp7q19f0']);
    await setDuration(page, 0, 1, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    const frame = page.getByTestId('tt-yt-frame');
    await expect(frame).toBeVisible();

    const row = page.locator('.tt-row-main').nth(1);
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByTestId('tt-context-menu')).toBeVisible();
    // Real focus on an item, not a highlight class on the container.
    await expect(page.locator('[role=menuitem]:focus')).toHaveCount(1);

    const box = (await frame.boundingBox())!;
    const topmostIsPlayer = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return !!el?.closest('[data-testid=tt-yt-frame], [data-testid=tt-yt-player]');
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(topmostIsPlayer).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tt-context-menu')).toHaveCount(0);
    await expect(row).toBeFocused();
  });
});
