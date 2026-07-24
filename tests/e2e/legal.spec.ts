import { test, expect, type Page } from '@playwright/test';
import { TT_LEGAL_DOCS, TT_LEGAL_VERSION, ttLegalHref } from '../../src/lib/tt-legal-const';
import { en } from '../../src/i18n/static/en';
import { vi } from '../../src/i18n/static/vi';

/**
 * The legal pages — P6 slice B, `docs/03 §3`, `docs/08 §1`.
 *
 * The slice exit is "all 8 legal routes 200 in both languages; in-app links
 * resolve on-site and language-correct; version rendered". Every assertion here
 * is driven off `TT_LEGAL_DOCS` rather than a hand-written list, so adding a
 * fifth document extends the suite instead of quietly leaving it uncovered.
 *
 * ⚠️ The heart of this file is the **language-correctness** block. Slice B moved
 * `TT_LEGAL_LINKS` from GitHub URLs to on-site routes, and those constants are
 * the Vietnamese ones. Every caller that forgets `ttLegalHref()` still produces
 * four valid links that all return 200 — pointing at the wrong language. No unit
 * test can see that, and neither can a reader who only speaks Vietnamese.
 */

/** Legal hrefs in the page's footer/nav region, absolute-path form. */
const legalHrefs = (page: Page, root: string) =>
  page.evaluate(
    (sel) =>
      [...document.querySelectorAll(`${sel} a[href*="/legal/"]`)].map(
        (a) => new URL((a as HTMLAnchorElement).href).pathname,
      ),
    root,
  );

test.describe('legal pages', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  for (const doc of TT_LEGAL_DOCS) {
    for (const lang of ['vi', 'en'] as const) {
      test(`/${lang}: ${doc.slug} renders with its heading and version`, async ({ page }) => {
        const res = await page.goto(ttLegalHref(doc.key, lang));

        expect(res?.status(), `${ttLegalHref(doc.key, lang)} did not return 200`).toBe(200);
        await expect(page.locator('html')).toHaveAttribute('lang', lang);

        // The body arrived: the markdown's own H1, not the layout's title.
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

        // docs/02 §3.1 — the version the gate stores acceptance against.
        await expect(page.getByTestId('tt-legal-version')).toContainText(TT_LEGAL_VERSION);
      });
    }
  }

  test('the canonical banner picks the right key for each language', async ({ page }) => {
    /*
     * docs/08 §1: English is canonical for interpretation. Both languages carry
     * a banner — a banner only on the translation reads as a disclaimer rather
     * than as a statement of which text governs.
     *
     * Asserted against the dictionaries, not against prose: the failure worth
     * catching is `canonicalEn` and `canonicalVi` being swapped, which would
     * have a Vietnamese page declare itself authoritative. Matching a hardcoded
     * English substring would instead just fail on the VI page for being in
     * Vietnamese, which is the one thing that is *supposed* to happen.
     */
    for (const [lang, dict] of [
      ['en', en],
      ['vi', vi],
    ] as const) {
      await page.goto(ttLegalHref('eula', lang));
      await expect(page.getByTestId('tt-legal-canonical')).toHaveText(
        lang === 'en' ? dict.legal.canonicalEn : dict.legal.canonicalVi,
      );
    }
  });

  test('no rendered legal link ends in .md', async ({ page }) => {
    /*
     * EULA links to ./DISCLAIMER.md and ./PRIVACY-POLICY.md so the drafts read
     * correctly on GitHub. The mdast plugin in astro.config.mjs rewrites them;
     * without it these 404. A new cross-link the plugin does not know about
     * fails here.
     */
    for (const lang of ['vi', 'en'] as const) {
      for (const doc of TT_LEGAL_DOCS) {
        await page.goto(ttLegalHref(doc.key, lang));
        const bad = await page.evaluate(() =>
          [...document.querySelectorAll('a[href]')]
            .map((a) => a.getAttribute('href') ?? '')
            .filter((h) => /\.md(#.*)?$/i.test(h)),
        );
        expect(bad, `${doc.slug} (${lang}) still links to raw markdown`).toEqual([]);
      }
    }
  });

  test("EULA's cross-links stay in their own language", async ({ page }) => {
    // The plugin picks the prefix from the source file's path. If that ever
    // regresses, a Vietnamese reader lands on the English Disclaimer.
    await page.goto(ttLegalHref('eula', 'vi'));
    const vi = await legalHrefs(page, 'article.tt-prose');
    expect(vi.length).toBeGreaterThan(0);
    expect(vi.every((h) => !h.startsWith('/en/'))).toBe(true);

    await page.goto(ttLegalHref('eula', 'en'));
    const en = await legalHrefs(page, 'article.tt-prose');
    expect(en.length).toBeGreaterThan(0);
    expect(en.every((h) => h.startsWith('/en/legal/'))).toBe(true);
  });

  test('the landing footer links the reader to their OWN language', async ({ page }) => {
    /*
     * 🔴 The wiring trap. TtFooter.astro is the one legal-link call site with no
     * runtime `i18n.lang` to read — the page hands it `lang` at build time. Drop
     * that prop and the VI footer keeps working by accident while the EN footer
     * sends every document to its Vietnamese version.
     */
    await page.goto('/');
    expect([...(await legalHrefs(page, 'footer'))].sort()).toEqual(
      TT_LEGAL_DOCS.map((d) => `/legal/${d.slug}/`).sort(),
    );

    await page.goto('/en/');
    expect([...(await legalHrefs(page, 'footer'))].sort()).toEqual(
      TT_LEGAL_DOCS.map((d) => `/en/legal/${d.slug}/`).sort(),
    );
  });

  test('every route the app links to resolves WITHOUT a redirect', async ({ request }) => {
    /*
     * The in-app-links-resolve check: driven from the constant the gate and the
     * settings panel read, not from a list written out here.
     *
     * `maxRedirects: 0` so a route that only resolves *after* a hop fails here
     * rather than reporting the redirected 200.
     *
     * 🔴 **But do not trust this one to catch a missing trailing slash.**
     * `build.format` is `'directory'`, and the deployed host answers
     * `/legal/eula` with a **307** to `/legal/eula/` — while `astro preview`,
     * which is what this suite runs against, serves both with a plain 200.
     * Measured, after the missing slash shipped: production redirects, the
     * harness does not, so no assertion here can see the difference. What
     * actually guards the slash is the exact-href comparison in the footer test
     * below, plus a line in the slice B live checklist. The lesson is the
     * general one: a guard is only as good as the harness's fidelity to
     * production, and `astro preview` is more permissive than the Worker.
     */
    for (const doc of TT_LEGAL_DOCS) {
      for (const lang of ['vi', 'en'] as const) {
        const href = ttLegalHref(doc.key, lang);
        const res = await request.get(href, { maxRedirects: 0 });
        expect(res.status(), `${href} is linked in-app but redirects or 404s`).toBe(200);
      }
    }
  });

  test('the language switch round-trips', async ({ page }) => {
    await page.goto(ttLegalHref('privacy', 'vi'));
    await page.getByRole('link', { name: 'English' }).click();
    await expect(page).toHaveURL(new RegExp(`${ttLegalHref('privacy', 'en')}/?$`));
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});
