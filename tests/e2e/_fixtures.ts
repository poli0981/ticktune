import { test as base, expect } from '@playwright/test';

/**
 * The `test` every spec imports — `@playwright/test`'s, plus one automatic
 * fixture. ESLint forbids importing `test` from Playwright directly in a spec.
 *
 * ## Why: the analytics beacon must never fire from CI
 *
 * Every page loads the Cloudflare Web Analytics beacon (src/layouts/TtBase.astro).
 * `astro preview` sends no CSP, so without this the E2E suite would fetch the
 * real script and report a visit for every page load — three browsers, two
 * mobile projects, retries: hundreds of fake visits per CI run, polluting the
 * only numbers the owner looks at, and a network dependency in every test.
 *
 * Both origins are FULFILLED with an empty response rather than aborted, so no
 * spec sees a failed request in its console. The page itself is untouched —
 * the tag stays in the HTML, exactly as production serves it.
 * `analytics.spec.ts` asserts the tag is there and requested; this only stops
 * the request leaving the machine.
 */
export const BEACON = /^https:\/\/(static\.)?cloudflareinsights\.com\//;

export const test = base.extend<{ stubAnalytics: void }>({
  stubAnalytics: [
    async ({ context }, use) => {
      await context.route(BEACON, (route) =>
        route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
      );
      await use();
    },
    { auto: true },
  ],
});

export { expect };
export type { Page } from '@playwright/test';
