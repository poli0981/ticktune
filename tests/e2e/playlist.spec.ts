import { test, expect } from '@playwright/test';
import {
  dismissUnloadDialogs,
  gotoApp,
  setDuration,
  stageManyTracks,
  stagePlaylist,
} from './_helpers';

/**
 * docs/13 §3 — Playlist mode, P3 slice 1.
 *
 * The three fixtures are ~5 s each, so an advance is observable inside a normal
 * test timeout without any clock manipulation.
 *
 * ⚠️ Firefox is skipped for exactly ONE test — the one that requires audible
 * output and a real `ended` event. docs/13 §3 records why: on the Linux CI
 * runner `AudioContext.resume()` hangs rather than rejecting, so the context
 * never runs.
 *
 * Everything else runs on Firefox, deliberately. The transport, the exhaustion
 * message, removal-during-playback and the shuffle toggle all assert queue
 * STATE — a highlight, a disabled control, a title — and none of them reads the
 * Analyser. Skipping them "because audio" would state a reason that is not
 * true, make the matrix look thinner than it is, and hide any Firefox-only
 * regression in the parts that do work there. Advancing the cursor is a
 * synchronous store operation; whether the deck then makes a sound is a
 * separate question, and only the one test below asks it.
 */

const THREE = ['tone-5s.mp3', 'tone-5s.flac', 'tone-5s.wav'];

/** Peak Analyser RMS, published under ?ttdebug=1 — the "is it audible" seam. */
const rms = (): number => {
  const el = document.querySelector('[data-testid=tt-peak-rms]');
  return Number(el?.textContent ?? 0);
};

test.describe('playlist mode', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('the Playlist tab is enabled and is where a fresh profile lands', async ({ page }) => {
    await gotoApp(page);
    // docs/02 §1: "Mode default: Playlist on first run." P2 forced `single`
    // without writing `lastMode` precisely so this would work on unlock.
    await expect(page.getByTestId('tt-tab-playlist')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tt-queue-panel')).toBeVisible();
  });

  test('imports several files at once and reports the totals', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stagePlaylist(page, THREE);

    // 3 × ~5 s against the 91:00 aggregate cap (docs/02 §4).
    await expect(page.getByTestId('tt-queue-totals')).toContainText('3 bài');
    await expect(page.getByTestId('tt-queue-totals')).toContainText('/ 91:00');
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeEnabled();
  });

  test('plays the queue in order, audibly, advancing on its own', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'no audio output device on the CI runner');
    dismissUnloadDialogs(page);
    await gotoApp(page, '/app/?ttdebug=1');
    await stagePlaylist(page, THREE);
    await setDuration(page, 0, 1, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    const rows = page.getByTestId('tt-queue-row');
    await expect(rows.first()).toHaveClass(/tt-current/);

    // Sound is actually flowing — "no error thrown" passes identically on a
    // silently-suspended context, which is the whole reason this assertion is
    // here rather than a screenshot of the highlight.
    await expect.poll(() => page.evaluate(rms), { timeout: 15_000 }).toBeGreaterThan(0);

    // The fixture ends and `ended` fires, because a playlist track loads with
    // loop:false (docs/05 §2). Nothing is clicked to make this happen.
    await expect(rows.nth(1)).toHaveClass(/tt-current/, { timeout: 20_000 });
    // And the NEW track is audible too: an advance that loads a dead deck would
    // still move the highlight.
    await expect.poll(() => page.evaluate(rms), { timeout: 15_000 }).toBeGreaterThan(0);
  });

  test('⏭ jumps ahead and ⏮ comes back; ⏮ is inert on the first track', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stagePlaylist(page, THREE);
    await setDuration(page, 0, 1, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    const rows = page.getByTestId('tt-queue-row');
    // docs/02 §5.1: prev does not wrap, so at the head the control says so.
    await expect(page.getByTestId('tt-prev')).toBeDisabled();
    await expect(page.getByTestId('tt-next')).toBeEnabled();

    await page.getByTestId('tt-next').click();
    await expect(rows.nth(1)).toHaveClass(/tt-current/);

    await page.getByTestId('tt-prev').click();
    await expect(rows.first()).toHaveClass(/tt-current/);
    await expect(page.getByTestId('tt-prev')).toBeDisabled();
  });

  test('with Repeat off the playlist ends in silence and the countdown runs on', async ({
    page,
  }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stagePlaylist(page, THREE);
    await page.getByTestId('tt-repeat').click(); // default is ON (docs/02 §3.1)
    await setDuration(page, 0, 2, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    // Skip to the end rather than waiting out three fixtures.
    await page.getByTestId('tt-next').click();
    await page.getByTestId('tt-next').click();
    await page.getByTestId('tt-next').click();

    await expect(page.getByTestId('tt-playlist-ended')).toBeVisible();

    // docs/02 §5.1 rule 6 / docs/04 §5 — the timer is untouched. A countdown
    // that quietly died because a playlist ran out would be the worse bug, and
    // it is the failure this assertion exists to catch.
    await expect(page.getByTestId('tt-bottom-bar')).toBeVisible();
    const first = await page.locator('.tt-countdown .tt-live').textContent();
    await expect
      .poll(() => page.locator('.tt-countdown .tt-live').textContent(), { timeout: 10_000 })
      .not.toBe(first);
  });

  test('removing the playing track advances instead of stopping', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stagePlaylist(page, THREE);
    await setDuration(page, 0, 1, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    const rows = page.getByTestId('tt-queue-row');
    await expect(rows.first()).toHaveClass(/tt-current/);
    await page.getByTestId('tt-queue-remove').first().click();

    // Two rows left, and the cursor is on what was row 2 — not restarted at the
    // top, which is what a cursor-by-index would have done (docs/02 §5.1).
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveClass(/tt-current/);
    await expect(page.getByTestId('tt-playlist-ended')).toBeHidden();
  });

  test('shuffle keeps the current track current', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stagePlaylist(page, THREE);
    await setDuration(page, 0, 1, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    await page.getByTestId('tt-next').click();
    const playing = await page.getByTestId('tt-bar-title').textContent();

    await page.getByTestId('tt-shuffle').click();

    // docs/02 §5.1 rule 2: immediate means "reorder the future", never "cut off
    // the present". A toggle that stopped the music would read as a crash.
    await expect(page.getByTestId('tt-shuffle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('tt-bar-title')).toHaveText(playing ?? '');
  });

  test('the context menu opens the info modal for the row that was targeted', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stagePlaylist(page, THREE);

    // Row 3 is the .wav fixture. Binding the modal to the playing track instead
    // of the targeted one would show row 1 here and look entirely correct.
    await page
      .getByTestId('tt-queue-row')
      .nth(2)
      .locator('button')
      .first()
      .click({ button: 'right' });
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('tone-5s.wav');
  });

  /**
   * Reported from the live app on 2026-07-22 with a 24-track queue: rows past
   * about the sixteenth painted BELOW the panel's border, over the bottom bar
   * and off the screen. Every existing test used three tracks, so nothing ever
   * exceeded `max-height: 60vh` and the clipping was never exercised.
   *
   * Asserted as geometry rather than as a screenshot: what makes it a bug is
   * that the rail leaves the viewport and covers Z7, and that is measurable.
   */
  test('a long queue scrolls inside the rail instead of overflowing it', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageManyTracks(page, 24);
    await setDuration(page, 0, 1, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();

    const panel = page.getByTestId('tt-queue-panel');
    await expect(panel).toBeVisible();

    const viewport = page.viewportSize();
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    // The panel fits on screen. Before the fix its height was the full content
    // height and this bottom edge sat far past the viewport.
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);

    // The rows stay INSIDE the panel. This is the assertion that matches what
    // the bug looked like: the rail's own box was correctly capped at 60vh, so
    // the check above passed while the list painted straight through the
    // border, over Z7 and off the screen.
    const rowsBox = await page.locator('.tt-rows').boundingBox();
    expect(rowsBox!.y + rowsBox!.height).toBeLessThanOrEqual(box!.y + box!.height);

    // And it is the ROW LIST that scrolls — a panel that fits only because the
    // rows were clipped away would satisfy the checks above while hiding tracks
    // the user cannot reach.
    const scrolls = await page.locator('.tt-rows').evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(scrolls.scrollHeight).toBeGreaterThan(scrolls.clientHeight);

    // The last row is reachable by scrolling, so nothing is lost.
    const last = page.getByTestId('tt-queue-row').last();
    await last.scrollIntoViewIfNeeded();
    const lastBox = await last.boundingBox();
    expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(viewport!.height);
  });

  /**
   * The same 24-track queue on Setup, where the panel stacks above the countdown
   * inputs and Start rather than owning its own column.
   *
   * At the rail's 60vh a long queue added ~430 px to a screen that was already
   * tall, and Start ended up far past the fold. The `setup` variant caps it, and
   * Start stays reachable — which is the property worth pinning, not the pixel.
   */
  test('on Setup the panel is capped so Start stays reachable', async ({ page }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageManyTracks(page, 24);

    const panel = page.getByTestId('tt-queue-panel');
    await expect(panel).toHaveAttribute('data-tt-variant', 'setup');

    const box = await panel.boundingBox();
    // Well under the rail's 60vh (432 px at this viewport). A regression back to
    // the shared height would sail past this.
    expect(box!.height).toBeLessThanOrEqual(280);

    // Rows still stay inside, and still scroll.
    const rowsBox = await page.locator('.tt-rows').boundingBox();
    expect(rowsBox!.y + rowsBox!.height).toBeLessThanOrEqual(box!.y + box!.height);

    const start = page.getByRole('button', { name: 'Bắt đầu' });
    await start.scrollIntoViewIfNeeded();
    await expect(start).toBeInViewport();
    await expect(start).toBeEnabled();
  });

  test('switching to Single mode keeps the queue and explains why Start is off', async ({
    page,
  }) => {
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stagePlaylist(page, THREE);

    await page.getByTestId('tt-tab-single').click();

    // docs/03 §3 — the queue is the user's work; readiness is a predicate.
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled();
    await expect(page.getByTestId('tt-start-hint')).toContainText('chỉ nhận đúng một tệp');

    await page.getByTestId('tt-tab-playlist').click();
    await expect(page.getByTestId('tt-queue-row')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeEnabled();
  });
});
