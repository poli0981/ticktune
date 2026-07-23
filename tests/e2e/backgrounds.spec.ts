import { test, expect, type Page } from '@playwright/test';
import { gotoApp, storedSettings } from './_helpers';

/**
 * docs/03 §2 Z1 — P5 slice 3.
 *
 * The slice owes one thing above all: proof that each Display field is
 * genuinely READ. Eight of the fourteen fields `16 §P5` measured as
 * "persisted and read by nobody" are in this group, and every one of them had
 * passing unit tests the whole time — because a clamp test passes whether or
 * not anything consumes the value.
 */

/** The computed style of the base layer, which is what the fields drive. */
async function baseStyle(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid=tt-backdrop-base]') as HTMLElement;
    const cs = getComputedStyle(el);
    return `${cs.backgroundImage} | ${cs.backgroundColor} | ${cs.filter}`;
  });
}

async function scrim(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number(
      document.querySelector('[data-testid=tt-backdrop-scrim]')?.getAttribute('data-tt-scrim') ??
        -1,
    ),
  );
}

async function openDisplay(page: Page): Promise<void> {
  await gotoApp(page);
  await page.keyboard.press('s');
  await expect(page.getByTestId('tt-set-display')).toBeVisible();
}

test.describe('the Z1 background stack', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('the backdrop is behind the app, not over it', async ({ page }) => {
    /*
     * Z1 is the bottom of `03 §2`'s stack. It is fixed and full-bleed, so
     * getting the paint order wrong makes it cover the entire interface — and
     * `.tt-main` gained `position: relative; z-index: 1` in this slice for
     * exactly that reason. Asserted by hit-testing the countdown, which is the
     * thing that would disappear.
     */
    await gotoApp(page);
    await expect(page.getByTestId('tt-backdrop')).toBeAttached();
    const hit = await page.evaluate(() => {
      const clock = document.querySelector('.tt-countdown') as HTMLElement;
      const r = clock.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return document.querySelector('[data-testid=tt-backdrop]')?.contains(top) ?? false;
    });
    expect(hit).toBe(false);
  });

  test('background: solid is READ — the gradient goes', async ({ page }) => {
    await openDisplay(page);
    await page.getByTestId('tt-set-bg-gradient').click();
    expect(await baseStyle(page)).toContain('gradient');

    await page.getByTestId('tt-set-bg-solid').click();
    expect(await baseStyle(page)).not.toContain('gradient');
  });

  test('gradientPreset is READ — each swatch paints something different', async ({ page }) => {
    await openDisplay(page);
    await page.getByTestId('tt-set-bg-gradient').click();

    const seen = new Set<string>();
    for (const i of [0, 1, 2, 3, 4, 5]) {
      await page.getByTestId(`tt-set-preset-${i}`).click();
      seen.add(await baseStyle(page));
    }
    // Six presets, six distinct paints. A single duplicate would mean one
    // swatch is decorative.
    expect(seen.size).toBe(6);
  });

  test('gradientCustom is READ, and returns to the preset when cleared', async ({ page }) => {
    await openDisplay(page);
    await page.getByTestId('tt-set-bg-gradient').click();
    await page.getByTestId('tt-set-preset-0').click();
    const preset = await baseStyle(page);

    await page.getByTestId('tt-set-custom-from').fill('#ff0000');
    const custom = await baseStyle(page);
    expect(custom).not.toBe(preset);
    expect(custom).toContain('255, 0, 0');

    await page.getByTestId('tt-set-custom-clear').click();
    expect(await baseStyle(page)).toBe(preset);
  });

  test('scanlines is READ', async ({ page }) => {
    await openDisplay(page);
    await page.getByTestId('tt-set-scanlines').uncheck();
    await expect(page.getByTestId('tt-backdrop-scanlines')).toHaveCount(0);
    await page.getByTestId('tt-set-scanlines').check();
    await expect(page.getByTestId('tt-backdrop-scanlines')).toBeAttached();
  });

  test('scrimStrength is READ, and scrimAuto never lowers it', async ({ page }) => {
    // docs/02 §3.1. Over the default dark gradient auto has nothing to add, so
    // the two paths have to agree — which is the only place "never lowers" is
    // observable end to end.
    await openDisplay(page);
    await page.getByTestId('tt-set-scrimauto').uncheck();
    await page.getByTestId('tt-set-scrim').fill('0.6');
    expect(await scrim(page)).toBeCloseTo(0.6, 3);

    await page.getByTestId('tt-set-scrimauto').check();
    expect(await scrim(page)).toBeGreaterThanOrEqual(0.6);

    await page.getByTestId('tt-set-scrim').fill('0.35');
    expect(await scrim(page)).toBeGreaterThanOrEqual(0.35);
  });

  test('the whole Display choice survives a reload', async ({ page }) => {
    await openDisplay(page);
    await page.getByTestId('tt-set-bg-gradient').click();
    await page.getByTestId('tt-set-preset-4').click();
    await page.getByTestId('tt-set-scanlines').uncheck();
    const before = await baseStyle(page);

    /*
     * Wait for the WRITE, not for a delay. `settings.patch()` updates memory
     * synchronously and Dexie asynchronously, and every call site fires it with
     * `void` — so reloading straight after a click out-runs the write and reads
     * back the old value, which is indistinguishable from the setting never
     * persisting. Measured here: this spec failed exactly that way first.
     */
    await expect
      .poll(() => storedSettings(page))
      .toMatchObject({
        scanlines: false,
        gradientPreset: 4,
      });

    await page.reload();
    await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);
    expect(await baseStyle(page)).toBe(before);
    await expect(page.getByTestId('tt-backdrop-scanlines')).toHaveCount(0);
  });

  test('slideshow settings appear only for slideshow', async ({ page }) => {
    // The same "a control ships with its feature" rule applied inside a group:
    // an interval slider that governs nothing is the defect in miniature.
    await openDisplay(page);
    await page.getByTestId('tt-set-bg-gradient').click();
    await expect(page.getByTestId('tt-set-interval')).toHaveCount(0);

    await page.getByTestId('tt-set-bg-slideshow').click();
    await expect(page.getByTestId('tt-set-interval')).toBeVisible();
    await expect(page.getByTestId('tt-set-xfade-kenburns')).toBeVisible();
  });

  test('a picture mode with no pictures explains itself', async ({ page }) => {
    /*
     * The reload case. Hard invariant 1 keeps the files in RAM, so the CHOICE
     * persists and the pictures do not — and a user who set a slideshow
     * yesterday must not simply find a gradient with no explanation.
     */
    await openDisplay(page);
    await page.getByTestId('tt-set-bg-slideshow').click();
    await expect(page.getByTestId('tt-set-bg-empty')).toBeVisible();
    // ...and the stack still paints, rather than going blank.
    await expect(page.getByTestId('tt-backdrop-base')).toBeAttached();
    expect(await baseStyle(page)).toContain('gradient');
  });

  test('picking pictures renders them and clearing removes them', async ({ page }) => {
    await openDisplay(page);
    await page.getByTestId('tt-set-bg-slideshow').click();
    await page
      .getByTestId('tt-set-bg-files')
      .setInputFiles(['tests/e2e/fixtures/bg-a.png', 'tests/e2e/fixtures/bg-b.png']);

    await expect(page.getByTestId('tt-backdrop-photo')).toHaveCount(2);
    await expect(page.getByTestId('tt-set-bg-count')).toBeVisible();

    await page.getByTestId('tt-set-bg-clear').click();
    await expect(page.getByTestId('tt-backdrop-photo')).toHaveCount(0);
    await expect(page.getByTestId('tt-set-bg-empty')).toBeVisible();
  });

  test('a non-image is refused rather than rendered', async ({ page }) => {
    // TT-IMG-001 (docs/12 §6), and the Diagnostics viewer is where it shows up.
    await openDisplay(page);
    await page.getByTestId('tt-set-bg-image').click();
    await page.getByTestId('tt-set-bg-files').setInputFiles(['tests/e2e/fixtures/tone-5s.mp3']);

    await expect(page.getByTestId('tt-backdrop-photo')).toHaveCount(0);
    await expect(page.getByTestId('tt-set-log')).toContainText('TT-IMG-001');
  });
});

test.describe('reduced motion — docs/03 §8, docs/02 §3.1', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  /*
   * ⚠️ `page.emulateMedia()`, NOT `test.use({ reducedMotion: 'reduce' })`.
   *
   * Measured 2026-07-23 on @playwright/test 1.61.1: with the fixture option set
   * on this describe block, `matchMedia('(prefers-reduced-motion: reduce)')`
   * still reported **false** in the page and the scanlines rendered — so the
   * test failed for an environment reason while looking like a product bug.
   * The explicit call reports true. Left as a call rather than "fixed" silently,
   * because the next person to reach for the fixture option deserves the note.
   */
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('suppresses scanlines at render time and leaves the setting alone', async ({ page }) => {
    /*
     * The rule `02 §3.1` states and nothing enforced until now: reduced motion
     * "does not rewrite these values". A build that switched `scanlines` off in
     * the store instead would look identical here and would silently destroy
     * the user's preference the first time they opened the app on a machine
     * with the OS setting on.
     */
    await openDisplay(page);
    await expect(page.getByTestId('tt-set-scanlines')).toBeChecked();
    await expect(page.getByTestId('tt-backdrop-scanlines')).toHaveCount(0);

    await page.reload();
    await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);
    await page.keyboard.press('s');
    // Still ON in storage after a full round trip.
    await expect(page.getByTestId('tt-set-scanlines')).toBeChecked();
  });
});
