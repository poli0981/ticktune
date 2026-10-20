import { test, expect, type Page } from '../e2e/_fixtures';
import {
  dismissUnloadDialogs,
  gotoApp,
  gotoSingleMode,
  setDuration,
  stageSingle,
} from '../e2e/_helpers';
import { seedSettings } from '../e2e/_helpers-yt';

/**
 * Every screen, both themes — docs/13 §3 (v2.0).
 *
 * The suites above assert what an element IS; this asserts what the page LOOKS
 * like, which is where a token typo, a z-index slip or a theme that misses one
 * surface shows and nothing else does. Baselines come from the pinned
 * Playwright image only (playwright.visual.config.ts).
 *
 * The analytics beacon is stubbed by the shared fixture, as in every E2E spec.
 */

const shot = (page: Page, name: string, mask: string[] = []) =>
  expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: false,
    mask: mask.map((m) => page.locator(m)),
  });

/** A returning user's app in the given theme: gate accepted, settings seeded. */
async function app(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await gotoApp(page);
  await seedSettings(page, { theme });
  await page.reload();
  await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);
  await expect(page.locator('html')).toHaveAttribute('data-tt-theme', theme);
  await page.evaluate(() => document.fonts.ready);
}

test.describe('static pages', () => {
  for (const [name, path] of [
    ['landing-vi', '/'],
    ['landing-en', '/en/'],
    ['legal-privacy-vi', '/legal/privacy/'],
    ['not-found', '/404'],
  ] as const) {
    test(name, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await shot(page, name);
    });
  }
});

test.describe('the app — both themes', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`legal gate — ${theme}`, async ({ page }) => {
      await app(page, theme);
      await seedSettings(page, { legalAccepted: null });
      await page.reload();
      await expect(page.locator('[role=dialog]')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await shot(page, `gate-${theme}`);
    });

    test(`setup — ${theme}`, async ({ page }) => {
      await app(page, theme);
      await shot(page, `setup-${theme}`);
    });

    test(`settings panel — ${theme}`, async ({ page }) => {
      await app(page, theme);
      await page.getByTestId('tt-settings-open').click();
      await expect(page.getByTestId('tt-settings')).toBeVisible();
      await shot(page, `settings-${theme}`);
    });

    test(`player, paused — ${theme}`, async ({ page }) => {
      dismissUnloadDialogs(page);
      await app(page, theme);
      await gotoSingleMode(page);
      await stageSingle(page);
      await setDuration(page, 0, 5, 0);
      await page.getByRole('button', { name: 'Bắt đầu' }).click();
      await page.keyboard.press('Space');
      // What a running clock and a moving transport would change between runs.
      await shot(page, `player-${theme}`, ['.tt-countdown', '[data-testid=tt-bottom-bar]']);
    });
  }
});
