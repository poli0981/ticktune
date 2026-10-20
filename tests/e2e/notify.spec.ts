import { test, expect, type Page } from './_fixtures';
import { dismissUnloadDialogs, gotoSingleMode, setDuration, stageSingle } from './_helpers';
import { clickNote, focusCount, installNotifyStub, notes, setHidden } from './_helpers-notify';

/**
 * The finish notification — docs/04 §2 (v2.0), released by spike S5's GO.
 *
 * What these pin is the WIRING, the place this project's defects live: the
 * setting reaching the driver, visibility reaching the worker, one
 * notification at zero only when hidden, none for a paused run, closed on
 * return, a click that focuses — and Safari's shape, where the page takes over.
 * The worker's and the page's `Notification` are recorders (_helpers-notify).
 */

async function enableNotify(page: Page): Promise<void> {
  await page.getByTestId('tt-settings-open').click();
  await page.getByTestId('tt-set-notify').check();
  await expect(page.getByTestId('tt-set-notify')).toBeChecked();
  await page.getByTestId('tt-settings-close').click();
}

async function threeSecondRun(page: Page): Promise<void> {
  await stageSingle(page);
  await setDuration(page, 0, 0, 3);
  await page.getByRole('button', { name: 'Bắt đầu' }).click();
}

const shows = (all: Array<{ kind: string }>, kind = 'worker-show') =>
  all.filter((n) => n.kind === kind);

test.describe('finish notification — docs/04 §2', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('hidden at zero: exactly one, from the worker, and it never names the track', async ({
    page,
  }) => {
    dismissUnloadDialogs(page);
    await installNotifyStub(page);
    await gotoSingleMode(page);
    await enableNotify(page);
    await threeSecondRun(page);
    await setHidden(page, true);

    await expect.poll(async () => shows(await notes(page)).length, { timeout: 8_000 }).toBe(1);
    // Past zero, and still one: the core fires exactly once per run.
    await page.waitForTimeout(1_000);
    const all = await notes(page);
    expect(shows(all)).toHaveLength(1);
    const shown = shows(all)[0]!;
    expect(shown.title).toBe('TickTune');
    expect(shown.tag).toBe('ticktune-finish');
    // A notification centre keeps a history: no title, no file name, ever.
    expect(JSON.stringify(shown)).not.toContain('tone-5s');
  });

  test('visible at zero: none — the screen already says it', async ({ page }) => {
    dismissUnloadDialogs(page);
    await installNotifyStub(page);
    await gotoSingleMode(page);
    await enableNotify(page);
    await threeSecondRun(page);
    await expect(page.getByTestId('tt-finished')).toBeVisible({ timeout: 8_000 });
    expect(shows(await notes(page))).toHaveLength(0);
  });

  test('coming back closes it, and a click focuses the tab', async ({ page }) => {
    dismissUnloadDialogs(page);
    await installNotifyStub(page);
    await gotoSingleMode(page);
    await enableNotify(page);
    await threeSecondRun(page);
    await setHidden(page, true);
    await expect.poll(async () => shows(await notes(page)).length, { timeout: 8_000 }).toBe(1);

    const before = await focusCount(page);
    await clickNote(page);
    await expect.poll(() => focusCount(page)).toBeGreaterThan(before);

    await setHidden(page, false);
    await expect
      .poll(async () => (await notes(page)).some((n) => n.kind === 'worker-close'))
      .toBe(true);
  });

  test('paused while hidden: none — a paused countdown never reaches zero', async ({ page }) => {
    dismissUnloadDialogs(page);
    await installNotifyStub(page);
    await gotoSingleMode(page);
    await enableNotify(page);
    await threeSecondRun(page);
    await page.keyboard.press('Space'); // pause
    await setHidden(page, true);
    await page.waitForTimeout(4_500);
    expect(shows(await notes(page))).toHaveLength(0);
  });

  test('off by default: hidden at zero shows nothing', async ({ page }) => {
    dismissUnloadDialogs(page);
    await installNotifyStub(page);
    await gotoSingleMode(page);
    await threeSecondRun(page);
    await setHidden(page, true);
    await page.waitForTimeout(4_500);
    expect(shows(await notes(page))).toHaveLength(0);
  });

  test('a worker without Notification (Safari): the page shows it instead', async ({ page }) => {
    dismissUnloadDialogs(page);
    await installNotifyStub(page, { workerNotification: false });
    await gotoSingleMode(page);
    await enableNotify(page);
    await threeSecondRun(page);
    await setHidden(page, true);

    await expect
      .poll(async () => shows(await notes(page), 'page-show').length, { timeout: 8_000 })
      .toBe(1);
    expect(shows(await notes(page))).toHaveLength(0);
  });
});
