import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoApp, gotoSingleMode, setDuration, stageSingle } from './_helpers';

/**
 * The accessibility pass — `docs/13 §6`, P7 slice B.
 *
 * `13 §6` asks for four things and this file owns three of them: the axe scan on
 * Landing / Setup / Player / Settings, the keyboard-only journey, and the
 * contrast spot-check under the brightest background. Reduced motion already has
 * coverage in `backgrounds.spec.ts` and is not duplicated here.
 *
 * ## Why axe is only half the answer
 *
 * axe catches what is machine-checkable: missing names, bad contrast ratios,
 * broken ARIA, unlabelled controls. It cannot tell you whether the app is
 * **operable** — a page can be perfectly labelled and still trap a keyboard user
 * at the first dialog. That is what `keyboard-only journey` below is for, and it
 * is the half that would have caught the P7 defect where a thrown `AudioContext`
 * left the legal gate up forever with `inert` on everything behind it.
 *
 * Chromium only: axe's results are engine-independent in practice, and running
 * it four times over would triple the suite for identical findings. The
 * *behavioural* specs run everywhere.
 */

/**
 * WCAG 2.1 AA — the standard `13 §6` implies with its 4.5:1 rule — **plus
 * axe's best-practice set**.
 *
 * ⚠️ The WCAG tags alone are narrower than "accessible", and that is easy to
 * miss. Verified by mutation: demoting the landing's `<h1>` to `<h4>` produces a
 * `heading-order` / `page-has-heading-one` finding that the four `wcag*` tags do
 * **not** report, because heading order is a best practice rather than a
 * success criterion. A scan that stays green while a page loses its only `h1`
 * is not the scan anyone thinks they are running.
 *
 * `best-practice` is included for exactly that gap. The suite is clean under
 * both, so including it costs nothing today and catches the next regression.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

async function scan(page: Page, context?: string) {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const results = await (context ? builder.include(context) : builder).analyze();

  // Report the rule ids and the offending markup, not just a count — a bare
  // "3 violations" tells whoever sees the failure nothing about what to fix.
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.html.slice(0, 120)),
  }));

  expect(JSON.stringify(summary, null, 2)).toBe('[]');
}

test.describe('axe — docs/13 §6', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'axe findings are engine-independent; one project is the honest cost',
  );

  test('the Vietnamese landing is clean', async ({ page }) => {
    await page.goto('/');
    await scan(page);
  });

  test('the English landing is clean', async ({ page }) => {
    await page.goto('/en/');
    await scan(page);
  });

  test('a legal document is clean', async ({ page }) => {
    // The only long-form prose surface, and the one most likely to be read with
    // a screen reader — it is where someone checks what the app does with them.
    await page.goto('/legal/privacy/');
    await scan(page);
  });

  test('the legal gate is clean', async ({ page }) => {
    // Scanned BEFORE accepting: it is the first thing every user meets, it is a
    // modal dialog, and `TtApp` puts `inert` on everything behind it.
    await page.goto('/app/');
    await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);
    await expect(page.locator('[role=dialog]')).toBeVisible();
    await scan(page);
  });

  test('Setup is clean', async ({ page }) => {
    await gotoApp(page);
    await scan(page);
  });

  test('the Settings panel is clean', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('s');
    await expect(page.getByTestId('tt-settings')).toBeVisible();
    await scan(page);
  });

  test('the Player is clean', async ({ page }) => {
    await gotoSingleMode(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 30);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.locator('.tt-countdown')).toBeVisible();
    await scan(page);
  });
});

test.describe('keyboard only — docs/13 §6', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('the legal gate can be cleared without a mouse', async ({ page }) => {
    /*
     * 🔴 The gate is the one screen where being trapped is unrecoverable: it is
     * modal, everything behind it is `inert`, and it is the first thing a new
     * user sees. A keyboard user who cannot get past it cannot use the app at
     * all, and no amount of correct labelling would tell you that.
     */
    await page.goto('/app/');
    await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);

    const gate = page.locator('[role=dialog]');
    await expect(gate).toBeVisible();

    // Focus must already be inside the dialog — docs/03 §8. Landing on the page
    // behind an inert overlay is the classic version of this bug.
    const focusedInGate = await page.evaluate(
      () => !!document.activeElement?.closest('[role=dialog]'),
    );
    expect(focusedInGate, 'focus should start inside the gate dialog').toBe(true);

    await page.keyboard.press('Space'); // the agreement checkbox
    await expect(page.getByTestId('tt-gate-agree')).toBeChecked();

    // Tab to Accept and activate it. The button is the next focusable control.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    await expect(gate).toBeHidden();
  });

  test('a countdown can be started without a mouse', async ({ page }) => {
    /*
     * A track is staged first because `docs/02 §1`'s `isQueueValid` genuinely
     * requires one — Start stays `disabled` on an empty queue, which is the app
     * being correct, not an obstacle. Staging is a file drop and cannot be done
     * from the keyboard by anyone; what this spec owns is everything after it.
     */
    await gotoSingleMode(page);
    await stageSingle(page);

    /*
     * Located by ACCESSIBLE LABEL, not by testid — deliberately. This spec is
     * about whether a keyboard and a screen reader can drive the app, so the
     * locator should fail for the same reason a user would: if the label is
     * gone, the control is unusable, and `getByTestId` would happily keep
     * passing. `_helpers.setDuration` uses `getByLabel` for the same reason.
     */
    const hours = page.getByLabel('giờ');
    await hours.focus();
    await expect(hours).toBeFocused();

    const start = page.getByRole('button', { name: 'Bắt đầu' });
    await start.focus();
    await expect(start).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.locator('.tt-countdown')).toBeVisible();
  });

  test('the Settings panel opens, is reachable and closes on Escape', async ({ page }) => {
    await gotoApp(page);

    await page.keyboard.press('s');
    const panel = page.getByTestId('tt-settings');
    await expect(panel).toBeVisible();

    // Something inside must be reachable — a panel you can open but not operate
    // is worse than no shortcut, because it looks like it works.
    await page.keyboard.press('Tab');
    const inPanel = await page.evaluate(
      () => !!document.activeElement?.closest('[data-testid=tt-settings]'),
    );
    expect(inPanel, 'Tab from the opened panel should land inside it').toBe(true);

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });
});
