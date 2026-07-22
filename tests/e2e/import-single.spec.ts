import { test, expect } from '@playwright/test';
import { gotoSingleMode, dismissUnloadDialogs, dropFiles } from './_helpers';

/**
 * docs/13 §3 "Playlist limits", the Single-mode half — every rejection the
 * importer can produce, asserted through the toast's `data-tt-code`.
 *
 * The codes are non-identifying by construction (docs/12 §6), so exposing them
 * in the DOM is safe and gives E2E a specific assertion without a Settings
 * panel to read the log from.
 */
test.describe('single-mode import', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  const pick = (path: string) => `tests/e2e/fixtures/${path}`;

  test('rejects a container outside the allow-list (TT-IMP-001)', async ({ page }) => {
    await gotoSingleMode(page);
    await page.getByTestId('tt-file-input').setInputFiles(pick('rejected.aiff'));

    await expect(page.locator('[data-tt-code="TT-IMP-001"]')).toBeVisible();
    await expect(page.getByTestId('tt-staged')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled();
  });

  test('rejects a track over 10:02 (TT-IMP-002)', async ({ page }) => {
    await gotoSingleMode(page);
    await page.getByTestId('tt-file-input').setInputFiles(pick('over-limit-11min.mp3'));

    await expect(page.locator('[data-tt-code="TT-IMP-002"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled();
  });

  test('a multi-file DROP takes one and reports the rest (TT-IMP-004)', async ({ page }) => {
    // The picker is single-select in Single mode, so this path is reachable
    // only by dropping — which is also the path that has to survive the
    // capacity check being hoisted ahead of the per-file work (docs/02 §4).
    dismissUnloadDialogs(page);
    await gotoSingleMode(page);
    await dropFiles(page, ['tone-5s.mp3', 'tone-5s.flac', 'tone-5s.wav']);

    await expect(page.getByTestId('tt-staged')).toBeVisible();
    await expect(page.locator('[data-tt-code="TT-IMP-004"]')).toBeVisible();
    await expect(page.getByTestId('tt-toast')).toContainText('Đã thêm 1');
  });

  test('a second import REPLACES the held track (docs/02 §4)', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoSingleMode(page);

    await page.getByTestId('tt-file-input').setInputFiles(pick('tone-5s.mp3'));
    await expect(page.getByTestId('tt-staged')).toContainText('tone-5s');

    // Rejecting this would strand a user who simply wants a different track
    // behind a remove control they have not found yet.
    await page.getByTestId('tt-file-input').setInputFiles(pick('vi-id3v24-utf8.mp3'));
    await expect(page.getByTestId('tt-staged')).not.toContainText('tone-5s');
    await expect(page.getByTestId('tt-staged')).toHaveCount(1);
  });

  test('Vietnamese tags survive a v2.4 UTF-8 frame', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoSingleMode(page);
    await page.getByTestId('tt-file-input').setInputFiles(pick('vi-id3v24-utf8.mp3'));

    // Spike S3's acceptance criterion, now asserted through the real UI:
    // diacritics intact, not merely "some title appeared".
    await expect(page.getByTestId('tt-staged')).toContainText('Nắng ấm xa dần');
  });

  test('an ID3v1-only tag falls back to the file name (TT-IMP-007)', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoSingleMode(page);
    await page.getByTestId('tt-file-input').setInputFiles(pick('vi-id3v1-only.mp3'));

    // The rule spike S3 replaced: ID3v1 has no charset field, so a non-ASCII
    // tag is unrecoverable and the file name is the honest fallback. The track
    // is still IMPORTED — this is a note, not a rejection.
    await expect(page.locator('[data-tt-code="TT-IMP-007"]')).toBeVisible();
    await expect(page.getByTestId('tt-staged')).toContainText('vi-id3v1-only');
  });

  test('embedded cover art is extracted and shown (docs/05 §5)', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoSingleMode(page);
    await page.getByTestId('tt-file-input').setInputFiles(pick('with-cover.mp3'));
    await expect(page.getByTestId('tt-staged')).toBeVisible();

    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await page.getByTestId('tt-nowplaying').click({ button: 'right' });

    // The row said N/A for every file until P2's cover path was implemented —
    // honest, but only because nothing ever extracted the picture.
    const modal = page.getByTestId('tt-trackinfo');
    await expect(modal).toContainText('Ảnh bìa');
    await expect(modal).not.toContainText('Ảnh bìa\tN/A');

    const img = page.getByTestId('tt-cover');
    await expect(img).toBeVisible();
    // A blob: URL from the ledger, and one that actually decoded.
    await expect(img).toHaveAttribute('src', /^blob:/);
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  });

  test('a file with no cover still reports N/A', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoSingleMode(page);
    await page.getByTestId('tt-file-input').setInputFiles(pick('tone-5s.mp3'));
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await page.getByTestId('tt-nowplaying').click({ button: 'right' });

    await expect(page.getByTestId('tt-trackinfo')).toContainText('N/A');
    await expect(page.getByTestId('tt-cover')).toBeHidden();
  });

  test('removing the staged track disables Start again', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoSingleMode(page);
    await page.getByTestId('tt-file-input').setInputFiles(pick('tone-5s.mp3'));
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeEnabled();

    await page.getByTestId('tt-remove-track').click();

    // docs/02 §1: dropping below validity just disables Start — no state
    // transition, which is the whole point of `ready` being a predicate.
    await expect(page.getByTestId('tt-staged')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled();
  });
});
