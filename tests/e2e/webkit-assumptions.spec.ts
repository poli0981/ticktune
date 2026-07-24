import { test, expect } from '@playwright/test';

/**
 * The assumption every WebKit skip rests on — P7 slice B.
 *
 * `skipWithoutAudio()` tells the reader that Playwright's WebKit build exposes
 * no `AudioContext`. That is measured, not assumed: it is why 130 of 166 specs
 * failed the first time desktop WebKit ran, and it is the stated reason ~20 of
 * them are skipped there.
 *
 * 🔴 **A skip is a claim, and a claim needs a guard.** If a future Playwright
 * upgrade ships a WebKit with Web Audio, every one of those skips silently
 * becomes a lie — the suite would keep reporting "cannot run here" about
 * something that now runs, and the coverage gap would never be reclaimed
 * because nothing would prompt anyone to look.
 *
 * So this fails when the assumption stops holding. A red test here means good
 * news and a small chore: delete the WebKit half of `skipWithoutAudio()` and
 * find out what genuinely passes.
 *
 * Deliberately NOT skipped on other browsers — it asserts the opposite there,
 * which is what makes it a statement about WebKit specifically rather than a
 * tautology.
 */
test.describe('harness assumptions', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('AudioContext availability matches what the skips claim', async ({ page, browserName }) => {
    await page.goto('/app/');

    const hasAudioContext = await page.evaluate(
      () => typeof (globalThis as { AudioContext?: unknown }).AudioContext !== 'undefined',
    );

    if (browserName === 'webkit') {
      expect(
        hasAudioContext,
        'WebKit now HAS AudioContext — remove the webkit branch of skipWithoutAudio() ' +
          'in tests/e2e/_helpers.ts and re-run to see what actually passes.',
      ).toBe(false);
    } else {
      expect(
        hasAudioContext,
        `${browserName} is expected to expose AudioContext; the audio specs assume it`,
      ).toBe(true);
    }
  });
});
