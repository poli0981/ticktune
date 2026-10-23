// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config';

/**
 * The coverage scope has two readers — docs/13 §1, docs/14 §1.
 *
 * Vitest writes `coverage/lcov.info` and gates the engine core on it; SonarQube
 * Cloud reads the same file for its quality gate's coverage-on-new-code
 * condition. Neither config can see the other, and a drift between them fails
 * nothing locally:
 *
 * - a carve-out made only in vitest.config.ts leaves a file out of the report,
 *   which Sonar counts as **0% covered**, not as unknown — and the next PR that
 *   touches that file owes coverage nobody can add;
 * - a report written anywhere but where Sonar looks is no report at all: the
 *   gate's coverage condition silently stops being evaluated, which is the
 *   state Automatic Analysis kept it in until 2026-10-23.
 */

/** `sonar-project.properties` as the scanner reads it: `key=value`, `#` comments. */
const sonar = new Map(
  readFileSync('sonar-project.properties', 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const eq = line.indexOf('=');
      return [line.slice(0, eq), line.slice(eq + 1)] as const;
    }),
);
const list = (key: string): string[] => (sonar.get(key) ?? '').split(',').filter((s) => s !== '');

const coverage = config.test?.coverage ?? {};
const reporters = [coverage.reporter ?? []]
  .flat()
  .map((r) => (Array.isArray(r) ? (r as unknown[])[0] : r));

/**
 * In `sonar.sources` but never in the report — build and CI tooling, which no
 * unit test imports. Unlisted, Sonar would count them as 0% covered.
 */
const OUTSIDE_THE_REPORT = ['scripts/**', 'astro.config.mjs'];

/** `src/**\/*.ts` → `src`; a file names itself. */
const root = (glob: string): string => glob.split('/')[0] ?? glob;

describe('Sonar reads the report Vitest writes', () => {
  it('points sonar.javascript.lcov.reportPaths at the LCOV file the run produces', () => {
    expect(reporters).toContain('lcovonly');
    expect(list('sonar.javascript.lcov.reportPaths')).toEqual([
      `${coverage.reportsDirectory}/lcov.info`,
    ]);
  });
});

describe('a carve-out made in one file is made in the other', () => {
  it('excludes from Sonar exactly what the report leaves out', () => {
    // Declarations hold no code, so Sonar has nothing to count for them.
    const leftOut = (coverage.exclude ?? []).filter((glob) => glob !== '**/*.d.ts');
    expect(new Set(list('sonar.coverage.exclusions'))).toEqual(
      new Set([...leftOut, ...OUTSIDE_THE_REPORT]),
    );
  });

  it('measures every root Sonar analyses, unless it is named above', () => {
    const sources = list('sonar.sources');
    for (const glob of [...(coverage.include ?? []), ...OUTSIDE_THE_REPORT]) {
      expect(sources).toContain(root(glob));
    }
  });
});
