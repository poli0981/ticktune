import { expect, test, type Page } from './_fixtures';
import { dismissUnloadDialogs } from './_helpers';
import {
  gotoYouTubeApp,
  mockDurations,
  mockPlaylists,
  pastePlaylists,
  ytReady,
} from './_helpers-yt';

/**
 * YouTube playlists — docs/06 §9 (v2.1), the owner's "playlist mode".
 *
 * Up to ten playlists per paste, expanded into the SAME shelf and the same
 * per-video pipeline a paste of links takes. The Worker route is
 * `tests/worker/playlists.test.ts`'s; what only this tier can see is what the
 * app SENDS and what the user is TOLD.
 */

const A = 'PLaaaaaaaaaaaaaaaa';
const B = 'PLbbbbbbbbbbbbbbbb';
const V = ['dQw4w9WgXcQ', 'jNQXAC9IVRw', '9bZkp7q19f0'] as const;
const rows = (page: Page) => page.getByTestId('tt-queue-row');
const toast = (page: Page) => page.getByTestId('tt-toast');
const playlistUrl = (id: string) => `https://www.youtube.com/playlist?list=${id}`;

/** `count` distinct, well-formed video ids. */
const vids = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(10, '0')}`);

test.describe('the Playlist kind — docs/06 §9', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test.beforeEach(async ({ page }) => {
    dismissUnloadDialogs(page);
  });

  test('expands two lists into the queue, in paste order then playlist order', async ({ page }) => {
    await gotoYouTubeApp(page);
    const asked = await mockPlaylists(page, { [A]: { ids: [V[0], V[1]] }, [B]: { ids: [V[2]] } });

    await pastePlaylists(page, [playlistUrl(A), playlistUrl(B)]);

    await expect(rows(page)).toHaveCount(3);
    expect(asked).toEqual([[A, B]]); // ONE call for the paste
    for (const [i, id] of V.entries()) await expect(rows(page).nth(i)).toContainText(`Video ${id}`);
  });

  test('takes `list=` over `v=` in this kind — and `v=` in the Video kind', async ({ page }) => {
    await gotoYouTubeApp(page);
    await mockPlaylists(page, { [A]: { ids: [V[1], V[2]] } });
    const insideAList = `https://www.youtube.com/watch?v=${V[0]}&list=${A}&index=2`;

    await pastePlaylists(page, [insideAList]);
    await expect(rows(page)).toHaveCount(2);

    await page.getByTestId('tt-yt-kind-videos').click();
    await page.getByTestId('tt-yt-input').fill(insideAList);
    await page.getByTestId('tt-yt-add').click();
    await expect(rows(page)).toHaveCount(3); // only V[0], the video
  });

  test('a Mix and a personal list are refused before any request', async ({ page }) => {
    await gotoYouTubeApp(page);
    const asked = await mockPlaylists(page, {});

    await pastePlaylists(page, [
      `https://www.youtube.com/watch?v=${V[0]}&list=RD${V[0]}`,
      'https://www.youtube.com/playlist?list=WL',
    ]);

    await expect(toast(page).locator('[data-tt-code="TT-YT-012"]')).toContainText('×2');
    expect(asked).toEqual([]);
    await expect(rows(page)).toHaveCount(0);
  });

  test('names a list that is gone, counts the private entries, and keeps the rest', async ({
    page,
  }) => {
    await gotoYouTubeApp(page);
    await mockPlaylists(page, {
      [A]: { error: 'not_found' },
      [B]: { ids: [V[0]], skipped: 2 },
    });

    await pastePlaylists(page, [playlistUrl(A), playlistUrl(B)]);

    await expect(rows(page)).toHaveCount(1);
    await expect(toast(page).locator('[data-tt-code="TT-YT-010"]')).toBeVisible();
    await expect(toast(page).locator('[data-tt-code="TT-YT-100"]')).toContainText('×2');
  });

  test('a static 404 where the Worker should be is "unavailable" — never "not found"', async ({
    page,
  }) => {
    /*
     * `astro preview` has no Worker: `/api/*` falls through to the 404 page.
     * Read by status, that would tell the user every playlist is gone — the
     * oEmbed mistake that once called three good videos deleted
     * (`src/lib/tt-yt-cause.ts`).
     */
    await gotoYouTubeApp(page);
    await mockPlaylists(page, 'html');

    await pastePlaylists(page, [playlistUrl(A)]);

    await expect(toast(page).locator('[data-tt-code="TT-YT-011"]')).toBeVisible();
    await expect(toast(page).locator('[data-tt-code="TT-YT-010"]')).toHaveCount(0);
  });

  test('ten lists at most — the eleventh is counted, never looked up', async ({ page }) => {
    await gotoYouTubeApp(page);
    const lists = Array.from({ length: 11 }, (_, i) => `PL${String(i).padStart(16, '0')}`);
    const asked = await mockPlaylists(
      page,
      Object.fromEntries(lists.map((id) => [id, { ids: [] }])),
    );

    await pastePlaylists(page, lists.map(playlistUrl));

    await expect(toast(page).locator('[data-tt-code="TT-YT-013"]')).toBeVisible();
    expect(asked).toEqual([lists.slice(0, 10)]);
  });

  test('the 50-link cap holds across lists', async ({ page }) => {
    await gotoYouTubeApp(page);
    await mockPlaylists(page, { [A]: { ids: vids('a', 40) }, [B]: { ids: vids('b', 20) } });

    await pastePlaylists(page, [playlistUrl(A), playlistUrl(B)]);

    await expect(rows(page)).toHaveCount(50, { timeout: 20_000 });
    await expect(toast(page).locator('[data-tt-code="TT-YT-003"]')).toContainText('×10');
  });

  test('the chosen kind survives a run, and Start plays what a playlist held', async ({ page }) => {
    await gotoYouTubeApp(page);
    await mockPlaylists(page, { [A]: { ids: [V[0], V[1]] } });
    await mockDurations(page, { [V[0]]: 60_000, [V[1]]: 60_000 });

    await pastePlaylists(page, [playlistUrl(A)]);
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await ytReady(page);
    await page.getByTestId('tt-stop').click();

    await expect(page.getByTestId('tt-yt-kind-playlists')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the kind is two pressed-state buttons a keyboard reaches', async ({ page }) => {
    await gotoYouTubeApp(page);
    const playlists = page.getByTestId('tt-yt-kind-playlists');
    await expect(page.getByTestId('tt-yt-kind-videos')).toHaveAttribute('aria-pressed', 'true');

    await playlists.focus();
    await page.keyboard.press('Enter');
    await expect(playlists).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('tt-yt-kind-videos')).toHaveAttribute('aria-pressed', 'false');
  });
});
