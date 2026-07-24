/**
 * Generates `dist/THIRD-PARTY-NOTICES.txt` — the attribution artifact.
 *
 * Closes the `docs/AUDIT-BACKLOG.md` release blocker. Runs after `astro build`,
 * wired as the third stage of `pnpm build`.
 *
 * ## Why this is generated rather than written
 *
 * `legal/THIRD-PARTY-NOTICES.md` is a curated 12-row overview, and a hand-kept
 * table structurally cannot carry a notice obligation: the code that ships
 * includes `music-metadata`'s whole transitive chain — `strtok3`, `token-types`,
 * `@borewit/text-codec`, `@tokenizer/inflate`, `file-type`, `uint8array-extras`
 * — none of which anyone would think to add by hand. The MIT licence requires
 * its copyright and permission notice to travel with the distribution; Apache-2.0
 * §4(a)/(d) requires the licence and NOTICE; the OFL requires its text to
 * accompany the font. A table of names satisfies none of them.
 *
 * ## Where the two halves come from
 *
 * **Which packages** comes from the build, not from `package.json`. The
 * `ttBundledPackages` plugin in `astro.config.mjs` records the module graph the
 * bundler actually emitted for the **client** environment. That distinction is
 * load-bearing: `pnpm licenses list --prod --json` reports 233 packages
 * including `@astrojs/compiler-binding`, a build tool no browser ever receives,
 * and attribution attaches to what is distributed.
 *
 * **Which licence** comes from `pnpm licenses`, which reads the real lockfile
 * resolution, plus the package's own LICENSE file read off disk for the text.
 *
 * ⚠️ The fonts are invisible to the module graph — woff2 arrives via a CSS
 * `@import`, so no JS module id ever names `@fontsource/*`. They are added by
 * name below. Same blind spot that makes `knip` need them in
 * `ignoreDependencies`; both workarounds must move together.
 */
import { execSync } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';
const BUNDLED = join(DIST, 'tt-bundled-packages.json');
const OUT = join(DIST, 'THIRD-PARTY-NOTICES.txt');

/**
 * Shipped through CSS, so the bundler never sees them.
 *
 * DSEG7 is deliberately absent: it is vendored, not an npm package, and its
 * OFL.txt already ships from `public/fonts/dseg7/` (docs/03 §1). Listing it here
 * would attribute it twice.
 */
const CSS_ONLY = ['@fontsource/be-vietnam-pro', '@fontsource/jetbrains-mono'];

const LICENSE_FILE = /^(LICEN[CS]E|COPYING|NOTICE|OFL)(\.(txt|md))?$/i;

function fail(msg: string): never {
  console.error(`\n✖ make-notices: ${msg}\n`);
  process.exit(1);
}

interface PnpmPkg {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
  author?: string;
  homepage?: string;
}

/** `pnpm licenses list` groups by licence id; flatten to name → record. */
function pnpmLicenses(): Map<string, PnpmPkg> {
  let raw: string;
  try {
    /*
     * `execSync` with a literal command, deliberately.
     *
     * `execFileSync('pnpm', …)` cannot run on Windows — pnpm is a `.cmd` and
     * Node 24 refuses to spawn one without a shell (EINVAL). Adding
     * `shell: true` to `execFileSync` instead triggers DEP0190, which warns
     * that args are concatenated unescaped. Neither applies here: the command
     * is a fixed string with nothing interpolated into it, so there is no
     * argument to escape and no injection surface.
     */
    raw = execSync('pnpm licenses list --prod --json', {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    fail(`\`pnpm licenses list\` failed — ${(err as Error).message}`);
  }

  const byName = new Map<string, PnpmPkg>();
  for (const group of Object.values(JSON.parse(raw) as Record<string, PnpmPkg[]>)) {
    for (const pkg of group) byName.set(pkg.name, pkg);
  }
  return byName;
}

/** The package's own licence text, read from where pnpm resolved it. */
async function licenseText(dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const file = entries.find((e) => LICENSE_FILE.test(e));
  if (!file) return null;
  return (await readFile(join(dir, file), 'utf8')).trimEnd();
}

const bundled: string[] = await readFile(BUNDLED, 'utf8')
  .then((s) => JSON.parse(s))
  .catch(() =>
    fail(`${BUNDLED} is missing — the ttBundledPackages plugin did not run. Did astro build?`),
  );

const wanted = [...new Set([...bundled, ...CSS_ONLY])].sort();
const licenses = pnpmLicenses();

const sections: string[] = [];
const missing: string[] = [];

for (const name of wanted) {
  const pkg = licenses.get(name);
  if (!pkg) {
    missing.push(`${name} (not in the pnpm production closure)`);
    continue;
  }

  const text = await licenseText(pkg.paths[0] ?? '');
  if (!text) {
    missing.push(`${name} (no LICENSE file at ${pkg.paths[0]})`);
    continue;
  }

  sections.push(
    [
      '-'.repeat(78),
      `${name}  ${pkg.versions.join(', ')}`,
      `License: ${pkg.license}`,
      pkg.author ? `Author:  ${pkg.author}` : null,
      pkg.homepage ? `Home:    ${pkg.homepage}` : null,
      '-'.repeat(78),
      '',
      text,
      '',
    ]
      .filter((l) => l !== null)
      .join('\n'),
  );
}

/*
 * A package we ship whose licence text we cannot produce is exactly the failure
 * this file exists to prevent, so it fails the build rather than emitting an
 * artifact that silently omits it.
 */
if (missing.length > 0) {
  fail(`no licence text for ${missing.length} shipped package(s):\n  - ${missing.join('\n  - ')}`);
}

const header = `TickTune — Third-Party Notices
================================================================================

TickTune itself is licensed GPL-3.0-only, (c) 2026 poli0981.
Source: https://github.com/poli0981/ticktune

This file is GENERATED at build time from the packages whose code is actually
present in the shipped client bundle, plus the two webfont families that arrive
through CSS and so cannot appear in a module graph. It is not hand-maintained;
see scripts/make-notices.ts. The curated human-readable summary is at
/legal/third-party.

DSEG7 Classic is vendored rather than installed, and its OFL text ships
separately at /fonts/dseg7/OFL.txt (OFL section 2).

${sections.length} components follow.

`;

await writeFile(OUT, header + sections.join('\n'), 'utf8');

// The package list is a build intermediate, not something to serve.
await rm(BUNDLED, { force: true });

console.log(`✓ make-notices: ${sections.length} components → ${OUT}`);
