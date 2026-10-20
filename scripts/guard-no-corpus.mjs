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
 *
 * ⚠️ Gotcha worth knowing if you TEST this guard: `git add -f` writes the blob
 * into .git/objects immediately, and blocking the commit does not remove it.
 * The object is unreachable, so it is never pushed (`git push` sends only
 * reachable objects) and never enters history — but it does sit in the local
 * object store until gc, and auto-gc will happily pack 30 MB of it. After
 * deliberately staging corpus files, reclaim the space with:
 *
 *   git reflog expire --expire-unreachable=now --all && git gc --prune=now
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
  // git from PATH on purpose (SonarCloud S4036, reviewed): this runs as the
  // pre-commit hook and in CI, and both must use the git that owns the checkout.
  return execFileSync('git', args, { encoding: 'utf8' }); // NOSONAR
}

/**
 * NUL-separated (`-z`), never newline-separated.
 *
 * 🔴 Without `-z`, git's default `core.quotePath=true` C-quotes any path with
 * non-ASCII bytes: the corpus file `test/test_playlist/Adeline Yeo (HP) - 梦….mp3`
 * came back as `"test/test_playlist/Adeline Yeo (HP) - \346\242\246….mp3"` —
 * leading quote, octal escapes, trailing quote. That string failed all three
 * checks below at once: it does not start with `test/`, the AUDIO regex's `$`
 * sees `.mp3"`, and `cat-file` cannot find it so the size reads as 0. The guard
 * whose whole job is to stop the corpus passed exactly the files most likely to
 * be in it.
 */
function listFiles() {
  const out = staged
    ? git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'])
    : git(['ls-files', '-z']);
  return out.split('\0').filter(Boolean);
}

function sizeOf(path) {
  // Read from the index when staged, so a file staged then shrunk on disk is
  // still judged by what would actually be committed.
  const rev = staged ? `:${path}` : `HEAD:${path}`;
  try {
    return Number(git(['cat-file', '-s', rev]).trim());
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
