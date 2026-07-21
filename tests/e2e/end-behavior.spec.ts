import { test, expect, type Page } from '@playwright/test';
import { gotoApp, setDuration, stageSingle, dismissUnloadDialogs } from './_helpers';

/**
 * docs/02 §5 — the End Behavior — and P2 exit criterion 2.
 *
 * The chime is synthesised (docs/05 §7), so there is no network request to
 * observe. `data-tt-chime-count` is incremented by the LAST oscillator's
 * `onended`, which is a stronger assertion than the old "a chime file was
 * requested": it proves the chime actually sounded, and a suspended context
 * schedules happily while playing nothing.
 */
test.describe('end behavior', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  async function runToZero(page: Page, seconds = 2) {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, seconds);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
  }

  const chimeCount = (page: Page) =>
    page.evaluate(() => Number(document.documentElement.dataset['ttChimeCount'] ?? 0));

  test('the fade completes and the chime sounds exactly once', async ({ page }) => {
    await runToZero(page);
    await expect(page.getByTestId('tt-finished')).toBeVisible({ timeout: 10_000 });

    // The fade ran to completion on the audio clock.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset['ttFadeDone']), {
        timeout: 8_000,
      })
      .toBeTruthy();

    // And the chime actually sounded — default endChime is true (docs/02 §3.1).
    await expect.poll(() => chimeCount(page), { timeout: 8_000 }).toBe(1);

    // Once. Not once per note, and not again on a later frame.
    await page.waitForTimeout(1_500);
    expect(await chimeCount(page)).toBe(1);
  });

  test('a muted app stays silent — no chime scheduled', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await page.getByTestId('tt-file-input').isVisible();

    await setDuration(page, 0, 0, 2);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    // Mute through the real control, so the setting round-trips as a user's
    // would (docs/05 §7: the chime respects mute, not volume).
    await page.getByTestId('tt-mute').click();

    await expect(page.getByTestId('tt-finished')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1_200);
    expect(await chimeCount(page)).toBe(0);
  });

  /**
   * Exit criterion 2, as far as a browser automation can honestly take it.
   *
   * A second page is brought to front so `document.hidden` is genuinely true on
   * the app page. What this CANNOT reproduce is the minutes-long intensive
   * throttling spike S2 measured — Playwright's Chromium runs with
   * --disable-renderer-backgrounding, and the stall needs ~5 minutes of real
   * backgrounding. That case stays the manual docs/13 §7 item, where lateness
   * is expected rather than a defect.
   *
   * So this asserts the OUTCOME — the fade finished and the chime ran — and
   * never which path fired it.
   */
  test('fade and chime survive a hidden run', async ({ page, context }) => {
    await runToZero(page, 3);

    const other = await context.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    // Long enough for the deadline to pass while genuinely hidden.
    await other.waitForTimeout(5_000);
    await page.bringToFront();
    await other.close();

    await expect(page.getByTestId('tt-finished')).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset['ttFadeDone']), {
        timeout: 8_000,
      })
      .toBeTruthy();
    await expect.poll(() => chimeCount(page), { timeout: 8_000 }).toBe(1);
  });
});
