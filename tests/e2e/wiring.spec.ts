import { readFileSync } from 'node:fs';
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
import { installWallClockShift, shiftWallClock } from './_helpers-clock';
import {
  fireYt,
  fireYtSeq,
  gotoYouTubeApp,
  installFakeYt,
  mockOembed,
  stageLinks,
  ytCalls,
  ytReady,
} from './_helpers-yt';

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
    // Paused from PLAYING: the video must be up before the pause is about it.
    await ytReady(page);
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

test.describe('live defects — v1.1.1', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('a forward clock jump does not strand a visible countdown at 0.000', async ({ page }) => {
    /*
     * The core re-anchored its deadline on the jump (TT-SYS-201) and never told
     * the worker, whose own copy ran out early: it posted `done` and stopped.
     * The core rightly ignored that `done`, rAF only repaints, and nothing
     * ticked again — the digits reached 0.000 and the Finished screen never
     * came. Both clocks move here, page AND worker; `page.clock` reaches only
     * the page, which is why this needs its own shim.
     */
    dismissUnloadDialogs(page);
    await installWallClockShift(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 10);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.getByTestId('tt-finished')).toHaveCount(0);

    await page.waitForTimeout(2_000);
    await shiftWallClock(page, 60_000); // the user sets the clock a minute ahead

    // Still the countdown they asked for: zero about 8 s later, not now and not never.
    await expect(page.getByTestId('tt-finished')).toBeVisible({ timeout: 12_000 });
  });

  test('a played track keeps its cover after the playlist moves on', async ({
    browserName,
    page,
  }) => {
    await skipWithoutAudio(page, browserName);
    /*
     * `load()` released the previous track's URLs — its cover with its media.
     * The row stayed in the queue, so its info modal, the Setup preview after
     * Stop and the cover backdrop all pointed at a revoked blob: URL.
     */
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stagePlaylist(page, ['with-cover.mp3', 'tone-5s.mp3']);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(transport(page)).toHaveAttribute('aria-label', 'Tạm dừng');
    await page.getByTestId('tt-next').click();

    await page.getByTestId('tt-queue-row').first().click({ button: 'right' });
    await page.getByTestId('tt-menu-info').click();
    const img = page.getByTestId('tt-cover');
    await expect(img).toBeVisible();

    // Deterministic, whatever the image cache holds: a revoked blob: URL
    // cannot be fetched.
    const src = await img.getAttribute('src');
    const alive = await page.evaluate(async (url) => {
      try {
        return (await fetch(url ?? '')).ok;
      } catch {
        return false;
      }
    }, src);
    expect(alive).toBe(true);
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
  });

  test('the object-URL canary moves, stays in bound, and ends at 0 (docs/13 §3)', async ({
    browserName,
    page,
  }) => {
    await skipWithoutAudio(page, browserName);
    /*
     * docs/13 §3 listed this spec; it never existed. And it could not have
     * passed: the panel read the count through a plain getter nothing reactive
     * depended on, so it showed the number from its first render, forever.
     */
    dismissUnloadDialogs(page);
    await gotoApp(page, '/app/?ttdebug=1');
    const live = async () => Number(await page.getByTestId('tt-live-urls').textContent());
    const pick = (f: string) => `tests/e2e/fixtures/${f}`;

    await page.getByTestId('tt-tab-single').click();
    await page.getByTestId('tt-file-input').setInputFiles(pick('with-cover.mp3'));
    await expect(page.getByTestId('tt-staged')).toBeVisible();
    await expect.poll(live).toBe(1); // the cover

    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect.poll(live).toBe(2); // + its media URL: queue 1 + 2 is the bound
    await page.getByTestId('tt-stop').click();

    // Replace: Single mode swaps the held track and releases the old one's URLs.
    await page.getByTestId('tt-file-input').setInputFiles(pick('tone-5s.mp3'));
    await expect.poll(live).toBe(0);

    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect.poll(live).toBe(1);
    await page.getByTestId('tt-stop').click();

    await page.getByTestId('tt-remove-track').click();
    await expect.poll(live).toBe(0);
  });
});

test.describe('live defects — v2.0.1', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('⚙ opens over two identical log entries from one millisecond', async ({ page }) => {
    /*
     * ⚙ threw `each_key_duplicate` and never opened. The Diagnostics list was
     * keyed on `ts + code + message`, and an import logs one entry per skipped
     * file — same code, empty message, the same millisecond. The page clock is
     * pinned so that is a fact here, not a likelihood.
     */
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
    await gotoApp(page);
    await page.getByTestId('tt-tab-playlist').click();
    const buffer = readFileSync('tests/e2e/fixtures/rejected.aiff');
    await page.getByTestId('tt-file-input').setInputFiles([
      { name: 'a.aiff', mimeType: 'audio/aiff', buffer },
      { name: 'b.aiff', mimeType: 'audio/aiff', buffer },
    ]);
    await expect(page.locator('[data-tt-code="TT-IMP-001"]')).toBeVisible();

    await openSettings(page);
    await expect(
      page.getByTestId('tt-set-log').locator('li', { hasText: 'TT-IMP-001' }),
    ).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test('files and links never share a queue — each tab shows its own shelf', async ({ page }) => {
    /*
     * One queue beside a mode flag, and nothing compared the two: Playlist →
     * YouTube left the files listed with Start enabled, the next paste joined
     * them, and Start ran a FILE on the YouTube player. Since v2.0.1 each
     * source has its own shelf (docs/02 §3.5), and switching back finds the
     * other one exactly as it was left.
     */
    const ONE = 'jNQXAC9IVRw';
    const TWO = '9bZkp7q19f0';
    const rows = page.getByTestId('tt-queue-row');
    const start = page.getByRole('button', { name: 'Bắt đầu' });
    dismissUnloadDialogs(page);
    await installFakeYt(page);
    await mockOembed(page);
    await gotoApp(page);
    await stagePlaylist(page, ['tone-5s.mp3', 'tone-5s.wav']);
    await expect(start).toBeEnabled();

    await page.getByTestId('tt-tab-youtube').click();
    await expect(rows).toHaveCount(0);
    await expect(start).toBeDisabled();
    await expect(page.getByTestId('tt-start-hint')).toHaveText(
      'Dán ít nhất một link YouTube để bắt đầu.',
    );

    await stageLinks(page, [ONE, TWO]);
    await expect(rows.filter({ hasText: 'tone-5s' })).toHaveCount(0);

    await page.getByTestId('tt-tab-playlist').click();
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Video' })).toHaveCount(0);
    await expect(start).toBeEnabled();

    await page.getByTestId('tt-tab-youtube').click();
    await expect(rows).toHaveCount(2);
    await start.click();
    await expect.poll(() => ytCalls(page)).toContain(`loadVideoById:${ONE}`);
  });
});

test.describe('live defects — v2.0.4', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  /*
   * The YouTube player's own controls (docs/06 §1.2 keeps them usable) reached
   * `yt.playing` and nothing else, so only the transport's ICON followed them.
   * The run is theirs now too — through the transport's own handlers, once the
   * player's state has settled (docs/06 §2). The stub never changes state by
   * itself, so every state below is one the real player sends.
   */
  const ONE = 'jNQXAC9IVRw';
  const TWO = '9bZkp7q19f0';
  const digits = (page: Page) => page.locator('.tt-countdown .tt-live');
  const tally = (page: Page) => page.getByTestId('tt-tally');

  async function startPlaying(page: Page): Promise<void> {
    dismissUnloadDialogs(page);
    await gotoYouTubeApp(page);
    await stageLinks(page, [ONE, TWO]);
    await setDuration(page, 0, 1, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await ytReady(page);
    await fireYt(page, 'playing');
    await expect(transport(page)).toHaveAttribute('aria-label', 'Tạm dừng');
    await expect(tally(page)).toHaveClass(/tt-live/);
  }

  test('⏸ and ▶ in the YouTube player itself pause and resume the run', async ({ page }) => {
    /*
     * The owner's report. ⏸ in the frame stopped the music and left the
     * countdown running under a ▶ whose click still meant "pause".
     */
    await startPlaying(page);
    const before = (await ytCalls(page)).length;

    await fireYt(page, 'paused');
    await expect(tally(page)).not.toHaveClass(/tt-live/);
    await expect(transport(page)).toHaveAttribute('aria-label', 'Phát');
    const frozen = await digits(page).textContent();
    await page.waitForTimeout(1_200);
    await expect(digits(page)).toHaveText(frozen ?? '');

    await fireYt(page, 'playing');
    await expect(tally(page)).toHaveClass(/tt-live/);
    await expect(transport(page)).toHaveAttribute('aria-label', 'Tạm dừng');
    await expect.poll(() => digits(page).textContent()).not.toBe(frozen);
    // The run followed the player, and nothing was sent back to it: the player
    // had already obeyed, and a command mid-scrub could keep it paused.
    expect((await ytCalls(page)).slice(before)).toEqual([]);

    // docs/12 §6: each one is in Diagnostics, so a misfire could be seen.
    await openSettings(page);
    await expect(
      page.getByTestId('tt-set-log').locator('li', { hasText: 'TT-YT-009' }),
    ).toHaveCount(2);
  });

  test('▶ in the YouTube player during a paused run resumes the run', async ({ page }) => {
    /*
     * The other half: the music played under a frozen countdown, the session
     * still paused and ▶ still on the transport — "paused means silent", broken
     * from outside the app.
     */
    await startPlaying(page);
    await transport(page).click();
    await expect(transport(page)).toHaveAttribute('aria-label', 'Phát');
    await expect.poll(() => ytCalls(page)).toContain('pauseVideo');
    await fireYt(page, 'paused'); // the echo of our own pauseVideo
    const frozen = await digits(page).textContent();
    const before = (await ytCalls(page)).length;

    await fireYt(page, 'playing');
    await expect(transport(page)).toHaveAttribute('aria-label', 'Tạm dừng');
    await expect(tally(page)).toHaveClass(/tt-live/);
    await expect.poll(() => digits(page).textContent()).not.toBe(frozen);
    expect((await ytCalls(page)).slice(before)).toEqual([]);

    // And the app's own ⏯ still means what it shows.
    await transport(page).click();
    await expect(tally(page)).not.toHaveClass(/tt-live/);
    await expect.poll(async () => (await ytCalls(page)).slice(before)).toEqual(['pauseVideo']);
  });

  test("a seek's passing PAUSED and a PAUSED before ENDED leave the run playing", async ({
    page,
  }) => {
    /*
     * What the settle exists for. A seek while playing sends PAUSED and then
     * BUFFERING 1 ms later (measured on the real player); taken at once it
     * would pause the run on every seek. A PAUSED right before ENDED would
     * pause it too, and the advance — which only moves a playing run — would
     * be dropped. Red on a variant that reports at once.
     */
    await startPlaying(page);

    await fireYtSeq(page, [2, 3]);
    await page.waitForTimeout(800);
    await expect(tally(page)).toHaveClass(/tt-live/);
    await fireYt(page, 'playing');

    await fireYtSeq(page, [2, 0]);
    await expect.poll(() => ytCalls(page)).toContain(`loadVideoById:${TWO}`);
    await page.waitForTimeout(800);
    await expect(tally(page)).toHaveClass(/tt-live/);
    const now = await digits(page).textContent();
    await expect.poll(() => digits(page).textContent()).not.toBe(now);
  });
});
