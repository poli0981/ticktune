import { test, expect } from '@playwright/test';

/**
 * What the audio skips rest on — P7 slice B, and it has already earned its keep.
 *
 * ## The version this replaces, and why it was wrong
 *
 * `skipWithoutAudio()` originally skipped on `browserName === 'webkit'`, stating
 * that "Playwright's WebKit build exposes no `AudioContext`". That is true on
 * **Windows** — it is why 130 of 166 specs failed the first time desktop WebKit
 * ran — and **false on the Linux CI runner**, which has it.
 *
 * 🔴 This file caught that on the very first CI run after it was written. The
 * guard was added on the theory that "a future Playwright build might gain
 * `AudioContext`"; what it actually found was that the assumption was **already
 * false on another platform**, one day later.
 *
 * The fix was not to make this assertion platform-aware. It was to stop guessing:
 * `skipWithoutAudio()` now **feature-tests** `AudioContext` and skips on the
 * capability. A feature test cannot drift from the platform, so the thing this
 * file was guarding no longer needs guarding.
 *
 * ## What it asserts now
 *
 * That the capability check is **load-bearing** — that at least one desktop
 * project really does expose `AudioContext`, so `skipWithoutAudio()` is not
 * quietly skipping everywhere and turning the audio tier into decoration. A
 * suite where every audio test skips on every browser reports green and proves
 * nothing, and nothing else in the suite would notice.
 */
test.describe('harness assumptions', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('the audio capability check reflects reality on this build', async ({
    page,
    browserName,
  }) => {
    await page.goto('/app/');

    const hasAudioContext = await page.evaluate(
      () => typeof (globalThis as { AudioContext?: unknown }).AudioContext !== 'undefined',
    );

    /*
     * Chromium is the project that carries the audible-output assertions
     * (`docs/13 §3`). If it ever lost `AudioContext`, `skipWithoutAudio()` would
     * silently skip the entire audio tier and the suite would still be green —
     * the exact failure mode this file exists to make impossible.
     */
    if (browserName === 'chromium') {
      expect(
        hasAudioContext,
        'Chromium must expose AudioContext — it is the only project asserting audible output, ' +
          'and without it the whole audio tier skips silently.',
      ).toBe(true);
    }

    // Everything else is informational: WebKit differs by platform (absent on
    // Windows, present on Linux CI) and that is precisely why the skip is a
    // feature test rather than a browser-name check. Recorded, not asserted.
    // eslint-disable-next-line no-console
    console.log(`[harness] ${browserName}: AudioContext ${hasAudioContext ? 'present' : 'absent'}`);
  });
});
