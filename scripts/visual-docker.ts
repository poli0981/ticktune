/**
 * Check — or make — the visual baselines inside the pinned Playwright image,
 * docs/13 §3 (v2.0).
 *
 *   pnpm test:visual:docker            compare against tests/visual/__screenshots__/
 *   pnpm test:visual:docker --update   write new baselines (review them, then commit)
 *
 * Screenshots only compare when the fonts, the rasteriser and the browser build
 * are identical, so this runs exactly what CI's `visual` job runs: the same
 * image, pinned by digest. The working tree goes in as a tar on stdin — minus
 * node_modules, builds and the local corpus — and is installed and built
 * INSIDE the container, because a Linux node_modules must never land in this
 * checkout. Only the screenshots, and on a failure the report, come back out.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * `tar` and `docker` from fixed, system-owned directories, never from whatever
 * PATH holds (SonarCloud S4036): a writable directory early on PATH would run
 * its own `tar` with this checkout piped into it.
 */
const BIN_DIRS =
  process.platform === 'win32'
    ? [String.raw`C:\Windows\System32`, String.raw`C:\Program Files\Docker\Docker\resources\bin`]
    : ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'];
function bin(name: string): string {
  const file = process.platform === 'win32' ? `${name}.exe` : name;
  const found = BIN_DIRS.map((d) => join(d, file)).find((p) => existsSync(p));
  if (!found) throw new Error(`${name}: not found in ${BIN_DIRS.join(', ')}`);
  return found;
}

// Keep in step with the `visual` job in .github/workflows/quality.yml.
const IMAGE =
  'mcr.microsoft.com/playwright:v1.64.1-noble@sha256:7852dc5a7d72f5fe458a597d690f6c42fbc8e9e26ddfa95f8e6ef552558d9bbf';
/*
 * `--update` rewrites EVERY baseline, not Playwright's default of the ones that
 * fail. A change inside the tolerance (`maxDiffPixelRatio` 0.001 — 1,296 px at
 * 1440×900) never fails, so the default never wrote it and the baseline went
 * quietly stale while this script said "written": the crossfade toggle going
 * from disabled (opacity 0.4) to live was such a change (v2.0). One image,
 * one renderer, so an unchanged screen re-encodes to the same bytes.
 */
const update = process.argv.includes('--update');

const inside = [
  'set -e',
  'mkdir -p /work && cd /work && tar -x -f -',
  'corepack enable >&2',
  'CI=1 pnpm install --frozen-lockfile >&2',
  'pnpm build >&2',
  'status=0',
  `CI=1 pnpm exec playwright test -c playwright.visual.config.ts ${update ? '--update-snapshots=all' : ''} >&2 || status=$?`,
  // Results back out on stdout, as a tar; everything else went to stderr.
  'tar -c tests/visual/__screenshots__ $( [ -d playwright-report ] && echo playwright-report )',
  'exit $status',
].join('\n');

const pack = spawn(
  bin('tar'),
  [
    '-c',
    '--exclude=./node_modules',
    '--exclude=./dist',
    '--exclude=./dist-spikes',
    '--exclude=./.git',
    '--exclude=./.astro',
    '--exclude=./test',
    '--exclude=./test-results',
    '--exclude=./playwright-report',
    '--exclude=./lhci-report',
    '--exclude=./.lighthouseci',
    '--exclude=./.claude',
    '-f',
    '-',
    '.',
  ],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
const run = spawn(bin('docker'), ['run', '--rm', '-i', IMAGE, 'bash', '-c', inside], {
  stdio: ['pipe', 'pipe', 'inherit'],
});
const unpack = spawn(bin('tar'), ['-x', '-f', '-'], { stdio: ['pipe', 'inherit', 'inherit'] });

pack.stdout.pipe(run.stdin);
run.stdout.pipe(unpack.stdin);

// Both listeners go on now. Waiting for `unpack` from inside run's handler
// missed it whenever tar finished first — docker's client outlives the
// container's stdout — and the script then exited 0 over failed tests.
const closed = (p: ChildProcess) =>
  new Promise<number | null>((resolve) => p.on('close', (code) => resolve(code)));
const [code, unpacked] = await Promise.all([closed(run), closed(unpack)]);

console.log(
  code === 0
    ? `✓ visual: ${update ? 'baselines written' : 'matches the baselines'}`
    : `✖ visual: exit ${code} — see playwright-report/ for the diffs`,
);
process.exitCode = code === 0 && unpacked === 0 ? 0 : 1;
