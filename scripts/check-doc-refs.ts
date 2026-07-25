/**
 * Resolves every `NN §M` cross-reference in the docs suite against the target
 * file's real headings — P7 slice B, closing two `AUDIT-BACKLOG` findings.
 *
 * ## Why this is a script and not a proofread
 *
 * The suite carries **712** of these references and they are load-bearing: they
 * are how `docs/06 §1` tells a reader where the CSP rule actually lives, and how
 * `CLAUDE.md` points at the invariant behind a refusal. The audit found seven
 * wrong ones by hand, which is both a lot of effort and not a guarantee — a
 * section renumbered in one file silently invalidates every citation of it
 * everywhere else, and nothing fails.
 *
 * So: extract, resolve, report. A reference to a section that does not exist
 * fails the build, exactly like an unused export or an over-budget bundle.
 *
 * ## What defines a section, and the trap in answering that
 *
 * `## 4. Content-Security-Policy (authoritative)` defines `§4`, and
 * `### 3.1 Keys filed ahead of P5` defines `§3.1`.
 *
 * 🔴 **But a subsection is more often a numbered list item than a heading**, and
 * the first version of this script did not know that. It reported 23 broken
 * references — three times what the audit found by hand — and **21 of them were
 * correct citations**. `06 §1.2` is item 2 of `## 1. Compliance rules`, the
 * always-visible player rule; `12 §3.1` is item 1 of `## 3. Architecture rules`,
 * the engine-imports-nothing-from-svelte rule. Both resolve to exactly what
 * cites them.
 *
 * Acting on that first output would have vandalised twenty-one working pointers
 * to make a linter happy. A guard that does not model the thing it checks
 * manufactures work and calls it quality — so `§N.S` resolves against a heading
 * **or** against section `N` having at least `S` numbered items.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DOCS = 'docs';

/** `NN §M` or `NN §M.S` — the citation form the whole suite uses. */
const REF = /\b(\d{2}) §(\d+(?:\.\d+)?)/g;

/** `## 4. Title` / `### 3.1 Title` — the number is the section id. */
const HEADING = /^#{2,6}\s+(\d+(?:\.\d+)?)[.\s]/;

/** A top-level ordered-list item: `1. …` at the start of a line, not indented. */
const LIST_ITEM = /^(\d+)\.\s/;

function fail(msg: string): never {
  console.error(`\n✖ check-doc-refs: ${msg}\n`);
  process.exit(1);
}

/** `docs/09-SECURITY.md` → `09`. */
const chapterOf = (name: string) => /^(\d{2})-/.exec(name)?.[1] ?? null;

const files = (await readdir(DOCS)).filter((f) => f.endsWith('.md'));

/** chapter → the section ids it defines. */
const sections = new Map<string, Set<string>>();
/** chapter → its filename, for error messages. */
const chapterFile = new Map<string, string>();

for (const file of files) {
  const chapter = chapterOf(file);
  if (!chapter) continue;
  chapterFile.set(chapter, file);

  const ids = new Set<string>();

  /** The `## N.` we are inside, so its list items can be numbered `N.S`. */
  let current: string | null = null;

  for (const line of (await readFile(join(DOCS, file), 'utf8')).split('\n')) {
    const heading = HEADING.exec(line)?.[1];
    if (heading) {
      ids.add(heading);
      // Only a top-level section opens a list scope; `### 3.1` is itself an id.
      current = heading.includes('.') ? current : heading;
      continue;
    }

    // `§N.S` where S is the S-th numbered item of section N (see the header).
    const item = LIST_ITEM.exec(line)?.[1];
    if (item && current) ids.add(`${current}.${item}`);
  }

  sections.set(chapter, ids);
}

if (sections.size === 0) fail(`found no numbered chapters in ${DOCS}/`);

/*
 * Every file that cites the suite, not just the suite itself — CLAUDE.md is the
 * condensed contract and its references rot the same way.
 */
const sources = [...files.map((f) => join(DOCS, f)), 'CLAUDE.md'];

const broken: string[] = [];
let checked = 0;

for (const path of sources) {
  const body = await readFile(path, 'utf8').catch(() => null);
  if (body === null) continue;

  const lines = body.split('\n');
  for (const [i, line] of lines.entries()) {
    /*
     * Skip lines that strike a reference out. The suite deliberately keeps
     * corrected claims visible — "~~09 §4 said X~~, and it was wrong" — and a
     * citation inside `~~…~~` is history, not a live pointer.
     */
    if (line.includes('~~')) continue;

    for (const m of line.matchAll(REF)) {
      checked++;
      const [, chapter, section] = m as unknown as [string, string, string];

      if (!sections.has(chapter)) {
        broken.push(`${path}:${i + 1}  ${chapter} §${section} — no chapter ${chapter} exists`);
        continue;
      }
      if (!sections.get(chapter)!.has(section)) {
        const have = [...sections.get(chapter)!].sort().join(', ');
        broken.push(
          `${path}:${i + 1}  ${chapter} §${section} — ${chapterFile.get(chapter)} has no §${section}` +
            `\n           it defines: ${have}`,
        );
      }
    }
  }
}

if (broken.length > 0) {
  fail(
    `${broken.length} of ${checked} cross-reference(s) resolve to nothing:\n\n` +
      broken.map((b) => `  ${b}`).join('\n'),
  );
}

console.log(`✓ check-doc-refs: ${checked} cross-references resolve (${sections.size} chapters)`);
