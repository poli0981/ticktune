/**
 * Run the spike S6 sweep — docs/15 §S6.
 *
 *   pnpm s6                   system Edge, every manifest file at 16/24/48 kHz
 *   pnpm s6 --channel chrome
 *
 * Builds the harnesses (TT_SPIKES=1 → dist-spikes/), previews them, and asks
 * the page to analyse each file of test/generated/s6/manifest.json at three
 * rates — `pnpm s6:fixtures [--corpus]` first. Accuracy is judged against
 * ffmpeg's `ebur128` at the native rate; time is what the page measured; and
 * MEMORY is sampled from outside, because a page cannot see what
 * `decodeAudioData` holds: a PowerShell loop sums the private bytes of the
 * browser process and its children every 100 ms, and each analysis's peak is
 * the rise over the sample just before it started.
 *
 * Results go to test/s6-results/ (git-ignored: they name corpus files).
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spikeServer } from './spike-kit.ts';

const args = process.argv.slice(2);
const i = args.indexOf('--channel');
const channel = i >= 0 ? (args[i + 1] ?? 'msedge') : 'msedge';
const PORT = 4333;
const MANIFEST = 'test/generated/s6/manifest.json';
const OUT = 'test/s6-results';
const RATES = [16_000, 24_000, 48_000];

interface Fx {
  name: string;
  path: string;
  kind: 'signal' | 'long' | 'music';
  refLufs: number;
  refPeakDb: number;
  durationS: number;
}
interface Result {
  name: string;
  rate: number;
  lufs: number | null;
  peakDb: number | null;
  decodeMs: number;
  computeMs: number;
  startedAt: number;
  endedAt: number;
  error?: string;
  memPeakMb?: number;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { files: Fx[] };
const fx = manifest.files.filter((f) => Number.isFinite(f.refLufs));

// `--reuse <port>` shares one running `pnpm spikes` build between sweeps.
const server = await spikeServer(PORT);
const ORIGIN = server.origin;
const bs = await chromium.launchServer({ channel, headless: false });
const browser = await chromium.connect(bs.wsEndpoint());
const pid = bs.process().pid;

// Memory sampler: epoch ms, private bytes of the browser and all its descendants.
mkdirSync(OUT, { recursive: true });
const memCsv = resolve(OUT, `mem-${Date.now()}.csv`);
// Absolute: nothing here is looked up on PATH.
const POWERSHELL = String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
const ps = spawn(
  POWERSHELL,
  [
    '-NoProfile',
    '-Command',
    `$root=${pid}; while ($true) { $all = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,PrivatePageCount; ` +
      `$ids=@($root); $added=$true; while ($added) { $added=$false; foreach ($p in $all) { if ($ids -contains $p.ParentProcessId -and -not ($ids -contains $p.ProcessId)) { $ids += $p.ProcessId; $added=$true } } }; ` +
      `$sum = ($all | Where-Object { $ids -contains $_.ProcessId } | Measure-Object -Property PrivatePageCount -Sum).Sum; ` +
      `Add-Content -Path '${memCsv}' -Value ("{0},{1}" -f [DateTimeOffset]::Now.ToUnixTimeMilliseconds(), $sum); Start-Sleep -Milliseconds 100 }`,
  ],
  { stdio: 'ignore' },
);

const results: Result[] = [];
try {
  const page = await browser.newPage();
  await page.goto(`${ORIGIN}/spike/s6-loudness/`);
  await page.waitForFunction(() => '__ttS6' in window);
  await page.getByTestId('s6-files').setInputFiles(fx.map((f) => resolve(f.path)));
  for (const [n, f] of fx.entries()) {
    for (const rate of RATES) {
      await page.waitForTimeout(400); // a clean baseline sample before each decode
      const r = (await page.evaluate(
        ([name, rt]) =>
          (
            window as unknown as { __ttS6: { analyze: (n: string, r: number) => Promise<unknown> } }
          ).__ttS6.analyze(name, rt),
        [f.name, rate] as const,
      )) as Result;
      results.push(r);
      console.log(
        `${String(n + 1).padStart(3)}/${fx.length} ${String(rate).padStart(5)} Hz  ${f.kind.padEnd(6)} ` +
          `${r.error ? `ERROR ${r.error}` : `${r.lufs} LUFS (ref ${f.refLufs})  ${r.decodeMs + r.computeMs} ms`}`,
      );
    }
  }
} finally {
  ps.kill();
  await browser.close();
  await bs.close();
  await server.stop();
}

// ── memory per analysis ─────────────────────────────────────────────────────
const samples = readFileSync(memCsv, 'utf8')
  .trim()
  .split('\n')
  .map((l) => l.split(',').map(Number) as [number, number])
  .filter(([t, b]) => Number.isFinite(t) && Number.isFinite(b));
for (const r of results) {
  const before = samples.filter(([t]) => t <= r.startedAt).at(-1)?.[1];
  const during = samples
    .filter(([t]) => t >= r.startedAt && t <= r.endedAt + 200)
    .map(([, b]) => b);
  if (before !== undefined && during.length)
    r.memPeakMb = Math.round((Math.max(...during) - before) / 2 ** 20);
}

// ── verdict ─────────────────────────────────────────────────────────────────
const ref = new Map(fx.map((f) => [f.name, f]));
const errAt = (rate: number) =>
  results
    .filter((r) => r.rate === rate && r.lufs !== null)
    .map((r) => ({ r, err: (r.lufs ?? 0) - (ref.get(r.name)?.refLufs ?? 0) }));
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))]! : Number.NaN;
};
const summary = RATES.map((rate) => {
  const e = errAt(rate).map((x) => Math.abs(x.err));
  const within05 = e.filter((x) => x <= 0.5).length;
  const peakUnder = results
    .filter((r) => r.rate === rate && r.peakDb !== null)
    .map((r) => (ref.get(r.name)?.refPeakDb ?? 0) - (r.peakDb ?? 0));
  const long = results.filter((r) => r.rate === rate && ref.get(r.name)?.kind === 'long');
  return {
    rate,
    files: e.length,
    within05Pct: e.length ? Math.round((within05 / e.length) * 1000) / 10 : 0,
    maxErr: Math.round(Math.max(0, ...e) * 100) / 100,
    peakUnderP99: Math.round(pct(peakUnder, 0.99) * 100) / 100,
    longMaxMs: Math.max(0, ...long.map((r) => r.decodeMs + r.computeMs)),
    longMaxMemMb: Math.max(0, ...long.map((r) => r.memPeakMb ?? 0)),
    errors: results.filter((r) => r.rate === rate && r.error).length,
  };
});
const passes = (s: (typeof summary)[number]) =>
  s.errors === 0 &&
  s.within05Pct >= 95 &&
  s.maxErr <= 1 &&
  s.longMaxMs <= 3000 &&
  s.longMaxMemMb <= 400;
const chosen =
  summary.find((s) => s.rate === 16_000 && passes(s)) ??
  summary.find((s) => s.rate === 24_000 && passes(s));
const ua = 'see JSON';
const lines = [
  `# S6 — ${channel} — ${chosen ? `PASS at ${chosen.rate / 1000} kHz` : 'FAIL'}`,
  '',
  '| rate | files | within 0.5 LU | worst error | peak under-read p99 | 10:02 time | 10:02 memory | errors |',
  '|---|---|---|---|---|---|---|---|',
  ...summary.map(
    (s) =>
      `| ${s.rate / 1000} kHz | ${s.files} | ${s.within05Pct} % | ${s.maxErr} LU | ${s.peakUnderP99} dB | ${s.longMaxMs} ms | ${s.longMaxMemMb} MB | ${s.errors} |`,
  ),
  '',
  'PASS needs, at 16 kHz (else 24 kHz): ≥ 95 % within 0.5 LU, worst ≤ 1 LU, a 10:02 file in ≤ 3 s and ≤ 400 MB, no decode errors.',
];
const base = join(OUT, `${new Date().toISOString().replace(/[:.]/g, '-')}-${channel}`);
writeFileSync(`${base}.json`, JSON.stringify({ ua, channel, summary, results }, null, 2));
writeFileSync(`${base}.md`, lines.join('\n') + '\n');
console.log(`\n${lines.join('\n')}\n\n→ ${base}.{json,md}`);
process.exitCode = chosen ? 0 : 1;
