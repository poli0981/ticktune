import { test, expect } from './_fixtures';
import { dismissUnloadDialogs } from './_helpers';
import { gotoYouTubeApp, mockDurations, stageLinks } from './_helpers-yt';

/**
 * Link lengths at import — docs/06 §3 (v2.0), docs/03 §3.
 *
 * Until v2.0 a link's length existed only once the player had loaded it, so a
 * YouTube queue's total read `–` and "Match queue length" was disabled for every
 * link queue, by construction. The Data API now answers at import, through our
 * Worker; these specs stand in for it with `page.route`, as `docs/13 §3` does
 * for oEmbed.
 */

const ONE = 'jNQXAC9IVRw';
const TWO = '9bZkp7q19f0';

test.describe('YouTube lengths from the Data API — docs/06 §3', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('fill the queue total and enable "Match queue length"', async ({ page }) => {
    dismissUnloadDialogs(page);
    const asked = await mockDurations(page, { [ONE]: 213_000, [TWO]: 187_000 });
    await gotoYouTubeApp(page);
    await stageLinks(page, [ONE, TWO]);

    const match = page.getByTestId('tt-match-length');
    await expect(match).toBeEnabled();
    await expect(page.getByTestId('tt-queue-totals')).not.toContainText('–');
    await match.click();
    // 213 s + 187 s = 400 s = 0 h 6 min 40 s.
    await expect(page.getByLabel('giờ', { exact: true })).toHaveValue('0');
    await expect(page.getByLabel('phút', { exact: true })).toHaveValue('6');
    await expect(page.getByLabel('giây', { exact: true })).toHaveValue('40');

    // One request for the whole paste — the quota is per call, not per link.
    expect(asked).toEqual([[ONE, TWO]]);
  });

  test('a later paste asks only for the links still without a length', async ({ page }) => {
    dismissUnloadDialogs(page);
    const asked = await mockDurations(page, { [ONE]: 213_000, [TWO]: 187_000 });
    await gotoYouTubeApp(page);
    await stageLinks(page, [ONE]);
    await expect(page.getByTestId('tt-match-length')).toBeEnabled();
    await stageLinks(page, [TWO], 2);
    await expect(page.getByTestId('tt-match-length')).toBeEnabled();

    expect(asked).toEqual([[ONE], [TWO]]);
  });

  for (const failure of ['not_configured', 'rate_limited'] as const) {
    test(`no answer (${failure}) keeps lengths unknown and Match disabled with its reason`, async ({
      page,
    }) => {
      dismissUnloadDialogs(page);
      const asked = await mockDurations(page, failure);
      await gotoYouTubeApp(page);
      await stageLinks(page, [ONE]);

      await expect.poll(() => asked.length).toBe(1);
      await expect(page.getByTestId('tt-queue-totals')).toContainText('–');
      const match = page.getByTestId('tt-match-length');
      await expect(match).toBeDisabled();
      await expect(match).not.toHaveAttribute('title', '');
    });
  }

  test('a video with no length (live, private) leaves Match disabled', async ({ page }) => {
    dismissUnloadDialogs(page);
    const asked = await mockDurations(page, { [ONE]: 213_000, [TWO]: null });
    await gotoYouTubeApp(page);
    await stageLinks(page, [ONE, TWO]);

    await expect.poll(() => asked.length).toBe(1);
    await expect(page.getByTestId('tt-match-length')).toBeDisabled();
  });
});
