import { test, expect, type Page } from './_fixtures';
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

test.describe('the way out — docs/03 §3 item 2 (v2.1)', () => {
  test.skip(
    ({ isMobile }) => !!isMobile,
    'desktop projects only — the island does not load on mobile',
  );

  test('goes back where the user came from, and stores nothing', async ({ page }) => {
    await page.goto('/');
    const landing = page.url();
    await page.goto('/app/');
    await expect(page.locator('[role=dialog]')).toBeVisible();

    await page.getByTestId('tt-gate-leave').click();

    // The exact URL: a first draft matched `/\/$/`, which `/app/` satisfies
    // too, so on a slower back navigation (local WebKit) it passed before
    // anything had moved and then read the app's two headings.
    await expect(page).toHaveURL(landing);
    await expect(page.locator('[role=dialog]')).toHaveCount(0);
    expect((await storedSettings(page))?.['legalAccepted'] ?? null).toBeNull();
  });

  test('with nothing behind it, the tab closes or turns blank — never a home page', async ({
    context,
  }) => {
    const page = await context.newPage();
    await page.goto('/app/');
    await expect(page.locator('[role=dialog]')).toBeVisible();

    /*
     * Which one is the engine's call: script may close a one-entry tab in some
     * browsers and not in others. Either is the documented outcome.
     *
     * 🔴 CI's Firefox does close it, and the first draft of this spec failed
     * there with the feature working. A page that closes rejects every pending
     * wait on it, so `waitForURL` lost the race by REJECTING, and the click
     * itself can end with the page it was clicking. Both now read a close as
     * the close it is.
     */
    const closed = page.waitForEvent('close').then(() => 'closed' as const);
    const blank = page.waitForURL('about:blank').then(
      () => 'blank' as const,
      () => 'closed' as const,
    );
    await page
      .getByTestId('tt-gate-leave')
      .click()
      .catch(() => undefined);
    expect(['closed', 'blank']).toContain(await Promise.race([closed, blank]));
  });

  test('keeps the keyboard order the gate relies on: checkbox, Accept, then this', async ({
    page,
  }) => {
    await page.goto('/app/');
    await expect(page.locator('[role=dialog]')).toBeVisible();
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('tt-gate-accept')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('tt-gate-leave')).toBeFocused();
  });
});
