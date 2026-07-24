import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TT_LEGAL_DOCS,
  TT_LEGAL_LINKS,
  TT_LEGAL_VERSION,
  ttLegalHref,
} from '../../src/lib/tt-legal-const';

/**
 * The legal set — P6 slice B.
 *
 * `legal/*.md` is canonical English and `legal/vi/*.md` its translation. Nothing
 * in the type system can express "the same four documents exist on both sides at
 * the same version", so it is expressed here.
 *
 * These read the real files rather than fixtures on purpose: a fixture would
 * pass while the shipped documents drifted, which is the exact failure this
 * exists to prevent.
 */

const EN_DIR = join(process.cwd(), 'legal');
const VI_DIR = join(EN_DIR, 'vi');

const mdIn = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();
const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf8');

/** `Version 1.0-draft · 2026-07-21 · …` — the token both languages must share. */
const versionToken = (body: string) =>
  /^Version\s+(\S+)\s+·\s+(\d{4}-\d{2}-\d{2})/m.exec(body)?.slice(1, 3).join(' ');

/**
 * The bundled-components table's Component and Licence columns.
 *
 * Only the first table: the Services one below it names products in prose, and
 * the header row's two cells are headings, which do translate. Everything this
 * returns is a component name or an SPDX id, and `docs/08 §3.1` says those are
 * never translated — so the two languages must return the identical list.
 *
 * ⚠️ Taken as "the first contiguous run of table rows", NOT by splitting on the
 * `## Services` heading — that heading is itself translated (`## Dịch vụ`), so
 * splitting on it silently fails to cut the Vietnamese file and folds the
 * services table into the comparison. Structure survives translation; headings
 * do not.
 */
const bundledRows = (body: string) => {
  const rows: string[] = [];
  for (const line of body.split('\n')) {
    if (line.startsWith('|')) {
      if (!/^\|[\s|:-]+\|$/.test(line)) rows.push(line);
    } else if (rows.length) break;
  }
  // Drop the header row, whose two cells are headings and do translate.
  return rows.slice(1).map((l) => l.split('|').slice(1, 3).join('|').trim());
};

describe('legal — every canonical document has a Vietnamese translation', () => {
  it('the two directories hold the same filenames', () => {
    expect(mdIn(VI_DIR)).toEqual(mdIn(EN_DIR));
  });

  it.each(mdIn(EN_DIR))('%s carries the same version token in both languages', (file) => {
    const en = versionToken(read(EN_DIR, file));
    const vi = versionToken(read(VI_DIR, file));

    // A translation at a different version is worse than no translation: it
    // states terms the canonical text no longer says.
    expect(en, `no "Version X · date" line in legal/${file}`).toBeDefined();
    expect(vi).toBe(en);
  });

  it.each(mdIn(EN_DIR))('%s states that English is canonical', (file) => {
    // docs/08 §1. The page banner says it too, but the file has to say it as
    // well — the markdown is read directly on GitHub, outside any layout.
    expect(read(VI_DIR, file)).toMatch(/tiếng Anh là (?:bản gốc|ngôn ngữ gốc)/i);
  });

  it('the version token matches TT_LEGAL_VERSION', () => {
    // Otherwise the gate stores an acceptance of a version no document claims.
    for (const file of mdIn(EN_DIR)) {
      expect(versionToken(read(EN_DIR, file))).toContain(TT_LEGAL_VERSION);
    }
  });

  it('THIRD-PARTY-NOTICES lists the same components in both languages', () => {
    /*
     * `docs/08 §3.1`: component names and SPDX licence ids are NOT translated,
     * only the prose around them. So the first two columns must be identical —
     * and that makes this a real drift guard rather than a formatting check: a
     * dependency added to the canonical table and forgotten in the translation
     * means the Vietnamese notices under-report what the user is running, which
     * is the one failure mode a notices file has.
     */
    expect(bundledRows(read(VI_DIR, 'THIRD-PARTY-NOTICES.md'))).toEqual(
      bundledRows(read(EN_DIR, 'THIRD-PARTY-NOTICES.md')),
    );
  });

  it('lists no component that is not actually a dependency', () => {
    /*
     * A row means "distributed with the app". Motion carried a row reading
     * "from P5; not yet installed" through four releases — the table promised
     * attribution for something no user ever received. Reversed here: every
     * non-font, non-service row must name a real package.json dependency.
     */
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    const installed = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);

    /** Fonts and vendored assets are not npm packages; they are checked by eye. */
    const notPackages = /\(font\)|\(phông chữ\)/;

    const bundled = bundledRows(read(EN_DIR, 'THIRD-PARTY-NOTICES.md'))
      .map((r) => r.split('|')[0]!.trim())
      .filter((name) => name && !notPackages.test(name));

    const known: Record<string, string> = {
      Astro: 'astro',
      Svelte: 'svelte',
      'Tailwind CSS': 'tailwindcss',
      'Dexie.js': 'dexie',
    };

    for (const name of bundled) {
      const dep = known[name] ?? name;
      expect(
        installed.has(dep),
        `THIRD-PARTY-NOTICES lists "${name}" but it is not installed`,
      ).toBe(true);
    }
  });

  it('the VI translation is actually translated, not a copy', () => {
    for (const file of mdIn(EN_DIR)) {
      expect(read(VI_DIR, file), `legal/vi/${file} is byte-identical to the English`).not.toBe(
        read(EN_DIR, file),
      );
    }
  });
});

describe('TT_LEGAL_DOCS — the one route map', () => {
  it('covers every canonical file, and nothing that does not exist', () => {
    expect(TT_LEGAL_DOCS.map((d) => d.file).sort()).toEqual(mdIn(EN_DIR));
  });

  it('has unique keys, ids and slugs', () => {
    for (const field of ['key', 'id', 'slug'] as const) {
      const values = TT_LEGAL_DOCS.map((d) => d[field]);
      expect(new Set(values).size, `duplicate ${field}`).toBe(values.length);
    }
  });

  it('agrees with TT_LEGAL_LINKS', () => {
    // Two tables that can disagree is the defect; this asserts they cannot.
    for (const doc of TT_LEGAL_DOCS) {
      expect(TT_LEGAL_LINKS[doc.key]).toBe(`/legal/${doc.slug}/`);
    }
  });

  it('the id is what the content loader derives from the filename', () => {
    // astro's glob() slugifies the filename; getEntry() is called with the
    // result. PRIVACY-POLICY.md -> privacy-policy, which is NOT the route slug.
    for (const doc of TT_LEGAL_DOCS) {
      expect(doc.id).toBe(doc.file.replace(/\.md$/, '').toLowerCase());
    }
  });
});

describe('ttLegalHref — the language prefix', () => {
  it('leaves Vietnamese at the root and prefixes English with /en', () => {
    for (const doc of TT_LEGAL_DOCS) {
      expect(ttLegalHref(doc.key, 'vi')).toBe(`/legal/${doc.slug}/`);
      expect(ttLegalHref(doc.key, 'en')).toBe(`/en/legal/${doc.slug}/`);
    }
  });

  it('never returns a GitHub URL or a .md path', () => {
    // The pre-slice-B behaviour, which a partial revert would restore silently.
    for (const doc of TT_LEGAL_DOCS) {
      for (const lang of ['vi', 'en'] as const) {
        const href = ttLegalHref(doc.key, lang);
        expect(href.startsWith('/')).toBe(true);
        expect(href).not.toContain('github.com');
        expect(href).not.toMatch(/\.md$/);
      }
    }
  });

  it('keeps the GPL-3.0 source offer pointing at the source', () => {
    // `repo` is deliberately NOT a route: GPL-3.0 §6 requires an offer of the
    // corresponding source, not a page describing it.
    expect(TT_LEGAL_LINKS.repo).toMatch(/^https:\/\/github\.com\//);
  });
});
