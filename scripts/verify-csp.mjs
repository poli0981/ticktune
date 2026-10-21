#!/usr/bin/env node
/**
 * Loads the built site through `wrangler dev` with the REAL, enforcing CSP and
 * asserts the browser raises no policy violations — docs/09 §4, docs/10 §7.
 *
 * Why this exists as a script rather than a one-off check: the CSP hash is a
 * build-time coupling between src/layouts/TtBase.astro and public/_headers.
 * `pnpm build` proves exactly one inline script exists; only a browser proves
 * the hash it computes matches the one we injected. Nothing else in the test
 * suite runs against a CSP at all — Astro's dev server and `astro preview` send
 * no headers — so without this the coupling is untested until production.
 *
 * Runs in CI since v1.1 — the last step of e2e.yml, against `wrangler dev`
 * (local workerd, no Cloudflare credentials). It used to be manual-only, which
 * meant the one check that sees the real policy ran only when someone
 * remembered to. Locally:
 *
 *   pnpm build && pnpm exec wrangler dev --port 8788 --ip 127.0.0.1 &
 *   node scripts/verify-csp.mjs
 */
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.TT_CSP_BASE ?? 'http://127.0.0.1:8788';

const fixture = (name) => fileURLToPath(new URL(`../tests/e2e/fixtures/${name}`, import.meta.url));

/** Past the Legal Gate the way a user gets past it — the real dialog, no seeded storage. */
async function acceptGate(page) {
  await page.waitForFunction(() => !!document.documentElement.dataset.ttBooted);
  await page.getByTestId('tt-gate-agree').check();
  await page.getByTestId('tt-gate-accept').click();
  await page.locator('[role=dialog]').waitFor({ state: 'hidden' });
}

/*
 * The cases that ACT (v2.0.1). Loading pages proved the policy lets the app
 * boot; it could not see a request the app makes only when the user does
 * something. Both samplers fetched a blob: URL, `connect-src` refused it from
 * v0.7.0 to v2.0.0, and every page here loaded clean the whole time. Each case
 * asserts the violation count AND the effect, because a sampler that fails for
 * another reason is just as dead.
 */
async function brightPicture(page) {
  await acceptGate(page);
  await page.keyboard.press('s');
  await page.getByTestId('tt-set-bg-image').click();
  await page.getByTestId('tt-set-bg-files').setInputFiles(fixture('bg-b.png'));
  const lifted = await page
    .waitForFunction(
      () =>
        Number(
          document.querySelector('[data-testid=tt-backdrop-scrim]')?.getAttribute('data-tt-scrim'),
        ) > 0.45,
      null,
      { timeout: 5_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (lifted) return [];
  const scrim = await page.getByTestId('tt-backdrop-scrim').getAttribute('data-tt-scrim');
  return [`scrim=${scrim} over a white picture, expected > 0.45 (sampler blocked?)`];
}

async function coverArt(page) {
  await acceptGate(page);
  await page.getByTestId('tt-file-input').setInputFiles(fixture('with-cover.mp3'));
  await page.getByTestId('tt-queue-row').first().waitFor();
  const tinted = await page
    .waitForFunction(
      () =>
        (
          document.querySelector('[data-testid=tt-backdrop-base]')?.getAttribute('style') ?? ''
        ).includes('hue-rotate('),
      null,
      { timeout: 5_000 },
    )
    .then(() => true)
    .catch(() => false);
  return tinted ? [] : ['no hue-rotate on the base layer (auto-theme sampler blocked?)'];
}

const CASES = [
  {
    label: 'desktop /app/',
    path: '/app/',
    ctx: { viewport: { width: 1440, height: 900 } },
    expect: { gate: false, countdown: true },
  },
  {
    label: 'mobile  /app/',
    path: '/app/',
    ctx: { ...devices['Pixel 7'] },
    expect: { gate: true, countdown: false },
  },
  {
    label: 'desktop /',
    path: '/',
    ctx: { viewport: { width: 1440, height: 900 } },
    expect: { gate: false, countdown: false },
  },
  {
    label: 'desktop 404',
    path: '/no-such-page',
    ctx: { viewport: { width: 1440, height: 900 } },
    expect: { gate: false, countdown: false },
  },
  {
    label: 'desktop /app/ bright picture',
    path: '/app/',
    ctx: { viewport: { width: 1440, height: 900 } },
    expect: { gate: false, countdown: true },
    act: brightPicture,
  },
  {
    label: 'desktop /app/ cover art',
    path: '/app/',
    ctx: { viewport: { width: 1440, height: 900 } },
    expect: { gate: false, countdown: true },
    act: coverArt,
  },
];

const browser = await chromium.launch();
let failures = 0;

for (const c of CASES) {
  const ctx = await browser.newContext(c.ctx);
  /*
   * The analytics beacon is fulfilled locally, never fetched: this runs in CI
   * and must not report visits. The CSP check is unaffected — the browser
   * evaluates `script-src`/`connect-src` BEFORE a request reaches this route,
   * so a missing origin still surfaces as a violation here.
   */
  await ctx.route(/^https:\/\/(static\.)?cloudflareinsights\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
  );
  /*
   * The browser's own report, as well as the console line. The console text
   * is a browser's wording and a regex over it; this event is the spec's, and
   * it names the directive and the URL that was refused.
   */
  await ctx.addInitScript(() => {
    window.__ttCsp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__ttCsp.push(`${e.effectiveDirective} refused ${e.blockedURI}`);
    });
  });
  const page = await ctx.newPage();
  const csp = [];
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) {
      csp.push(m.text());
    }
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE + c.path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const acted = c.act ? await c.act(page) : [];
  const reported = await page.evaluate(() => window.__ttCsp ?? []);

  const gate = await page.evaluate(() => !!document.documentElement.dataset.ttBlocked);
  const countdown = (await page.locator('.tt-countdown').count()) > 0;
  const dseg7 = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('100px "DSEG7 Classic"');
  });

  const problems = [];
  if (csp.length) problems.push(`${csp.length} CSP console error(s)`);
  if (reported.length) problems.push(`${reported.length} securitypolicyviolation event(s)`);
  if (errors.length) problems.push(`${errors.length} page error(s)`);
  // A CSP that blocked the gate script would show up here as gate=false on
  // mobile — the failure mode this whole script exists to catch.
  if (gate !== c.expect.gate) problems.push(`gate=${gate}, expected ${c.expect.gate}`);
  if (countdown !== c.expect.countdown)
    problems.push(`countdown=${countdown}, expected ${c.expect.countdown}`);
  if (!dseg7) problems.push('DSEG7 did not load (font-src?)');
  problems.push(...acted);

  if (problems.length) {
    failures++;
    console.error(`✖ ${c.label}: ${problems.join('; ')}`);
    csp.forEach((v) => console.error(`    ${v.slice(0, 160)}`));
    reported.forEach((v) => console.error(`    ${v.slice(0, 160)}`));
    errors.forEach((v) => console.error(`    ${v.slice(0, 160)}`));
  } else {
    console.log(`✓ ${c.label}  gate=${gate} countdown=${countdown} dseg7=${dseg7} csp=clean`);
  }

  await ctx.close();
}

await browser.close();

if (failures) {
  console.error(`\n✖ verify-csp: ${failures}/${CASES.length} case(s) failed\n`);
  process.exit(1);
}
console.log(`\n✓ verify-csp: ${CASES.length} cases clean under the enforcing CSP\n`);
