import { readFileSync } from 'node:fs';
import { test, expect } from './_fixtures';
import { gotoApp, storedSettings } from './_helpers';

/**
 * The settings file — docs/02 §3.4 (v2.0).
 *
 * Export, change something, import the file back: the old value returns, it
 * survives a reload, and the legal acceptance never travels — neither out in
 * the file nor in over the current one.
 */

test.describe('settings file — docs/02 §3.4', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('exports, imports back, and the import persists', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('tt-settings-open').click();

    // A recognisable state to export: background "solid".
    await page.getByTestId('tt-set-bg-solid').click();
    await expect.poll(() => storedSettings(page)).toMatchObject({ background: 'solid' });

    const download = page.waitForEvent('download');
    await page.getByTestId('tt-set-export').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^ticktune-settings-\d{8}\.json$/);
    const path = await file.path();
    const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(json).toMatchObject({ app: 'ticktune', kind: 'settings' });
    expect(json['settings']).toMatchObject({ background: 'solid' });
    expect(json['settings']).not.toHaveProperty('legalAccepted');

    // Change it, then bring the file back.
    await page.getByTestId('tt-set-bg-gradient').click();
    await expect.poll(() => storedSettings(page)).toMatchObject({ background: 'gradient' });
    await page.getByTestId('tt-set-import-file').setInputFiles(path);
    await expect(page.getByTestId('tt-set-io-status')).toHaveAttribute('role', 'status');
    await expect(page.getByTestId('tt-set-bg-solid')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => storedSettings(page)).toMatchObject({ background: 'solid' });

    // It persisted, and the acceptance stayed: no gate after a reload.
    await page.reload();
    await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);
    await expect(page.locator('[role=dialog]')).toHaveCount(0);
    const stored = await storedSettings(page);
    expect(stored).toMatchObject({ background: 'solid' });
    expect(stored?.['legalAccepted']).not.toBeNull();
  });

  test('a file that is not ours changes nothing and says so', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('tt-settings-open').click();
    await page.getByTestId('tt-set-bg-solid').click();
    await expect.poll(() => storedSettings(page)).toMatchObject({ background: 'solid' });

    await page.getByTestId('tt-set-import-file').setInputFiles({
      name: 'something.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ background: 'gradient' })),
    });
    const status = page.getByTestId('tt-set-io-status');
    await expect(status).toHaveAttribute('role', 'alert');
    await expect(page.getByTestId('tt-set-bg-solid')).toHaveAttribute('aria-pressed', 'true');
    expect(await storedSettings(page)).toMatchObject({ background: 'solid' });
  });
});
