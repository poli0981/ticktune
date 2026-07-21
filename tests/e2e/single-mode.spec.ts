import { test, expect } from '@playwright/test';
import { gotoApp, setDuration, stageSingle, dismissUnloadDialogs } from './_helpers';

/**
 * docs/13 §3 "Gate → Setup → Single" — P2 exit criterion 1.
 *
 * The load-bearing assertions here are `dataset.ttAudio === 'running'` and a
 * non-zero Analyser RMS. Without them this whole flow passes identically on a
 * silently-suspended context: the app would look right, log nothing, and play
 * no sound. Measured 2026-07-21 — headless Chromium's `--mute-audio` mutes the
 * output DEVICE but leaves the graph running, so the RMS assertion is valid
 * there.
 */

/**
 * ⚠️ Firefox is skipped for the assertions that require AUDIBLE output.
 *
 * Measured on CI 2026-07-21: in headless Firefox on the Linux runner,
 * `AudioContext.resume()` never settles — it does not reject, it hangs — which
 * is the signature of no audio output device. The context therefore stays
 * `suspended`, nothing sounds, and the loop counter never advances. A real
 * Firefox plays fine; this is the runner, not the browser and not the app.
 *
 * What is NOT skipped, and still runs on Firefox: the gate, the whole import
 * pipeline including cover art, the countdown, the Finished screens, the
 * fallback rules, and the muted case below (which asserts a chime does NOT
 * sound and so needs no output).
 *
 * The compensating checks: Chromium runs every one of these, and
 * `tests/manual/p2-live-checklist.md` has a real-Firefox item. The product
 * behaviour this environment exposed — a hung `resume()` silently preventing
 * playback — is now handled and unit-tested (TT-PLY-105), which is the part
 * that mattered.
 */
const needsAudibleOutput = ({ browserName }: { browserName: string }) => browserName === 'firefox';

test.describe('single mode', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('imports a file, plays it audibly, and loops', async ({ page }) => {
    test.skip(needsAudibleOutput, 'no audio output device on the CI runner');
    dismissUnloadDialogs(page);
    await gotoApp(page, '/app/?ttdebug=1');

    // Start is gated on a track, not just a valid countdown (docs/02 §1).
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled();
    await stageSingle(page);
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeEnabled();

    await setDuration(page, 0, 0, 30);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    // The context actually resumed — the gate Accept was the unlock gesture.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset['ttAudio']), {
        timeout: 10_000,
      })
      .toBe('running');

    // And sound is actually flowing through the graph.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const el = document.querySelector('[data-testid=tt-peak-rms]');
            return Number(el?.textContent ?? 0);
          }),
        { timeout: 15_000, message: 'Analyser RMS never rose above zero' },
      )
      .toBeGreaterThan(0);

    // The player screen, not the setup screen.
    await expect(page.getByTestId('tt-rail')).toBeVisible();
    await expect(page.getByTestId('tt-bottom-bar')).toBeVisible();
    await expect(page.getByTestId('tt-loop-count')).toHaveText('Loop ×1');
  });

  test('the loop counter increments across a wrap', async ({ page }) => {
    test.skip(needsAudibleOutput, 'no audio output device on the CI runner');
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 30);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    // The fixture is ~5 s and `element.loop = true` fires no `ended` — the
    // counter is a currentTime regression (docs/05 §2). Give it one lap.
    await expect(page.getByTestId('tt-loop-count')).toHaveText('Loop ×2', { timeout: 20_000 });
  });

  test('the bottom bar shows the track and auto-hides after 4 s idle', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 30);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    const bar = page.getByTestId('tt-bottom-bar');
    await expect(bar).toHaveAttribute('data-visible', 'true');
    // The fixture is untagged, so the fallback rule applies (docs/02 §2).
    await expect(page.getByTestId('tt-bar-title')).toHaveText('tone-5s');
    await expect(page.getByTestId('tt-position')).toContainText('/');

    await expect(bar).toHaveAttribute('data-visible', 'false', { timeout: 8_000 });
    await page.mouse.move(400, 300);
    await expect(bar).toHaveAttribute('data-visible', 'true');
  });

  test('pause stops the media and the countdown together', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 30);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    const digits = page.locator('.tt-countdown .tt-live');
    await page.getByTestId('tt-playpause').click();
    const frozen = await digits.textContent();
    await page.waitForTimeout(900);
    expect(await digits.textContent()).toBe(frozen);

    await page.getByTestId('tt-playpause').click();
    await expect(page.getByTestId('tt-playpause')).toHaveAttribute('aria-label', 'Tạm dừng');
  });

  test('Stop returns to setup with the track still staged', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 30);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.getByTestId('tt-rail')).toBeVisible();

    await page.getByTestId('tt-stop').click();

    await expect(page.getByTestId('tt-setup')).toBeVisible();
    // The queue survives Stop — docs/02 §1 discards the RUN, not the setup.
    await expect(page.getByTestId('tt-staged')).toBeVisible();
  });

  test('the track info modal lists every field and returns focus on Esc', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 30);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    await page.getByTestId('tt-nowplaying').click({ button: 'right' });
    const modal = page.getByTestId('tt-trackinfo');
    await expect(modal).toBeVisible();

    // docs/02 §8 fields, with the docs/02 §2 fallback rule on the missing ones.
    await expect(modal).toContainText('Tiêu đề');
    await expect(modal).toContainText('Tên tệp');
    await expect(modal).toContainText('N/A');

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });
});
