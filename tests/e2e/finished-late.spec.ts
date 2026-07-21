import { test, expect, type Page } from '@playwright/test';
import { acceptLegalGate, dismissUnloadDialogs, setDuration, stageSingle } from './_helpers';

/**
 * docs/13 §3 "Late finish" — P2 exit criterion 3.
 *
 * Drives a real countdown past its deadline with `page.clock` rather than
 * injecting an overshoot through a shipped URL hook. A `?ttovershoot=` affordance
 * would let any URL render a false finish time in production, and would prove
 * only that the component has an `if`; this exercises the whole path — worker,
 * driver, timer core, `finishReport`, screen.
 *
 * What the seam does and does not prove, measured 2026-07-21 on
 * @playwright/test 1.61.1 (recorded in docs/13 §3):
 *  - `clock.fastForward` moves Date.now() AND performance.now() in step, so
 *    docs/04 §1's drift rule correctly does not re-anchor the deadline.
 *  - the worker keeps ticking on the REAL clock, so `done` arrives with
 *    `late: false` and no TT-SYS-203. This spec therefore asserts the threshold
 *    behaviour, which is what docs/04 §2 actually specifies, and never the latch.
 */
test.describe('finished screen', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  async function runCountdown(page: Page, seconds: number, fastForwardMs: number) {
    dismissUnloadDialogs(page);
    await page.clock.install();
    await page.goto('/app/');
    await acceptLegalGate(page);

    // From P2, Start needs a playable track (docs/02 §1).
    await stageSingle(page);
    await setDuration(page, 0, 0, seconds);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await page.clock.fastForward(fastForwardMs);

    await expect(page.getByTestId('tt-finished')).toBeVisible({ timeout: 15_000 });
  }

  test('past the threshold it states when zero was actually reached', async ({ page }) => {
    // 30 s countdown, then jump ~3 minutes past it — the shape spike S2 measured
    // on a hidden, silent tab (docs/04 §2).
    await runCountdown(page, 30, 30_000 + 177_000);

    await expect(page.getByTestId('tt-finished')).toHaveAttribute('data-variant', 'late');

    const late = page.getByTestId('tt-finished-late');
    await expect(late).toBeVisible();
    // A specific clock time, and an explicit "ago" — the two things that stop
    // the screen implying the moment is now.
    await expect(late).toHaveText(/lúc\s+\d{1,2}:\d{2}/);
    await expect(late).toHaveText(/trước/);
    await expect(late).toHaveText(/2 phút/);

    // docs/04 §4: the digits still hold zero.
    await expect(page.locator('.tt-countdown .tt-live')).toHaveText('00.000');
  });

  test('below the threshold the normal screen is unchanged', async ({ page }) => {
    // 30 s countdown overshot by ~1 s: real, but not worth mentioning.
    await runCountdown(page, 30, 31_000);

    await expect(page.getByTestId('tt-finished')).toHaveAttribute('data-variant', 'normal');
    await expect(page.getByTestId('tt-finished-late')).toBeHidden();
    await expect(page.locator('.tt-countdown .tt-live')).toHaveText('00.000');
  });

  test('Back returns to setup; Restart runs the same countdown again', async ({ page }) => {
    await runCountdown(page, 30, 31_000);

    await page.getByTestId('tt-finished-back').click();
    await expect(page.getByTestId('tt-finished')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeVisible();

    // And the other edge out of `finished` (docs/02 §1).
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await page.clock.fastForward(31_000);
    await expect(page.getByTestId('tt-finished')).toBeVisible();
    await page.getByTestId('tt-finished-restart').click();
    await expect(page.getByTestId('tt-finished')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Tạm dừng' })).toBeVisible();
  });
});
