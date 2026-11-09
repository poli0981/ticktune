import { test, expect, type Page } from './_fixtures';
import AxeBuilder from '@axe-core/playwright';
import {
  dismissUnloadDialogs,
  gotoApp,
  gotoSingleMode,
  setDuration,
  skipWithoutAudio,
  stagePlaylist,
  stageSingle,
  storedSettings,
} from './_helpers';
import { fireYtError, gotoYouTubeApp, seedSettings, stageLinks, ytReady } from './_helpers-yt';

/**
 * The accessibility pass — `docs/13 §6`, P7 slice B.
 *
 * `13 §6` asks for four things and this file owns two of them: the axe scan
 * (every surface a user spends time on, since v2.2) and the keyboard-only
 * journey. The contrast spot-check under the brightest background lives in
 * `backgrounds.spec.ts`, and reduced motion is covered there and in
 * `landing.spec.ts` — not duplicated here. (This header said it owned the
 * contrast check until v2.2; it never did.) Forced colours have their own file,
 * `forced-colors.spec.ts`.
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
 *
 * `wcag22aa` since v2.2 — ACCESSIBILITY.md names WCAG 2.2 AA as the target, and
 * a scan that cannot see 2.2's rules (target size, 2.5.8) would be quietly
 * narrower than the statement. axe has no `wcag22a` tag: the 2.2 Level A
 * criteria it could test do not exist in it.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

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

  test('the Japanese landing is clean (v2.0)', async ({ page }) => {
    await page.goto('/ja/');
    await scan(page);
  });

  test('Setup is clean in Japanese (v2.0)', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('tt-lang-ja').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
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

  /*
   * v2.2 — the surfaces the scan had never visited. Each is a screen a user
   * spends time on; none was ever checked by anything but eye.
   */

  test('Setup with an import summary is clean', async ({ page }) => {
    await gotoSingleMode(page);
    await stageSingle(page);
    await expect(page.getByTestId('tt-toast')).toBeVisible();
    await scan(page);
  });

  test('the Playlist rail, the track info dialog and Finished are clean', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stagePlaylist(page, ['tone-5s.mp3', 'tone-5s.wav']);
    // Long enough for two scans and a menu before zero arrives on its own.
    await setDuration(page, 0, 0, 8);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.getByTestId('tt-queue-row').first()).toHaveClass(/tt-current/);
    await scan(page);

    // The row's context menu, opened the way a keyboard user opens it.
    await page.getByTestId('tt-queue-row').first().locator('.tt-row-main').focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByTestId('tt-context-menu')).toBeVisible();
    await scan(page);
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('tt-finished')).toBeVisible({ timeout: 15_000 });
    await scan(page);
  });

  test('the Single rail’s track info dialog is clean', async ({ page }) => {
    await gotoSingleMode(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 30);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await page.getByTestId('tt-nowplaying').focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByTestId('tt-trackinfo')).toBeVisible();
    await scan(page);
  });

  test('the YouTube rail with an error card is clean', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoYouTubeApp(page);
    await stageLinks(page, ['jNQXAC9IVRw', '9bZkp7q19f0']);
    await setDuration(page, 0, 2, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.getByTestId('tt-yt-frame')).toBeVisible();
    await ytReady(page);
    await fireYtError(page, 150);
    await expect(page.getByTestId('tt-yt-overlay')).toBeVisible();
    // The frame is the stub's, not YouTube's: what is scanned is OUR rail.
    await scan(page);
  });

  test('the 404 page and an English legal document are clean', async ({ page }) => {
    await page.goto('/does-not-exist');
    await scan(page);
    await page.goto('/en/legal/eula/');
    await scan(page);
  });
});

/**
 * The light theme (v2.0, docs/03 §1) — every app screen again. Its palette was
 * picked by arithmetic (tests/unit/tt-palette.test.ts), but axe reads the
 * rendered page: a hard-coded colour that only looked right on dark is exactly
 * what the arithmetic cannot see.
 */
async function goLight(page: Page): Promise<void> {
  await gotoApp(page);
  await page.keyboard.press('s');
  await page.getByTestId('tt-set-theme-light').click();
  await expect.poll(() => storedSettings(page)).toMatchObject({ theme: 'light' });
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-tt-theme', 'light');
}

test.describe('axe, light theme — docs/13 §6', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'axe findings are engine-independent; one project is the honest cost',
  );

  test('the legal gate is clean', async ({ page }) => {
    await goLight(page);
    // A returning light-theme user whose acceptance is out of date.
    await seedSettings(page, { legalAccepted: null });
    await page.reload();
    await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);
    await expect(page.locator('[role=dialog]')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-tt-theme', 'light');
    await scan(page);
  });

  test('Setup is clean', async ({ page }) => {
    await goLight(page);
    await scan(page);
  });

  test('the Settings panel is clean', async ({ page }) => {
    await goLight(page);
    await page.keyboard.press('s');
    await expect(page.getByTestId('tt-settings')).toBeVisible();
    await scan(page);
  });

  test('the Player is clean', async ({ page }) => {
    await goLight(page);
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
    const hours = page.getByLabel('giờ', { exact: true });
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

  /*
   * ── v2.2 ────────────────────────────────────────────────────────────────
   * Each spec below was shown red on the code before its fix (docs/13 §6).
   */

  test('Space on a focused control is that control’s, not play/pause (WCAG 2.1.1)', async ({
    page,
    browserName,
  }) => {
    // The hotkey called preventDefault on Space during playback whatever had
    // focus: Space on ⏭ paused the run and skipped nothing.
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await skipWithoutAudio(page, browserName);
    await stagePlaylist(page, ['tone-5s.mp3', 'tone-5s.wav']);
    await setDuration(page, 0, 1, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    const rows = page.getByTestId('tt-queue-row');
    await expect(rows.first()).toHaveClass(/tt-current/);

    await page.getByRole('button', { name: 'Bài sau' }).focus();
    await page.keyboard.press('Space');
    await expect(rows.nth(1)).toHaveClass(/tt-current/);
    await expect(page.getByTestId('tt-playpause')).toHaveAttribute('aria-label', 'Tạm dừng');
  });

  test('the single-key shortcuts can be switched off (WCAG 2.1.4)', async ({ page }) => {
    await gotoApp(page);
    const panel = page.getByTestId('tt-settings');
    await page.keyboard.press('s');
    await expect(panel).toBeVisible();
    await page.getByRole('checkbox', { name: /Phím tắt một ký tự/ }).uncheck();
    await expect.poll(() => storedSettings(page)).toMatchObject({ letterKeys: false });
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    // Off: S opens nothing, M mutes nothing — the field is READ, not just stored.
    await page.keyboard.press('s');
    await page.keyboard.press('m');
    await expect(panel).toBeHidden();
    expect(await storedSettings(page)).toMatchObject({ muted: false });
  });

  test('the remaining time can be read on demand — a role=timer twin (WCAG 1.3.1)', async ({
    page,
  }) => {
    // The digits are aria-hidden; before v2.2 a reader heard the time only at
    // the five milestones.
    await gotoSingleMode(page);
    await stageSingle(page);
    await setDuration(page, 0, 2, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    const timer = page.getByRole('timer');
    await expect(timer).toContainText('Thời gian còn lại');
    await expect(timer).toContainText(/phút|giây/);
  });

  test('the bottom bar keeps focus, and its controls stay in the tree when idle', async ({
    page,
  }) => {
    dismissUnloadDialogs(page);
    await gotoSingleMode(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 30);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    const bar = page.getByTestId('tt-bottom-bar');

    // Idle with focus elsewhere: faded, but a screen reader in browse mode —
    // whose keys never reach the page — can still find ⏹.
    await expect(bar).toHaveAttribute('data-visible', 'false', { timeout: 8_000 });
    await expect(page.getByRole('button', { name: 'Dừng hẳn' })).toHaveCount(1);

    // Focus inside: it stays up past the 4 s idle, and keeps the focus.
    await page.getByRole('button', { name: 'Dừng hẳn' }).focus();
    await expect(bar).toHaveAttribute('data-visible', 'true');
    await page.waitForTimeout(5_000);
    await expect(bar).toHaveAttribute('data-visible', 'true');
    await expect(page.getByRole('button', { name: 'Dừng hẳn' })).toBeFocused();
  });

  test('the mode tabs are one tab stop, moved with the arrow keys', async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator('[role=tab][tabindex="0"]')).toHaveCount(1);
    const selected = page.locator('[role=tab][aria-selected=true]');
    await selected.focus();
    const before = await selected.getAttribute('data-testid');
    await page.keyboard.press('ArrowRight');
    const now = page.locator('[role=tab][aria-selected=true]');
    await expect(now).not.toHaveAttribute('data-testid', before ?? '');
    await expect(now).toBeFocused();
    await expect(page.getByRole('tabpanel')).toBeVisible();
  });

  test('the import summary lands in a live region that was already there', async ({ page }) => {
    // A region inserted already filled is announced by some readers only.
    await gotoSingleMode(page);
    const region = page.getByTestId('tt-import-status');
    await expect(region).toHaveAttribute('role', 'status');
    await expect(region).toBeEmpty();
    await stageSingle(page);
    await expect(region.getByTestId('tt-toast')).toBeVisible();
  });

  test('Finished takes focus when the player leaves (WCAG 2.4.3)', async ({ page }) => {
    // The player held focus and unmounted at zero; focus fell to <body>.
    dismissUnloadDialogs(page);
    await gotoSingleMode(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 2);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.getByTestId('tt-finished')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  });
});
