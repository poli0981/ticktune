/**
 * Rewrites the mobile-gate inline-script hash into dist/_headers.
 *
 * Normative contract: docs/10 §7. Runs after `astro build`, before
 * `wrangler deploy` — wired as the second half of `pnpm build`.
 *
 * The load-bearing part is the assertion, not the hashing. A CSP that names a
 * hash is only as good as the guarantee that the hash covers every inline
 * script on the site; without that check, adding a second inline script
 * anywhere would ship a policy that silently blocks it — in production only,
 * because dev has no CSP. So: exactly one distinct inline script, or the build
 * fails.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const DIST = 'dist';
const HEADERS = join(DIST, '_headers');
const PLACEHOLDER = '<TT_GATE_HASH>';

/** Inline = a <script> with no src. Matches across newlines. */
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

async function htmlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await htmlFiles(p)));
    else if (entry.name.endsWith('.html')) out.push(p);
  }
  return out;
}

function fail(msg: string): never {
  console.error(`\n✖ inject-csp-hash: ${msg}\n`);
  process.exit(1);
}

const pages = await htmlFiles(DIST);
if (pages.length === 0) fail(`no HTML found in ${DIST}/ — did astro build run?`);

/** hash → the pages it was found on, for a useful error message. */
const hashes = new Map<string, string[]>();

for (const page of pages) {
  const html = await readFile(page, 'utf8');
  for (const m of html.matchAll(INLINE_SCRIPT)) {
    const body = m[1];
    if (body === undefined || body.trim() === '') continue;
    // Hash the exact bytes between the tags — that is what the browser hashes.
    const hash = createHash('sha256').update(body, 'utf8').digest('base64');
    const seen = hashes.get(hash) ?? [];
    seen.push(relative(DIST, page));
    hashes.set(hash, seen);
  }
}

if (hashes.size === 0) {
  fail(
    'no inline <script> found. The mobile gate in src/layouts/TtBase.astro is ' +
      'supposed to be one (docs/07 §3.1) — if it was removed or turned into a ' +
      'module script, hard invariant 6 is broken, not just this build step.',
  );
}

if (hashes.size > 1) {
  const detail = [...hashes.entries()]
    .map(([h, where]) => `    sha256-${h}\n      on: ${where.join(', ')}`)
    .join('\n');
  fail(
    `expected exactly 1 distinct inline script, found ${hashes.size}:\n${detail}\n` +
      '  The CSP names a single hash (docs/09 §4), so any additional inline ' +
      'script would be blocked in production and nowhere else.\n' +
      '  Make it a module script instead — see src/pages/app/index.astro for ' +
      'the pattern, and docs/10 §7 for why.',
  );
}

const [hash, pagesWithGate] = [...hashes.entries()][0]!;

let headers: string;
try {
  headers = await readFile(HEADERS, 'utf8');
} catch {
  fail(`${HEADERS} is missing — public/_headers should have been copied by astro build.`);
}

if (!headers.includes(PLACEHOLDER)) {
  fail(
    `${PLACEHOLDER} not found in ${HEADERS}. A stale _headers would ship a CSP ` +
      'whose hash does not match the gate, blocking it in production.',
  );
}

await writeFile(HEADERS, headers.replaceAll(PLACEHOLDER, hash), 'utf8');

console.log(
  `✓ inject-csp-hash: sha256-${hash} (gate found on ${pagesWithGate.length}/${pages.length} pages)`,
);
