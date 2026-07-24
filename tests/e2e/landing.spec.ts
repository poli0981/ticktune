import { test, expect, type Page } from '@playwright/test';

/**
 * The bilingual landing — docs/03 §3 item 1, docs/08 §1. P6 slice A.
 *
 * The P6 exit criteria are "Lighthouse ≥ 95 static pages; hreflang correct".
 * Lighthouse is a manual check against the preview (docs/13 §7 pattern, it is
 * not a CI gate), so what this file owns is **hreflang correct** — asserted as
 * reciprocity rather than presence, because a page that merely *has* alternates
 * can still point them at the wrong place, and that is the failure Search
 * Console reports weeks later.
 */

/** Every `<link rel="alternate">` on the page, as hreflang → href. */
async function alternates(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('link[rel="alternate"]')].map((l) => [
        l.getAttribute('hreflang') ?? '',
        l.getAttribute('href') ?? '',
      ]),
    ),
  );
}

const meta = (page: Page, selector: string, attr = 'content') =>
  page.evaluate(([s, a]) => document.querySelector(s!)?.getAttribute(a!) ?? null, [selector, attr]);

test.describe('landing', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('/ is Vietnamese and /en/ is English', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Đồng hồ của bạn');

    await page.goto('/en/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your countdown');
  });

  test('hreflang is reciprocal, and each page points at the other', async ({ page }) => {
    /*
     * The exit criterion. Both pages must advertise the SAME pair — a set that
     * disagrees between the two is the classic hreflang error, and it is
     * invisible to any "does the tag exist" check.
     */
    await page.goto('/');
    const fromVi = await alternates(page);
    await page.goto('/en/');
    const fromEn = await alternates(page);

    expect(fromVi).toEqual(fromEn);
    expect(fromVi['vi']).toMatch(/\/$/);
    expect(fromVi['en']).toMatch(/\/en\/$/);
    // x-default is the page a searcher of any other language should land on;
    // docs/08 makes Vietnamese the default, so it must equal the vi href.
    expect(fromVi['x-default']).toBe(fromVi['vi']);
  });

  test('each page canonicalises to itself, not to the other', async ({ page }) => {
    await page.goto('/');
    expect(await meta(page, 'link[rel="canonical"]', 'href')).toMatch(/ticktune\.net\/$/);
    await page.goto('/en/');
    expect(await meta(page, 'link[rel="canonical"]', 'href')).toMatch(/ticktune\.net\/en\/$/);
  });

  test('the FAQ states the visible-vs-hidden countdown promise — docs/04 §2 item 6', async ({
    page,
  }) => {
    /*
     * The one S2-decision deliverable that lives outside the app. S2 measured a
     * hidden tab finishing 2 m 57 s late and its remedy failed too, so the
     * PROMISE was re-scoped — and `04 §2` item 6 requires that re-scope to be
     * stated "where users decide to trust it" rather than buried in the EULA.
     *
     * Asserted in both languages, because a translation that quietly dropped it
     * would leave half the audience with the old, wrong impression.
     */
    await page.goto('/en/');
    const en = await page.getByRole('main').textContent();
    expect(en).toContain('accurate while the tab is visible');
    expect(en).toContain('best-effort');

    await page.goto('/');
    const vi = await page.getByRole('main').textContent();
    expect(vi).toContain('chính xác khi tab đang hiển thị');
    expect(vi).toContain('tốt nhất có thể');
  });

  test('the CTA reaches the app and the GPL source offer is present', async ({ page }) => {
    // The source-offer link satisfies GPL-3.0 §6 for the hosted build and has
    // been on the page since the first deploy — it is a licence obligation,
    // not decoration.
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Mở TickTune/ })).toHaveAttribute('href', '/app/');

    const source = page.getByRole('link', { name: /GPL-3\.0/ });
    await expect(source).toHaveAttribute('href', /github\.com/);
    await expect(source).toHaveAttribute('rel', /noopener/);
  });

  test('the language switch navigates between the two routes', async ({ page }) => {
    // Separate routes, so this is navigation — unlike the app island's in-place
    // toggle (docs/08 §1 vs §2, two mechanisms for two surfaces).
    await page.goto('/');
    await page.getByRole('navigation').getByRole('link').click();
    await expect(page).toHaveURL(/\/en\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('the hero placeholder is same-origin and labelled as a placeholder', async ({ page }) => {
    // docs/16's standing rule: placeholder media ships, but it is tracked and
    // must not pass itself off as the real capture. Same-origin keeps CSP
    // `img-src 'self'` satisfied with no policy change.
    await page.goto('/');
    const img = page.getByRole('img').first();
    await expect(img).toHaveAttribute('src', /^\/hero-placeholder/);
    await expect(page.getByText(/Ảnh minh hoạ tạm/)).toBeVisible();
  });

  test('Open Graph and the favicon are wired, same-origin', async ({ page }) => {
    await page.goto('/');
    expect(await meta(page, 'meta[property="og:image"]')).toMatch(/ticktune\.net\/og\//);
    expect(await meta(page, 'meta[property="og:locale"]')).toBe('vi_VN');
    expect(await meta(page, 'link[rel="icon"]', 'href')).toBe('/favicon.svg');

    await page.goto('/en/');
    expect(await meta(page, 'meta[property="og:locale"]')).toBe('en_US');
  });

  test('the landing is indexable and /app/ is not', async ({ page }) => {
    // The landing is what should rank; the app is an empty shell to a crawler
    // because the island mounts client-side.
    await page.goto('/');
    expect(await meta(page, 'meta[name="robots"]')).toBeNull();

    await page.goto('/app/');
    expect(await meta(page, 'meta[name="robots"]')).toContain('noindex');
  });

  test('the EN 404 mirror renders in English', async ({ page }) => {
    // Reachable and mirrored (docs/08 §1), but NOT the fallback for unknown
    // `/en/*` paths — Cloudflare serves the single VI dist/404.html. That
    // asymmetry is deliberate and recorded in TtNotFound.astro.
    await page.goto('/en/404');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Channel not found');
    expect(await meta(page, 'meta[name="robots"]')).toContain('noindex');
  });
});
