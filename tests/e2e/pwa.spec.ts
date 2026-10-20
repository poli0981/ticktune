import { test, expect, type Page } from './_fixtures';
import {
  dismissUnloadDialogs,
  gotoApp,
  setDuration,
  stageSingle,
  storedSettings,
} from './_helpers';

/**
 * Offline start — docs/10 §9 (v2.0).
 *
 * The promise is narrow and exact: a /app/ visited once starts with no network,
 * and the local modes then work — import a file, count down, finish. YouTube
 * still needs the network and says so (docs/06 §8); nothing here pretends
 * otherwise.
 *
 * Skipped by CAPABILITY, never by browser name (docs/13): a browser build that
 * cannot run a service worker, or never lets one claim the page, has nothing
 * to test here.
 */

/** Wait until a service worker controls this page; false if none ever will. */
async function controlled(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const ready = navigator.serviceWorker.ready.then(() => true);
    const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), 15_000));
    if (!(await Promise.race([ready, timeout]))) return false;
    if (navigator.serviceWorker.controller) return true;
    // `clients.claim()` lands as a controllerchange shortly after activation.
    return new Promise<boolean>((r) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => r(true), { once: true });
      setTimeout(() => r(navigator.serviceWorker.controller !== null), 5_000);
    });
  });
}

test.describe('offline start — docs/10 §9', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');
  // The suite blocks service workers (playwright.config.ts says why); this is
  // the one place that is about them.
  test.use({ serviceWorkers: 'allow' });

  test('a visited /app/ starts offline, imports a file and counts down', async ({
    page,
    context,
  }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    test.skip(!(await controlled(page)), 'no service worker took control in this browser build');
    // The acceptance must be ON DISK before the reload: a write still in
    // flight dies with the page (`storedSettings`' own note). The worker can
    // take control while the gate is still being accepted, and on CI the
    // reload won that race — the gate came back offline.
    await expect.poll(async () => (await storedSettings(page))?.['legalAccepted']).toBeTruthy();

    await context.setOffline(true);
    const reloaded = await page.reload().then(
      () => true,
      (e: unknown) => {
        if (e instanceof Error && e.message.includes('NS_ERROR_OFFLINE')) return false;
        throw e;
      },
    );
    // Playwright's Firefox offline mode refuses the navigation before any
    // service worker can answer it. That is the emulation, not the app: a real
    // offline Firefox start is a manual line of the v2.0 live checklist.
    test.skip(
      !reloaded,
      'offline emulation refuses navigations before the worker (NS_ERROR_OFFLINE)',
    );
    await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);
    // The gate was accepted online and Dexie kept it: no dialog offline.
    await expect(page.locator('[role=dialog]')).toHaveCount(0);

    await stageSingle(page);
    await setDuration(page, 0, 0, 2);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.getByTestId('tt-finished')).toBeVisible({ timeout: 15_000 });
  });

  test('only /app/ is controlled — the landing stays a plain page', async ({ page }) => {
    await gotoApp(page);
    test.skip(!(await controlled(page)), 'no service worker took control in this browser build');

    await page.goto('/');
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  });

  test('/app/ links the manifest; the landing does not', async ({ page }) => {
    await page.goto('/app/');
    await expect(page.locator('link[rel=manifest]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    await page.goto('/');
    await expect(page.locator('link[rel=manifest]')).toHaveCount(0);
  });
});
