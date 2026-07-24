/**
 * Asserts the `/app/` boot bundle against the `docs/13 §5` budget.
 *
 * Runs as the last stage of `pnpm build`. **A budget checked by hand is a budget
 * that drifts** — this one had been written down since P1 and never measured
 * once, which is why it is a build step and not a checklist line.
 *
 * ## What "boot bundle" means here, precisely
 *
 * Not "every file in `_astro/`". The budget is about what a browser must
 * download before `/app/` is interactive, so it is the entry script plus the
 * modules Vite preloads with it — the `__vite__mapDeps` list inside the entry.
 *
 * Everything reached by a *dynamic* import is deliberately excluded, because
 * that is the point of loading it dynamically: `music-metadata` and its parser
 * chain (~25 KB gz) arrive at the first import action, and the YouTube IFrame
 * API is fetched from Google only on entering YouTube mode (`docs/11 §2`,
 * `docs/06 §2`). Counting them would measure a page nobody loads.
 *
 * Measured gzipped, because that is what crosses the network. Cloudflare also
 * serves brotli, which is smaller — so this is the pessimistic number.
 */
import { gzipSync } from 'node:zlib';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';
const ENTRY_HTML = join(DIST, 'app', 'index.html');

/** docs/13 §5. Gzipped bytes. */
const BUDGET_KB = 250;

function fail(msg: string): never {
  console.error(`\n✖ check-budget: ${msg}\n`);
  process.exit(1);
}

const html = await readFile(ENTRY_HTML, 'utf8').catch(() =>
  fail(`${ENTRY_HTML} is missing — did astro build run?`),
);

/** The island is hand-mounted, so /app/ has exactly one module script. */
const entries = [...html.matchAll(/<script[^>]+src="(\/_astro\/[^"]+\.js)"/g)].map((m) => m[1]!);
if (entries.length !== 1) {
  fail(
    `expected exactly one module script in /app/, found ${entries.length}. ` +
      `The hand-mount (docs/01 §3) is the only one there should be.`,
  );
}

const entry = entries[0]!.replace(/^\//, '');
const entrySource = await readFile(join(DIST, entry), 'utf8');

/*
 * Vite emits `__vite__mapDeps` listing the chunks preloaded alongside the entry.
 * Those are the boot cost; anything imported later is not.
 */
const deps = [...entrySource.matchAll(/"(_astro\/[^"]+\.js)"/g)].map((m) => m[1]!);
const boot = [...new Set([entry, ...deps])];

let total = 0;
const rows: string[] = [];

for (const file of boot) {
  const path = join(DIST, file);
  if (!(await stat(path).catch(() => null))) continue;
  const gz = gzipSync(await readFile(path)).length;
  total += gz;
  rows.push(`${String(gz).padStart(8)} gz  ${file}`);
}

if (rows.length === 0) fail('resolved no boot chunks — the entry format must have changed');

const kb = total / 1024;

if (kb > BUDGET_KB) {
  fail(
    `/app/ boot bundle is ${kb.toFixed(1)} KB gz, over the ${BUDGET_KB} KB budget ` +
      `(docs/13 §5) by ${(kb - BUDGET_KB).toFixed(1)} KB:\n${rows.join('\n')}`,
  );
}

console.log(
  `✓ check-budget: /app/ boot ${kb.toFixed(1)} KB gz of ${BUDGET_KB} KB ` +
    `(${boot.length} chunks, ${(BUDGET_KB - kb).toFixed(1)} KB headroom)`,
);
