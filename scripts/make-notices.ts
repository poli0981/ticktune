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
import { execFileSync, execSync } from 'node:child_process';
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
const CSS_ONLY = [
  '@fontsource/be-vietnam-pro',
  '@fontsource/chakra-petch',
  '@fontsource/jetbrains-mono',
];

const LICENSE_FILE = /^(LICEN[CS]E|COPYING|OFL)(\.(txt|md))?$/i;

/**
 * Apache-2.0 §4(d): "if the Work includes a NOTICE text file … You must include
 * a readable copy of the attribution notices contained within such NOTICE file".
 *
 * Matched separately from LICENSE_FILE on purpose. The first version folded both
 * into one pattern and took the FIRST match, so a package shipping both files
 * got only its `LICENSE` — and Dexie's `NOTICE` carries its only copyright line.
 */
const NOTICE_FILE = /^NOTICE(\.(txt|md))?$/i;

/** Code-point order: deterministic across machines, unlike an unpinned localeCompare. */
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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
    raw = runPnpm(['licenses', 'list', '--prod', '--json']);
  } catch (err) {
    fail(`\`pnpm licenses list\` failed — ${(err as Error).message}`);
  }

  /*
   * Merged, not overwritten. `pnpm licenses` groups by licence id, so a package
   * resolved twice under two different licences appears in two groups — and a
   * plain `set` let whichever group came last erase the other's versions, paths
   * and licence.
   */
  const byName = new Map<string, PnpmPkg>();
  for (const group of Object.values(JSON.parse(raw) as Record<string, PnpmPkg[]>)) {
    for (const pkg of group) {
      const seen = byName.get(pkg.name);
      if (!seen) {
        byName.set(pkg.name, { ...pkg, versions: [...pkg.versions], paths: [...pkg.paths] });
        continue;
      }
      seen.versions = [...new Set([...seen.versions, ...pkg.versions])];
      seen.paths = [...new Set([...seen.paths, ...pkg.paths])];
      if (!seen.license.split(' OR ').includes(pkg.license)) seen.license += ` OR ${pkg.license}`;
    }
  }
  return byName;
}

/**
 * Run pnpm WITHOUT a PATH lookup or a shell (SonarCloud S4036).
 *
 * `pnpm build` runs this script, and pnpm exports the path of its own entry
 * point as `npm_execpath`. That is the pnpm already executing the build, so it is
 * the one to trust: a `.cjs`/`.js` entry runs under this very Node binary, a
 * standalone executable runs directly.
 *
 * The literal-command `execSync` remains only for running this file by hand
 * outside pnpm. It interpolates nothing, so there is no argument to escape.
 */
function runPnpm(args: string[]): string {
  const opts = { encoding: 'utf8' as const, maxBuffer: 64 * 1024 * 1024 };
  const entry = process.env['npm_execpath'];
  if (entry && /\.[cm]?js$/i.test(entry)) {
    return execFileSync(process.execPath, [entry, ...args], opts);
  }
  if (entry && /pnpm(\.exe)?$/i.test(entry)) {
    return execFileSync(entry, args, opts);
  }
  // NOSONAR — reached only when the script is run by hand outside pnpm; the argv is fixed.
  return execSync(`pnpm ${args.join(' ')}`, opts); // NOSONAR
}

/**
 * The package's own licence text — plus its NOTICE, when it has one — read from
 * where pnpm resolved it. Null when there is no licence file at all.
 */
async function licenseText(dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = (await readdir(dir)).sort(byCodePoint);
  } catch {
    return null;
  }
  const license = entries.find((e) => LICENSE_FILE.test(e));
  if (!license) return null;

  const parts = [(await readFile(join(dir, license), 'utf8')).trimEnd()];
  const notice = entries.find((e) => NOTICE_FILE.test(e));
  if (notice) {
    parts.push(`NOTICE\n\n${(await readFile(join(dir, notice), 'utf8')).trimEnd()}`);
  }
  return parts.join('\n\n');
}

/**
 * Every distinct text across the versions that ship. Two copies of one package
 * usually carry byte-identical licences, and then this is one entry; when they
 * differ, the first version's text alone would under-attribute the second.
 */
async function licenseTexts(paths: string[]): Promise<string | null> {
  const texts: string[] = [];
  for (const dir of paths) {
    const text = await licenseText(dir);
    if (text && !texts.includes(text)) texts.push(text);
  }
  return texts.length === 0 ? null : texts.join(`\n\n${'·'.repeat(39)}\n\n`);
}

const bundled: string[] = await readFile(BUNDLED, 'utf8')
  .then((s) => JSON.parse(s))
  .catch(() =>
    fail(`${BUNDLED} is missing — the ttBundledPackages plugin did not run. Did astro build?`),
  );

const wanted = [...new Set([...bundled, ...CSS_ONLY])].sort(byCodePoint);
const licenses = pnpmLicenses();

const sections: string[] = [];
const missing: string[] = [];

for (const name of wanted) {
  const pkg = licenses.get(name);
  if (!pkg) {
    missing.push(`${name} (not in the pnpm production closure)`);
    continue;
  }

  const text = await licenseTexts(pkg.paths);
  if (!text) {
    missing.push(`${name} (no LICENSE file at ${pkg.paths.join(', ')})`);
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
present in the shipped client bundle, plus the three webfont families that arrive
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
