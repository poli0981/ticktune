import { BEACON, expect, test } from './_fixtures';

/**
 * Cloudflare Web Analytics — present everywhere, and never sent from a test.
 *
 * The beacon is the site's one piece of telemetry (legal/PRIVACY-POLICY.md §3–§4).
 * These pin both halves of that sentence: every page carries the tag with the
 * site's token, and the shared fixture keeps the request inside the machine.
 */

const TOKEN = '46c4fdb729df436091a0cb204d77dcc7';

test.describe('analytics beacon', () => {
  for (const path of ['/', '/en/', '/legal/privacy/', '/app/', '/no-such-page']) {
    test(`${path} carries the beacon with the site token`, async ({ page }) => {
      const requested: string[] = [];
      page.on('request', (r) => {
        if (BEACON.test(r.url())) requested.push(r.url());
      });

      await page.goto(path);
      const tag = page.locator('script[src="https://static.cloudflareinsights.com/beacon.min.js"]');
      await expect(tag).toHaveCount(1);
      expect(JSON.parse((await tag.getAttribute('data-cf-beacon')) ?? '{}')).toEqual({
        token: TOKEN,
      });

      // Requested once per page — and fulfilled by the fixture, not the network.
      await expect.poll(() => requested.length).toBe(1);
    });
  }

  test('the beacon is a module script, never inline', async ({ page }) => {
    // scripts/inject-csp-hash.ts allows exactly one inline script (the mobile
    // gate). An inline bootstrap would need its own hash and break that rule.
    await page.goto('/');
    const inlineWithBeacon = await page.evaluate(
      () =>
        [...document.querySelectorAll('script:not([src])')].filter((s) =>
          s.textContent?.includes('cloudflareinsights'),
        ).length,
    );
    expect(inlineWithBeacon).toBe(0);
    await expect(page.locator('script[src*="cloudflareinsights"]')).toHaveAttribute(
      'type',
      'module',
    );
  });
});
