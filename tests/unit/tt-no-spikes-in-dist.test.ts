import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The production build carries no spike harness — docs/15 §Scope rule.
 *
 * Until v2.0 the harnesses were plain pages under src/pages/spike/, so every
 * deploy published /spike/s1-youtube/, /spike/s3-metadata/ and
 * /spike/s4-crossfade/ — `noindex` and out of the sitemap, but live. They are
 * now injected only for `astro dev` or a TT_SPIKES=1 build into dist-spikes/.
 * This reads the dist/ that ships and fails if either the pages or their
 * mount chunks come back.
 *
 * Skipped without a build locally; under CI a missing build is a failure, as in
 * tt-csp-assets.test.ts.
 */

const DIST = join(process.cwd(), 'dist');
const hasBuild = existsSync(join(DIST, '_astro'));

it.runIf(!!process.env['CI'])('CI built the site before running this suite', () => {
  expect(hasBuild, 'dist/_astro is missing — run `pnpm build` before `pnpm test`').toBe(true);
});

describe.skipIf(!hasBuild)('no spike harness in the shipped build', () => {
  it('has no /spike/ pages', () => {
    expect(existsSync(join(DIST, 'spike'))).toBe(false);
  });

  it('has no spike mount chunks', () => {
    const chunks = readdirSync(join(DIST, '_astro')).filter((f) => /^mount-s\d/.test(f));
    expect(chunks).toEqual([]);
  });
});
