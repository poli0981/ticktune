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
 * Not wired into CI: it needs wrangler and a browser download. Run it before a
 * release, and whenever _headers or the gate script changes.
 *
 *   pnpm build && pnpm exec wrangler dev --port 8788 --local &
 *   node scripts/verify-csp.mjs
 */
import { chromium, devices } from '@playwright/test';

const BASE = process.env.TT_CSP_BASE ?? 'http://127.0.0.1:8788';

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
];

const browser = await chromium.launch();
let failures = 0;

for (const c of CASES) {
  const ctx = await browser.newContext(c.ctx);
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

  const gate = await page.evaluate(() => !!document.documentElement.dataset.ttBlocked);
  const countdown = (await page.locator('.tt-countdown').count()) > 0;
  const dseg7 = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('100px "DSEG7 Classic"');
  });

  const problems = [];
  if (csp.length) problems.push(`${csp.length} CSP violation(s)`);
  if (errors.length) problems.push(`${errors.length} page error(s)`);
  // A CSP that blocked the gate script would show up here as gate=false on
  // mobile — the failure mode this whole script exists to catch.
  if (gate !== c.expect.gate) problems.push(`gate=${gate}, expected ${c.expect.gate}`);
  if (countdown !== c.expect.countdown)
    problems.push(`countdown=${countdown}, expected ${c.expect.countdown}`);
  if (!dseg7) problems.push('DSEG7 did not load (font-src?)');

  if (problems.length) {
    failures++;
    console.error(`✖ ${c.label}: ${problems.join('; ')}`);
    csp.forEach((v) => console.error(`    ${v.slice(0, 160)}`));
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
