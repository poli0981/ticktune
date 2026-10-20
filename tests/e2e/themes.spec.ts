import { test, expect } from './_fixtures';
import { gotoApp, gotoSingleMode, setDuration, stageSingle, storedSettings } from './_helpers';

/**
 * Theme and clock face — v2.0, docs/03 §1.
 *
 * The two new settings are only real if something READS them: the theme must
 * reach <html> (every token is overridden there) and survive a reload, and must
 * NOT leak onto the static pages; the face must reach the countdown's font and
 * its ghost.
 */

test.describe('theme — docs/03 §1', () => {
  test('light reaches the whole app, survives a reload, and stays out of the landing', async ({
    page,
  }) => {
    await gotoApp(page);
    await expect(page.locator('html')).toHaveAttribute('data-tt-theme', 'dark');
    await page.keyboard.press('s');
    await page.getByTestId('tt-set-theme-light').click();
    await expect(page.locator('html')).toHaveAttribute('data-tt-theme', 'light');
    // The chassis token is what every surface paints with.
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe('rgb(232, 228, 218)');
    await expect.poll(() => storedSettings(page)).toMatchObject({ theme: 'light' });

    await page.reload();
    await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);
    await expect(page.locator('html')).toHaveAttribute('data-tt-theme', 'light');

    await page.goto('/');
    expect(await page.locator('html').getAttribute('data-tt-theme')).toBeNull();
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      'rgb(14, 13, 11)',
    );
  });
});

test.describe('clock face — docs/03 §1', () => {
  test('DSEG14 reaches the countdown and its ghost, at the same width', async ({ page }) => {
    await gotoSingleMode(page);
    await stageSingle(page);
    await setDuration(page, 1, 2, 3);
    const clock = page.locator('.tt-countdown');
    const widthOf = () => clock.evaluate((el) => el.getBoundingClientRect().width);
    const before = await widthOf();

    // The gear, not `S`: focus is still in the seconds input, where hotkeys
    // are deliberately inert (settings.spec.ts).
    await page.getByTestId('tt-settings-open').click();
    await page.getByTestId('tt-set-face-dseg14').click();
    await page.getByTestId('tt-settings-close').click();
    await expect(clock).toHaveAttribute('data-tt-face', 'dseg14');
    await expect(clock.locator('.tt-ghost')).toHaveText('~:~~:~~');
    expect(await clock.evaluate((el) => getComputedStyle(el).fontFamily)).toContain(
      'DSEG14 Classic',
    );
    // The §4 cap was computed for DSEG7; DSEG14 must occupy the same box.
    await page.evaluate(() => document.fonts.ready);
    expect(Math.abs((await widthOf()) - before)).toBeLessThan(1);
  });
});
