import { test, expect, type Page } from './_fixtures';
import { gotoApp } from './_helpers';

/**
 * Forced colours — Windows Contrast themes. v2.2, `docs/03 §8`.
 *
 * Under forced colours the browser swaps every author colour for the user's
 * system palette. That is the user's choice and the app should let it happen;
 * what breaks is MEANING carried by colour alone. Measured with Chromium's
 * emulation (which renders the forced palette, not just the media query)
 * before `global.css`'s forced-colours block existed:
 *
 * - the landing's gauges read "88:88" — the unlit segments' 7% alpha became an
 *   opaque system colour on top of the values;
 * - the pressed key of every segmented strip looked like the others;
 * - a switch looked the same on and off.
 *
 * Each assertion compares two states of one control under emulation, so it
 * fails for the reason a user would: the states are indistinguishable. Shown
 * red with the forced-colours block removed.
 *
 * Chromium only: it is the engine whose emulation applies the forced palette.
 */
test.skip(
  ({ browserName, isMobile }) => browserName !== 'chromium' || !!isMobile,
  'forced-colours emulation renders the palette in Chromium only',
);

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
});

const pseudoDisplay = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el, '::before').display);

const bg = (page: Page, testid: string) =>
  page.getByTestId(testid).evaluate((el) => getComputedStyle(el).backgroundColor);

test('the landing gauges drop their unlit segments, so the values read', async ({ page }) => {
  await page.goto('/');
  expect(await pseudoDisplay(page, '.tt-window')).toBe('none');
  // …and the values themselves are still there to read.
  await expect(page.locator('.tt-digits').first()).toHaveText(/\d/);
});

test('the legal version readout drops its unlit segments', async ({ page }) => {
  await page.goto('/en/legal/privacy/');
  expect(await pseudoDisplay(page, '.tt-version-value')).toBe('none');
});

test('a pressed key, a selected tab and a checked switch differ from their neighbours', async ({
  page,
}) => {
  await gotoApp(page);
  // The header's language strip: VI pressed, EN not.
  expect(await bg(page, 'tt-lang-vi')).not.toBe(await bg(page, 'tt-lang-en'));
  // Setup's mode tabs: exactly one selected.
  const selected = page.locator('[role=tab][aria-selected=true]');
  const other = page.locator('[role=tab][aria-selected=false]').first();
  expect(await selected.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
    await other.evaluate((el) => getComputedStyle(el).backgroundColor),
  );

  await page.keyboard.press('s');
  await expect(page.getByTestId('tt-settings')).toBeVisible();
  // `letterKeys` is on by default, `allowDuplicates` off: one of each.
  await expect(page.getByTestId('tt-set-letterkeys')).toBeChecked();
  await expect(page.getByTestId('tt-set-duplicates')).not.toBeChecked();
  expect(await bg(page, 'tt-set-letterkeys')).not.toBe(await bg(page, 'tt-set-duplicates'));
});
