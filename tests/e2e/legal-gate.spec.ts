import { test, expect, type Page } from '@playwright/test';
import { storedSettings } from './_helpers';

/**
 * Legal gate + settings persistence — docs/02 §1, §3.2, docs/03 §3.2.
 *
 * The three amended P1 exit criteria (docs/16 P1 exit review) live here: the
 * gate blocks first run, Accept survives a reload, and a TT_LEGAL_VERSION bump
 * re-shows it.
 */
test.describe('legal gate', () => {
  test.skip(
    ({ isMobile }) => !!isMobile,
    'desktop projects only — the island does not load on mobile',
  );

  const gate = (p: Page) => p.locator('[role=dialog]');
  const accept = (p: Page) => p.getByTestId('tt-gate-accept');
  const agree = (p: Page) => p.getByTestId('tt-gate-agree');

  test('blocks on first run and Accept requires the checkbox', async ({ page }) => {
    await page.goto('/app/');
    await expect(gate(page)).toBeVisible();
    // docs/03 §3.2: single checkbox gates the button.
    await expect(accept(page)).toBeDisabled();
    await agree(page).check();
    await expect(accept(page)).toBeEnabled();
  });

  test('the countdown behind it is inert while the gate is up', async ({ page }) => {
    await page.goto('/app/');
    await expect(gate(page)).toBeVisible();
    // Present in the DOM but not reachable — a modal you can tab past is not a gate.
    await expect(page.locator('main')).toHaveAttribute('inert', '');
  });

  test('acceptance persists across a reload', async ({ page }) => {
    await page.goto('/app/');
    await agree(page).check();
    await accept(page).click();
    await expect(gate(page)).toBeHidden();
    await expect(page.locator('.tt-countdown')).toBeVisible();

    /*
     * The gate hides synchronously (`session.gateAccepted()`) while the Dexie
     * write is awaited afterwards — deliberately, so the click never lags. That
     * leaves a window in which the screen has moved on and the row has not, and
     * reloading inside it re-shows the gate. Latent here since P1 and never
     * observed; the identical shape went flaky on CI in `settings.spec.ts`
     * once a slow runner finally lost the race.
     */
    await expect
      .poll(() => storedSettings(page))
      .toMatchObject({ legalAccepted: expect.objectContaining({ version: expect.any(String) }) });

    await page.reload();
    await expect(page.locator('.tt-countdown')).toBeVisible();
    await expect(gate(page)).toHaveCount(0);
  });

  test('a TT_LEGAL_VERSION bump re-shows it', async ({ page }) => {
    await page.goto('/app/');
    await agree(page).check();
    await accept(page).click();
    await expect(gate(page)).toBeHidden();

    // Simulate the next release changing legal/*.md and bumping the constant:
    // rewrite the stored acceptance to an older version, exactly as a returning
    // user's row would look.
    await page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const req = indexedDB.open('ticktune');
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      if (!db.objectStoreNames.contains('settings')) throw new Error('settings store missing');
      await new Promise((res, rej) => {
        const store = db.transaction('settings', 'readwrite').objectStore('settings');
        const get = store.get('app');
        get.onsuccess = () => {
          const row = get.result;
          row.legalAccepted = { version: '0.9-old', acceptedAt: Date.now() };
          const put = store.put(row);
          put.onsuccess = () => res(null);
          put.onerror = () => rej(put.error);
        };
        get.onerror = () => rej(get.error);
      });
      db.close();
    });

    await page.reload();
    await expect(gate(page)).toBeVisible();
  });

  test('a corrupt settings row falls back to defaults instead of blocking boot', async ({
    page,
  }) => {
    // docs/02 §1: boot must always reach gate or setup. docs/02 §3.2: a bad row
    // logs TT-SYS-204 and uses defaults — it must not wedge the app.
    await page.goto('/app/');
    // Accept first, so Dexie has created the store and there is a row to corrupt.
    await agree(page).check();
    await accept(page).click();
    await expect(gate(page)).toBeHidden();

    await page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const req = indexedDB.open('ticktune');
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      await new Promise((res, rej) => {
        const put = db
          .transaction('settings', 'readwrite')
          .objectStore('settings')
          .put({ key: 'app', legalAccepted: 'garbage' });
        put.onsuccess = () => res(null);
        put.onerror = () => rej(put.error);
      });
      db.close();
    });

    await page.reload();
    // Malformed acceptance is treated as no acceptance — fail closed, not open.
    await expect(gate(page)).toBeVisible();
  });
});
