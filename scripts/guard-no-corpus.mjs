#!/usr/bin/env node
/**
 * Blocks the local spike corpus from ever entering git history.
 *
 * .gitignore is not enough on its own: it does nothing against `git add -f`,
 * nothing against a path that gets un-ignored by a future edit, and nothing at
 * all in CI. This is the actual enforcement (docs/15 S3 corpus, .gitignore).
 *
 * Two modes:
 *   --staged   inspect the git index          (pre-commit hook)
 *   default    inspect every tracked file     (CI, docs/14 §1 ci.yml)
 *
 * Exit 0 clean, 1 on any violation.
 */
import { execFileSync } from 'node:child_process';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — no legitimate source file is bigger

const AUDIO = /\.(mp3|flac|wav|opus|ogg|oga|m4a|aac|aif|aiff|alac|ac3|wma|webm)$/i;

/**
 * The only place committed audio is allowed: the self-made ~5 s tones generated
 * by scripts/make-fixtures.ts (docs/13 §3). Everything else is a violation.
 */
const AUDIO_ALLOWLIST = /^tests\/e2e\/fixtures\//;

const staged = process.argv.includes('--staged');

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function listFiles() {
  const out = staged
    ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    : git(['ls-files']);
  return out ? out.split('\n').filter(Boolean) : [];
}

function sizeOf(path) {
  // Read from the index when staged, so a file staged then shrunk on disk is
  // still judged by what would actually be committed.
  const rev = staged ? `:${path}` : `HEAD:${path}`;
  try {
    return Number(git(['cat-file', '-s', rev]));
  } catch {
    return 0; // not in that tree (e.g. not yet committed) — nothing to judge
  }
}

const violations = [];

for (const file of listFiles()) {
  if (file.startsWith('test/')) {
    violations.push([file, 'inside test/ — the local-only spike corpus, never committed']);
    continue;
  }
  if (AUDIO.test(file) && !AUDIO_ALLOWLIST.test(file)) {
    violations.push([file, 'audio outside tests/e2e/fixtures/ (docs/13 §3)']);
    continue;
  }
  const bytes = sizeOf(file);
  if (bytes > MAX_BYTES) {
    violations.push([file, `${(bytes / 1024 / 1024).toFixed(1)} MB exceeds the 2 MB limit`]);
  }
}

if (violations.length) {
  console.error(`\n✖ guard-no-corpus: ${violations.length} violation(s)\n`);
  for (const [file, why] of violations) console.error(`  ${file}\n      ↳ ${why}`);
  console.error(
    '\nThe test/ corpus is ~651 MB of third-party music and must never be pushed.\n' +
      'Committing it would also contradict legal/THIRD-PARTY-NOTICES.md, which states\n' +
      'that TickTune ships no third-party audio.\n' +
      'If a file here is genuinely legitimate, widen AUDIO_ALLOWLIST deliberately —\n' +
      'do not bypass this check.\n',
  );
  process.exit(1);
}

console.log(`✓ guard-no-corpus: ${staged ? 'staged changes' : 'tracked tree'} clean`);
