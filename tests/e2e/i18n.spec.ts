import { test, expect } from '@playwright/test';
import { gotoApp, storedSettings } from './_helpers';

/**
 * docs/13 §3's i18n row, verbatim: "toggle EN↔VI swaps visible strings without
 * reload". It was filed for P5 and this is P5.
 *
 * The reason it has to be an E2E rather than a component test is the words
 * "without reload". The switch works by `t()` reading a `$state` field on every
 * call — remove that read and every string still renders correctly on first
 * paint, so a component test that mounts, asserts, and unmounts cannot tell the
 * difference. Only a live toggle can.
 */
test.describe('language toggle — docs/08 §2', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('swaps visible strings in place, with no navigation', async ({ page }) => {
    await gotoApp(page);

    // docs/08: "Vietnamese is the default", and a fresh Playwright profile has
    // no stored setting — `initialLang` then reads navigator.language, which is
    // en-US in Chromium's automation profile, so assert on what is ON SCREEN
    // rather than assuming which language boots.
    const start = page.getByTestId('tt-start-hint');
    const before = await start.textContent();

    let navigated = false;
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) navigated = true;
    });

    await page.getByTestId('tt-lang-toggle').click();

    await expect(start).not.toHaveText(before ?? '');
    expect(navigated).toBe(false);
  });

  test('updates documentElement.lang, which is what a screen reader reads', async ({ page }) => {
    // docs/03 §8 "language of parts": a VI interface announced in an English
    // voice is an accessibility defect, not a cosmetic one.
    await gotoApp(page);
    const first = await page.evaluate(() => document.documentElement.lang);
    expect(['vi', 'en']).toContain(first);

    await page.getByTestId('tt-lang-toggle').click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.lang))
      .toBe(first === 'vi' ? 'en' : 'vi');
  });

  test('survives a reload, because the choice is persisted', async ({ page }) => {
    // docs/08 §2: "persisted to Dexie". The toggle writes through `settings`,
    // and `initialLang` prefers a stored value over `navigator.language`.
    await gotoApp(page);
    await page.getByTestId('tt-lang-toggle').click();
    const chosen = await page.evaluate(() => document.documentElement.lang);

    /*
     * Wait for the WRITE, not for the paint.
     *
     * `switchLang` switches the runtime first and awaits Dexie second — on
     * purpose, so the UI never lags a click — which leaves a window where the
     * screen has changed and the row has not. Reloading inside that window is
     * how this test failed on its first run, and it is also what a real user
     * would lose the preference to. The trade-off is deliberate (`TtApp`), so
     * the test waits for the thing it actually claims to be testing.
     */
    await expect.poll(() => storedSettings(page)).toMatchObject({ lang: chosen });

    await page.reload();
    await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(chosen);
  });

  test('renders no raw key anywhere on the Setup screen, in either language', async ({ page }) => {
    /*
     * The failure mode this catches is specific: i18next returns the KEY when a
     * lookup misses, so a typo'd or unfiled string renders as `setup.start`
     * rather than as nothing. It looks like debug output and it is easy to miss
     * in a language you do not read — which is exactly the case for one of these
     * two languages, whoever is reviewing.
     */
    await gotoApp(page);
    for (let i = 0; i < 2; i += 1) {
      const text = (await page.getByTestId('tt-setup').textContent()) ?? '';
      expect(text).not.toMatch(/\b(setup|player|toast|gate|finished|yt)\.[a-z]/i);
      await page.getByTestId('tt-lang-toggle').click();
    }
  });
});
