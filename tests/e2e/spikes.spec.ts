import { expect, test } from './_fixtures';

/**
 * The spike harnesses are not served — docs/15 §Scope rule.
 *
 * Until v2.0 every deploy published them at /spike/*. They are now routed only
 * for `astro dev` or a TT_SPIKES=1 build into dist-spikes/, so the preview of
 * the shipped dist/ must answer each of them with the 404 page.
 */

for (const slug of ['s1-youtube', 's3-metadata', 's4-crossfade', 's5-notify', 's6-loudness']) {
  test(`/spike/${slug}/ is a 404 in the shipped build`, async ({ request }) => {
    const res = await request.get(`/spike/${slug}/`);
    expect(res.status()).toBe(404);
  });
}
