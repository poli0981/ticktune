import { test, expect } from './_fixtures';
import { dismissUnloadDialogs } from './_helpers';
import { gotoYouTubeApp, mockDurations, stageLinks, ytCalls } from './_helpers-yt';

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

/**
 * Links that cannot play here — docs/06 §3 (v2.3).
 *
 * oEmbed answers 200 for an age-restricted or region-blocked video, so until
 * v2.3 such a link reached the queue — and the fitted length — and failed only
 * on play, behind the TT-YT-150 card. The import's one Data API call now names
 * the reason first, and the link never lands. Every spec here fails on v2.2.1:
 * both rows land there.
 */
test.describe('links that cannot play here are left out — docs/06 §3 (v2.3)', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('a region-blocked link never reaches the queue or the fit, and the rest runs', async ({
    page,
  }) => {
    dismissUnloadDialogs(page);
    const asked = await mockDurations(
      page,
      { [ONE]: 213_000, [TWO]: 187_000 },
      { [TWO]: 'region_blocked' },
    );
    await gotoYouTubeApp(page);
    await stageLinks(page, [ONE, TWO], 1);

    await expect(page.getByTestId('tt-queue-row')).toContainText(`Video ${ONE}`);
    const toast = page.getByTestId('tt-toast');
    await expect(toast).toContainText('TT-YT-103');
    await expect(toast).toContainText('Không xem được ở quốc gia của bạn');

    // Its length is not in the fit: Match takes ONE's 3 min 33 s alone.
    await page.getByTestId('tt-match-length').click();
    await expect(page.getByLabel('phút', { exact: true })).toHaveValue('3');
    await expect(page.getByLabel('giây', { exact: true })).toHaveValue('33');
    // One call for the paste — its answer filled the lengths too.
    expect(asked).toEqual([[ONE, TWO]]);

    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect
      .poll(() => ytCalls(page))
      .toEqual(expect.arrayContaining([`loadVideoById:${ONE}`]));
  });

  for (const [cause, code, words] of [
    ['age_restricted', 'TT-YT-102', 'Giới hạn độ tuổi'],
    ['not_yet', 'TT-YT-104', 'Chưa ra mắt'],
    ['embed_off', 'TT-YT-101', 'Chủ video không cho phép nhúng'],
  ] as const) {
    test(`${cause} is left out with ${code}`, async ({ page }) => {
      dismissUnloadDialogs(page);
      await mockDurations(page, { [ONE]: 213_000, [TWO]: 60_000 }, { [TWO]: cause });
      await gotoYouTubeApp(page);
      await stageLinks(page, [ONE, TWO], 1);

      const toast = page.getByTestId('tt-toast');
      await expect(toast).toContainText(code);
      await expect(toast).toContainText(words);
    });
  }

  test('no answer leaves nothing out, and is not asked twice', async ({ page }) => {
    dismissUnloadDialogs(page);
    const asked = await mockDurations(page, 'not_configured');
    await gotoYouTubeApp(page);
    await stageLinks(page, [ONE, TWO], 2);

    await expect.poll(() => asked.length).toBe(1);
    await page.waitForTimeout(500);
    expect(asked).toHaveLength(1);
  });
});
