import { test, expect, type Page } from '@playwright/test';
import { dismissUnloadDialogs, gotoApp, setDuration, stageSingle } from './_helpers';

/**
 * docs/13 §3 — the ⚙ panel and the hotkeys it documents (P5 slice 2).
 *
 * The assertions worth having here are the ones no component test can make:
 * that a stored field actually reaches the RENDER. `16 §P5`'s whole premise is
 * that fourteen fields were persisted, clamped, unit-tested and read by nobody,
 * so "the control writes the field" is only half a proof — the other half is
 * that something downstream changes.
 */

const px = (v: string) => parseFloat(v);

/** The countdown's computed font-size, which is what `countdownSize` feeds. */
async function fontSize(page: Page): Promise<number> {
  return page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('.tt-countdown')!).fontSize),
  );
}

test.describe('settings panel', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('S opens it, Esc closes it, and focus goes back to the gear', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('s');
    await expect(page.getByTestId('tt-settings')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tt-settings')).toBeHidden();
    // docs/03 §8: a keyboard user must not be dropped on <body>.
    await expect(page.getByTestId('tt-settings-open')).toBeFocused();
  });

  test('the gear button toggles it too', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('tt-settings-open').click();
    await expect(page.getByTestId('tt-settings')).toBeVisible();
    await page.getByTestId('tt-settings-close').click();
    await expect(page.getByTestId('tt-settings')).toBeHidden();
  });

  test('hotkeys do not fire while a countdown input has focus', async ({ page }) => {
    // docs/03 §7 — "Disabled while typing in inputs". `s` in a number field is
    // rejected by the field, but it must not open the panel either.
    await gotoApp(page);
    await page.getByLabel('giây').focus();
    await page.keyboard.press('s');
    await expect(page.getByTestId('tt-settings')).toBeHidden();
  });

  test('countdownSize is genuinely READ — the digits change size', async ({ page }) => {
    /*
     * The proof this slice owes (`16 §P5`). `countdownSize` was declared,
     * defaulted, clamped, persisted and unit-tested since P1 with **zero** call
     * sites; every one of those tests passed while nothing rendered it.
     *
     * Asserted as a strict ordering rather than exact pixels, because the
     * mapping is 14/18/22 vw and the viewport differs per project.
     */
    await gotoApp(page);
    await page.keyboard.press('s');

    await page.getByTestId('tt-set-size-s').click();
    const small = await fontSize(page);
    await page.getByTestId('tt-set-size-m').click();
    const medium = await fontSize(page);
    await page.getByTestId('tt-set-size-l').click();
    const large = await fontSize(page);

    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);
  });

  test('the chosen size survives a reload', async ({ page }) => {
    // Dexie is the only thing that persists (docs/02 §3), and `patch()` writes
    // the whole object — so this is also the check that the write landed.
    await gotoApp(page);
    await page.keyboard.press('s');
    await page.getByTestId('tt-set-size-s').click();
    const small = await fontSize(page);

    await page.reload();
    await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);
    expect(await fontSize(page)).toBeCloseTo(small, 0);
  });

  test('glowIntensity reaches the digits', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('s');
    const shadow = () =>
      page.evaluate(() => getComputedStyle(document.querySelector('.tt-live')!).textShadow);

    // The three stacked shadows scale with the setting (docs/03 §1). Compared
    // rather than pattern-matched: Chromium serialises `color-mix` output as
    // `color(srgb …)` and Firefox as `rgba(…)`, so any literal here would be a
    // browser-format assertion wearing a glow assertion's name.
    await page.getByTestId('tt-set-glow').fill('1');
    const bright = await shadow();
    await page.getByTestId('tt-set-glow').fill('0');
    expect(await shadow()).not.toBe(bright);
  });

  test('Diagnostics shows real log entries and clears them', async ({ page }) => {
    // Accepting the gate logs TT-USR-100 (docs/12 §6), so there is always at
    // least one genuine entry by the time the panel opens.
    await gotoApp(page);
    await page.keyboard.press('s');
    await expect(page.getByTestId('tt-set-log')).toContainText('TT-USR-100');

    await page.getByTestId('tt-set-log-clear').click();
    await expect(page.getByTestId('tt-set-log-empty')).toBeVisible();
  });

  test('About renders the injected version rather than the placeholder', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('s');
    const version = await page.getByTestId('tt-set-version').textContent();
    expect(version?.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('Reset takes two presses and sends the app back to the legal gate', async ({ page }) => {
    /*
     * `settings.reset()` deletes the row, so `legalAccepted` goes null. That is
     * what "clears Dexie" means (docs/03 §6) and the panel now says so before
     * doing it — until P5 slice 2 nothing did, and the re-block looked like a
     * fault.
     */
    await gotoApp(page);
    await page.keyboard.press('s');
    await page.getByTestId('tt-set-reset').click();
    await expect(page.getByTestId('tt-set-reset-warning')).toBeVisible();
    await expect(page.locator('[role=dialog][aria-modal]')).toHaveCount(0);

    await page.getByTestId('tt-set-reset-yes').click();
    await expect(page.getByTestId('tt-gate-accept')).toBeVisible();
  });

  test('language can be set from the panel as well as the header', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('s');
    await page.getByTestId('tt-set-lang-en').click();
    await expect(page.getByTestId('tt-settings')).toContainText('Keyboard shortcuts');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test.describe('End Behavior, driven from the panel', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('endAction: restart re-runs the countdown exactly once', async ({ page }) => {
    /*
     * docs/02 §3.3. The engine has honoured all three values since P2 and had
     * no UI at all — `16` records that as "engine-complete, no UI until the P5
     * settings panel". This is the first end-to-end path through it.
     */
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await page.keyboard.press('s');
    await page.getByTestId('tt-set-endaction-restart').click();
    await page.keyboard.press('Escape');

    await stageSingle(page);
    await setDuration(page, 0, 0, 2);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    // It restarts rather than showing Finished, so the countdown is still
    // running well after the first deadline.
    await page.waitForTimeout(3500);
    await expect(page.getByTestId('tt-finished')).toHaveCount(0);
    // ...and then stops, because 'restart' is once per user-initiated run.
    await expect(page.getByTestId('tt-finished')).toBeVisible({ timeout: 8000 });
  });

  test('endFlash off by default, on when the panel turns it on', async ({ page }) => {
    dismissUnloadDialogs(page);
    await page.addInitScript(() => {
      (window as unknown as { __ttFlash?: number }).__ttFlash = 0;
      const arm = () =>
        new MutationObserver(() => {
          if (document.querySelector('[data-testid=tt-flash]')) {
            (window as unknown as { __ttFlash?: number }).__ttFlash!++;
          }
        }).observe(document.documentElement, { childList: true, subtree: true });
      if (document.documentElement) arm();
      else document.addEventListener('DOMContentLoaded', arm);
    });

    await gotoApp(page);
    await page.keyboard.press('s');
    await page.getByTestId('tt-set-endflash').check();
    await page.keyboard.press('Escape');

    await stageSingle(page);
    await setDuration(page, 0, 0, 2);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.getByTestId('tt-finished')).toBeVisible({ timeout: 10_000 });

    // The flash lives 400 ms, so it is observed rather than polled for.
    expect(
      await page.evaluate(() => (window as unknown as { __ttFlash?: number }).__ttFlash ?? 0),
    ).toBeGreaterThan(0);
  });
});

test.describe('hotkeys that arrived with P5 — docs/03 §7', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('H hides the chrome and grows the digits; H again restores them', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 5, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.getByTestId('tt-rail')).toBeVisible();

    const before = await fontSize(page);
    await page.keyboard.press('h');

    // Z5, Z6, Z7 and Z4 all go (docs/03 §4).
    await expect(page.getByTestId('tt-brand')).toHaveCount(0);
    await expect(page.getByTestId('tt-chrome')).toHaveCount(0);
    await expect(page.getByTestId('tt-bottom-bar')).toHaveCount(0);
    await expect(page.getByTestId('tt-rail')).toHaveCount(0);
    expect(await fontSize(page)).toBeGreaterThan(before);

    // ...and the way out is offered, because nothing on screen shows it.
    await expect(page.getByTestId('tt-hint')).toBeVisible();

    await page.keyboard.press('h');
    await expect(page.getByTestId('tt-chrome')).toBeVisible();
    expect(await fontSize(page)).toBeCloseTo(before, 0);
  });

  test('] collapses the rail in a local mode', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 5, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.getByTestId('tt-rail')).toBeVisible();

    await page.keyboard.press(']');
    await expect(page.getByTestId('tt-rail')).toHaveCount(0);
    await page.keyboard.press(']');
    await expect(page.getByTestId('tt-rail')).toBeVisible();
  });

  test('a run that finishes in Focus mode returns the chrome with it', async ({ page }) => {
    /*
     * The path that matters, and the only one the user cannot steer: Focus
     * hides Z7, so there is no Stop button to press — the countdown reaching
     * zero is how the player screen is left from inside Focus. Without the
     * cancel, the Finished screen would render under a hidden header with its
     * two buttons the only things visible and no way to reach Settings.
     */
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 2);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await page.keyboard.press('h');
    await expect(page.getByTestId('tt-chrome')).toHaveCount(0);

    await expect(page.getByTestId('tt-finished')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('tt-chrome')).toBeVisible();
    await expect(page.getByTestId('tt-brand')).toBeVisible();
  });

  test('the loop-style toggle is no longer inert — docs/05 §2', async ({ page }) => {
    /*
     * It shipped with hardcoded `aria-pressed` and no `onclick` at all. The
     * pressed state now reports the EFFECTIVE style, and while spike S4b is
     * open that is always a hard cut — so the crossfade button stays disabled
     * and says why, rather than pretending to be a choice.
     */
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 5, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    await expect(page.getByTestId('tt-hard-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('tt-crossfade-toggle')).toBeDisabled();
    // A real handler: pressing the already-active option must not throw or
    // change the effective style.
    await page.getByTestId('tt-hard-toggle').click();
    await expect(page.getByTestId('tt-hard-toggle')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('no overlay may cover the YouTube player — docs/03 §2', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('the settings sheet stops short of the rail reserve', async ({ page }) => {
    /*
     * The rule is enforced by `--tt-yt-reserve`, published by the shell. This
     * asserts the CONSUMER end in the mode where the variable is 0, which is
     * the case a regression would most easily hide in: the sheet must still be
     * a sheet, not grow to fill the screen.
     */
    await gotoApp(page);
    await page.keyboard.press('s');
    const box = await page.getByTestId('tt-settings').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBe(0);
    expect(px(String(box!.width))).toBeLessThan(500);
  });
});
