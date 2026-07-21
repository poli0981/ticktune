import { test, expect, type Page } from '@playwright/test';
import { gotoApp, setDuration, stageSingle, dismissUnloadDialogs } from './_helpers';

/**
 * docs/13 §3 — the countdown runs for real: format regimes, the sub-60 s
 * millisecond display, pause/resume, and a `done` that actually fires.
 *
 * From P2, `isReady` requires a playable track (docs/02 §1), so every test that
 * starts a run stages one first. Without that, Start is disabled for the QUEUE
 * reason and a test named after the countdown range would pass while proving
 * nothing about the range.
 *
 * Desktop only; the app island does not load on a blocked viewport by design
 * (docs/07 §6, asserted in mobile-gate.spec.ts).
 */
test.describe('countdown', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  const digits = (p: Page) => p.locator('.tt-countdown .tt-live');
  const ghost = (p: Page) => p.locator('.tt-countdown .tt-ghost');

  test('renders H:MM:SS above an hour, with a matching ghost', async ({ page }) => {
    await gotoApp(page);
    await setDuration(page, 1, 30, 0);
    await expect(digits(page)).toHaveText('1:30:00');
    // The ghost is what removes width jitter — it must track the live width.
    expect(await ghost(page).textContent()).toBe('8:88:88');
  });

  test('MM:SS between 60 s and an hour', async ({ page }) => {
    await gotoApp(page);
    await setDuration(page, 0, 9, 41);
    await expect(digits(page)).toHaveText('09:41');
    expect(await ghost(page).textContent()).toBe('88:88');
  });

  test('crosses into the SS.mmm regime and turns red', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 3);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    // Below 60 s the display is milliseconds, updated per rAF frame.
    await expect(digits(page)).toHaveText(/^0[0-2]\.\d{3}$/);
    await expect(page.locator('.tt-countdown')).toHaveClass(/tt-danger/);
    expect(await ghost(page).textContent()).toBe('88.888');
  });

  test('actually counts down', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 10);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    const first = await digits(page).textContent();
    await page.waitForTimeout(1200);
    const second = await digits(page).textContent();
    expect(Number(second)).toBeLessThan(Number(first));
  });

  test('pause freezes the value; resume continues from it', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 30);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await page.waitForTimeout(500);

    // Transport lives in the Z7 bar (docs/03 §2); there is deliberately no
    // second control row duplicating it.
    await page.getByTestId('tt-playpause').click();
    const frozen = await digits(page).textContent();
    await page.waitForTimeout(900);
    expect(await digits(page).textContent()).toBe(frozen);

    await page.getByTestId('tt-playpause').click();
    await page.waitForTimeout(600);
    expect(Number(await digits(page).textContent())).toBeLessThan(Number(frozen));
  });

  test('reaches zero and shows the Finished screen exactly once', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 2);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    // The P1 `tt-notice` paragraph was replaced by the real screen (docs/03
    // §3.5). A short, visible run is never late, so this is the normal variant.
    const finished = page.getByTestId('tt-finished');
    await expect(finished).toBeVisible({ timeout: 8_000 });
    await expect(finished).toHaveAttribute('data-variant', 'normal');
    await expect(page.getByTestId('tt-finished-late')).toBeHidden();
    await expect(digits(page)).toHaveText('00.000');

    await expect(finished).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeHidden();

    await page.getByTestId('tt-finished-back').click();
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeVisible();
  });

  test('Stop from a running countdown returns to setup (docs/02 §1)', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 1, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.getByTestId('tt-rail')).toBeVisible();

    await page.getByTestId('tt-stop').click();
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeVisible();
    await expect(page.getByTestId('tt-finished')).toBeHidden();
  });

  test('Start is disabled below the 1 s minimum (docs/04 §4)', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    // Staged FIRST, so the only remaining reason Start can be disabled is the
    // countdown range — which is what this test is named after.
    await stageSingle(page);
    await setDuration(page, 0, 1, 0);
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeEnabled();

    await setDuration(page, 0, 0, 0);
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled();
    await expect(page.getByTestId('tt-start-hint')).toContainText('1 giây');
  });
});
