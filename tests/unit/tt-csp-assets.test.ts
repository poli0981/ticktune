import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The built output must not contain anything the CSP forbids — docs/09 §4.
 *
 * ## Why this test exists
 *
 * P6 slice A installed the fontsource packages, and Vite inlined every subset
 * under its ~4 KB default as a `data:` URL. `font-src` is `'self'` with **no
 * `data:`**, so the browser blocked them: three failed requests and four
 * console errors on the live landing page. Nothing looked broken — the
 * non-inlined faces covered the text — and the only visible symptom was
 * Lighthouse "Best Practices" reading **92** against a ≥ 95 exit criterion.
 *
 * A bundler default silently violating the CSP is exactly the class of defect
 * that survives a green suite, so it gets a check that can go red. Fixed in
 * `astro.config.mjs` by refusing to inline fonts rather than by adding `data:`
 * to `font-src` — the policy is deliberately tight and a bundler default is a
 * poor reason to loosen it.
 *
 * ## Skipped when there is no build — locally only
 *
 * A local `pnpm test` may run without `dist/`, and a test that silently passes
 * on a missing directory would be worse than none, so it skips there. In CI it
 * must NOT skip: the comment that used to stand here said "`pnpm build` runs in
 * CI before the E2E job", but ci.yml ran the unit tests BEFORE its build and
 * e2e.yml never runs vitest at all — so this suite was skipped on every CI run
 * since it was written. ci.yml now builds first (docs/13 §1), and under `CI` a
 * missing build fails the suite instead of hiding it.
 */

const DIST = join(process.cwd(), 'dist');
const hasBuild = existsSync(join(DIST, '_astro'));

it.runIf(!!process.env['CI'])('CI built the site before running this suite', () => {
  expect(hasBuild, 'dist/_astro is missing — run `pnpm build` before `pnpm test`').toBe(true);
});

/** Every built CSS file, which is where `@font-face src` ends up. */
function builtCss(): { name: string; text: string }[] {
  return readdirSync(join(DIST, '_astro'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => ({ name: f, text: readFileSync(join(DIST, '_astro', f), 'utf8') }));
}

describe.skipIf(!hasBuild)('the built CSS obeys the CSP — docs/09 §4', () => {
  it('inlines no font as a data: URL, because font-src is self only', () => {
    const offenders = builtCss()
      .filter((f) => /url\(\s*["']?data:font\//i.test(f.text))
      .map((f) => f.name);

    expect(
      offenders,
      'a font was inlined as data: — font-src is `self` with no `data:`, so the browser will block it',
    ).toEqual([]);
  });

  it('emits the font faces as real files instead', () => {
    // The other half of the same claim: proving nothing is inlined is only
    // meaningful if the faces are actually there as fetchable assets.
    const fonts = readdirSync(join(DIST, '_astro')).filter((f) => /\.woff2?$/.test(f));
    expect(fonts.length).toBeGreaterThan(0);
  });

  it('references no remote origin the CSP does not allow', () => {
    /*
     * `default-src 'self'` with a short allow-list (docs/09 §4). A stylesheet
     * that reached for a font CDN would break the privacy posture as well as
     * the policy — docs/03 §1's "fonts are self-hosted" is a privacy claim, not
     * a preference.
     */
    const allowed = /^(https:\/\/(www\.youtube(-nocookie)?\.com|i\.ytimg\.com))/;
    const remote = builtCss().flatMap((f) =>
      [...f.text.matchAll(/url\(\s*["']?(https?:\/\/[^)"']+)/gi)]
        .map((m) => m[1] ?? '')
        .filter((u) => !allowed.test(u))
        .map((u) => `${f.name}: ${u}`),
    );

    expect(remote, 'built CSS references an origin outside the CSP allow-list').toEqual([]);
  });
});
