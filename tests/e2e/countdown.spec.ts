import { test, expect, type Page } from '@playwright/test';

/**
 * docs/13 §3 — the countdown runs for real: format regimes, the sub-60 s
 * millisecond display, pause/resume, and a `done` that actually fires.
 *
 * Desktop only; the app island does not load on a blocked viewport by design
 * (docs/07 §6, asserted in mobile-gate.spec.ts).
 */
test.describe('countdown', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  const digits = (p: Page) => p.locator('.tt-countdown .tt-live');
  const ghost = (p: Page) => p.locator('.tt-countdown .tt-ghost');

  async function setDuration(p: Page, h: number, m: number, s: number) {
    await p.getByLabel('giờ').fill(String(h));
    await p.getByLabel('phút').fill(String(m));
    await p.getByLabel('giây').fill(String(s));
  }

  test('renders H:MM:SS above an hour, with a matching ghost', async ({ page }) => {
    await page.goto('/app/');
    await setDuration(page, 1, 30, 0);
    await expect(digits(page)).toHaveText('1:30:00');
    // The ghost is what removes width jitter — it must track the live width.
    expect(await ghost(page).textContent()).toBe('8:88:88');
  });

  test('MM:SS between 60 s and an hour', async ({ page }) => {
    await page.goto('/app/');
    await setDuration(page, 0, 9, 41);
    await expect(digits(page)).toHaveText('09:41');
    expect(await ghost(page).textContent()).toBe('88:88');
  });

  test('crosses into the SS.mmm regime and turns red', async ({ page }) => {
    await page.goto('/app/');
    await setDuration(page, 0, 0, 3);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    // Below 60 s the display is milliseconds, updated per rAF frame.
    await expect(digits(page)).toHaveText(/^0[0-2]\.\d{3}$/);
    await expect(page.locator('.tt-countdown')).toHaveClass(/tt-danger/);
    expect(await ghost(page).textContent()).toBe('88.888');
  });

  test('actually counts down', async ({ page }) => {
    await page.goto('/app/');
    await setDuration(page, 0, 0, 10);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    const first = await digits(page).textContent();
    await page.waitForTimeout(1200);
    const second = await digits(page).textContent();
    expect(Number(second)).toBeLessThan(Number(first));
  });

  test('pause freezes the value; resume continues from it', async ({ page }) => {
    await page.goto('/app/');
    await setDuration(page, 0, 0, 30);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: 'Tạm dừng' }).click();
    const frozen = await digits(page).textContent();
    await page.waitForTimeout(900);
    expect(await digits(page).textContent()).toBe(frozen);

    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await page.waitForTimeout(600);
    expect(Number(await digits(page).textContent())).toBeLessThan(Number(frozen));
  });

  test('reaches zero and finishes exactly once', async ({ page }) => {
    await page.goto('/app/');
    await setDuration(page, 0, 0, 2);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    await expect(page.getByTestId('tt-notice')).toHaveText(/Time's up/, { timeout: 8_000 });
    await expect(digits(page)).toHaveText('00.000');
    // Back to the start controls — the run is over, not merely paused.
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeVisible();
  });

  test('Start is disabled below the 1 s minimum (docs/04 §4)', async ({ page }) => {
    await page.goto('/app/');
    await setDuration(page, 0, 0, 0);
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled();
  });
});
