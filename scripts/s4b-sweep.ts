/**
 * Run the spike S4b sweep — docs/15 §S4.
 *
 *   pnpm s4b                          quick sweep (~12 min), bundled Chromium
 *   pnpm s4b --full                   ×3, plus the corpus (hours; run it in the background)
 *   pnpm s4b --channel msedge         a real browser channel instead of the bundled one
 *   pnpm s4b --headless               no window (audio still renders)
 *   pnpm s4b --only control           only the runs whose label contains the text
 *
 * Builds the harnesses with TT_SPIKES=1 into dist-spikes/ and previews that —
 * not `astro dev`, whose dependency optimiser reloaded the page mid-sweep and
 * whose middleware is not what ships. Loads test/generated/s4b/ —
 * `pnpm s4b:fixtures` first —
 * presses Unlock with a real click, and runs the plan from
 * src/spike/s4/tt-s4b-sweep-plan.ts one configuration at a time: parallel runs
 * would distort exactly the timing being measured. The page judges each run
 * with the same code its own buttons use.
 *
 * Results go to test/s4b-results/ — git-ignored, because they name corpus
 * files; docs/15 carries labels only. Exits non-zero unless the verdict is PASS.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spikeServer } from './spike-kit.ts';
import {
  fullPlan,
  quickPlan,
  type TtS4bFixture,
  type TtS4bRunConfig,
} from '../src/spike/s4/tt-s4b-sweep-plan.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const PORT = 4331;
const MANIFEST = 'test/generated/s4b/manifest.json';
const OUT = 'test/s4b-results';

type Fx = TtS4bFixture & { path: string };
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { files: Fx[] };
const only = opt('only');
const plan: TtS4bRunConfig[] = (
  flag('full') ? fullPlan(manifest.files) : quickPlan(manifest.files)
).filter((c) => !only || c.label.includes(only));
const needed = new Set(plan.flatMap((c) => [c.a, ...(c.b ? [c.b] : [])]));
const paths = [
  resolve(MANIFEST),
  ...manifest.files.filter((f) => needed.has(f.name)).map((f) => resolve(f.path)),
];

console.log(
  `S4b ${flag('full') ? 'full' : 'quick'} sweep: ${plan.length} runs, ${paths.length - 1} files`,
);

// `--reuse <port>` shares one running `pnpm spikes` build between sweeps.
const server = await spikeServer(PORT);
const ORIGIN = server.origin;
const channel = opt('channel');
const browser = await chromium.launch({
  headless: flag('headless'),
  ...(channel ? { channel } : {}),
  args: ['--mute-audio'],
});
const started = Date.now();

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('  page error:', e.message));
  await page.goto(`${ORIGIN}/spike/s4-crossfade/`);
  await page.waitForFunction(() => '__ttS4b' in window);
  await page.getByTestId('s4b-files').setInputFiles(paths);
  await page.getByTestId('s4b-unlock').click(); // a real gesture: resume() needs one
  await page.getByTestId('s4b-ctx').filter({ hasText: 'running' }).waitFor();

  const judged: unknown[] = [];
  for (const [i, cfg] of plan.entries()) {
    const t = Date.now();
    const runs = await page.evaluate(async (c) => {
      const s4b = (window as unknown as { __ttS4b: Record<string, (...a: unknown[]) => unknown> })
        .__ttS4b;
      const results = (await s4b['run']!(c)) as unknown[];
      return results.map((r) => s4b['judge']!(r));
    }, cfg);
    for (const r of runs as Array<{
      label: string;
      ok: boolean;
      checks: Array<{ name: string; pass: boolean; detail: string }>;
    }>) {
      judged.push(r);
      const bad = r.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`);
      console.log(
        `${String(i + 1).padStart(3)}/${plan.length} ${r.ok ? '✓' : '✗'} ${r.label}` +
          ` (${((Date.now() - t) / 1000).toFixed(0)} s)` +
          (bad.length && cfg.judge !== 'control' ? `\n        ${bad.join('\n        ')}` : ''),
      );
    }
  }

  const v = (await page.evaluate(
    (runs) =>
      (window as unknown as { __ttS4b: { verdict: (r: unknown) => unknown } }).__ttS4b.verdict(
        runs,
      ),
    judged,
  )) as {
    outcome: string;
    criteria: Array<{ name: string; pass: boolean; detail: string }>;
    zeroChoice: string | null;
    durationSource: string | null;
  };

  const ua = await page.evaluate(() => navigator.userAgent);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = join(OUT, `${stamp}-${channel ?? 'chromium'}-${flag('full') ? 'full' : 'quick'}`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${base}.json`, JSON.stringify({ ua, verdict: v, runs: judged }, null, 2));
  const md = [
    `# S4b ${flag('full') ? 'full' : 'quick'} sweep — ${v.outcome}`,
    '',
    `${ua}  `,
    `${plan.length} configurations, ${judged.length} runs, ${((Date.now() - started) / 60000).toFixed(1)} min`,
    '',
    ...v.criteria.map((c) => `- ${c.pass ? '✅' : '❌'} ${c.name} — ${c.detail}`),
    '',
    `0 s switch: ${v.zeroChoice ?? 'none passed'} · header-less VBR duration source: ${v.durationSource ?? 'none passed'}`,
  ].join('\n');
  writeFileSync(`${base}.md`, md + '\n');
  console.log(`\n${md}\n\n→ ${base}.{json,md}`);
  process.exitCode = v.outcome === 'PASS' ? 0 : 1;
} finally {
  await browser.close();
  await server.stop();
}
