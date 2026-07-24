import { test, expect, type Page } from '@playwright/test';

/**
 * docs/07 §6 + docs/13 §3 — the mobile gate is hard invariant 6.
 *
 * Two independent claims, and both matter:
 *   1. the overlay blocks the page, and
 *   2. no component/framework bundle is even REQUESTED on a blocked viewport.
 *
 * (2) is the one that regresses silently, because a mount mechanism can look
 * fine while quietly fetching the island — that is exactly how `client:only`
 * failed the docs/01 §3 measurement.
 */

/** Framework/component chunks. The ~200 B page guard chunk is not one. */
const COMPONENT_CHUNK = /\/_astro\/(TtApp|client\.svelte|mount)[.-]/;

function recordJs(page: Page) {
  const seen: string[] = [];
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.endsWith('.js')) seen.push(path);
  });
  return seen;
}

const ROUTES = ['/', '/en/', '/app/', '/does-not-exist'];

test.describe('blocked viewports', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile projects only');

  for (const route of ROUTES) {
    test(`${route} — overlay shows and no island bundle is fetched`, async ({ page }) => {
      const js = recordJs(page);
      await page.goto(route, { waitUntil: 'networkidle' });
      // Give any deferred dynamic import a chance to fire before concluding.
      await page.waitForTimeout(500);

      await expect(page.locator('.tt-mobile-gate')).toBeVisible();
      await expect(page.getByText('không hỗ trợ thiết bị di động')).toBeVisible();
      await expect(page.getByText("isn't available on mobile")).toBeVisible();

      expect(
        js.filter((u) => COMPONENT_CHUNK.test(u)),
        'a component/framework bundle was requested on a blocked viewport',
      ).toEqual([]);
      await expect(page.locator('#tt-app > *')).toHaveCount(0);
    });
  }

  /*
   * docs/07 §5's SEO mitigation, now that there is real content to mitigate for.
   *
   * Google crawls mobile-first, so its renderer sees the gate. The trade the
   * doc accepts is that the page's HTML **stays in the DOM underneath**,
   * visually hidden rather than swapped out — so the landing copy is still
   * crawlable text. Before P6 that was one stub page; it is now the whole
   * marketing surface in two languages, which makes this the assertion that
   * protects it.
   */
  for (const [route, marker] of [
    ['/', 'Đồng hồ của bạn'],
    ['/en/', 'Your countdown'],
    // P6 slice B — the legal bodies are indexable prose too, and they are the
    // pages most likely to be linked from outside. One per language is enough:
    // all eight render through the same component.
    ['/legal/privacy', 'quyền riêng tư'],
    ['/en/legal/privacy', 'Privacy Policy'],
  ] as const) {
    test(`${route} keeps its content in the DOM for crawlers (docs/07 §5)`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator('.tt-mobile-gate')).toBeVisible();
      // Visually hidden, but present and readable — never swapped out.
      await expect(page.locator('main')).toBeAttached();
      expect(await page.locator('main').textContent()).toContain(marker);
    });
  }
});

test.describe('desktop viewports', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('gate stays hidden and the island mounts at /app/', async ({ page }) => {
    await page.goto('/app/', { waitUntil: 'networkidle' });
    await expect(page.locator('.tt-mobile-gate')).toBeHidden();
    // The countdown only exists if the island bundle loaded AND hydrated, so
    // this is the real "did the hand-mount work" assertion (docs/01 §3).
    await expect(page.locator('.tt-countdown')).toBeVisible();
  });

  test('unknown path serves the styled 404', async ({ page }) => {
    await page.goto('/does-not-exist');
    await expect(page.getByText('Không tìm thấy kênh')).toBeVisible();
  });
});
