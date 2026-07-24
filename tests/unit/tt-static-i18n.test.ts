import { describe, expect, it } from 'vitest';
import { en } from '../../src/i18n/static/en';
import { vi } from '../../src/i18n/static/vi';

/**
 * The static dictionaries — docs/08 §1, P6 slice A.
 *
 * ## What this file is NOT for
 *
 * Key parity is **not** tested here, and that is the point of the design:
 * `vi.ts` is annotated `const vi: StaticDict`, so a missing, extra or
 * mis-nested key is a **compile error** under `pnpm check`, in both directions,
 * before any test runs. The island's JSON dictionaries need
 * `tt-i18n-keys.test.ts` for exactly that job because JSON has no such
 * annotation; these are `.ts` and can do better.
 *
 * What the type CANNOT express is everything below: array lengths, empty
 * strings, and text left untranslated. Same division of labour, one level up.
 */

/** Every leaf string in a dictionary, as `path → value`. */
function leaves(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${prefix}[${i}]`));
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}

const enLeaves = leaves(en);
const viLeaves = leaves(vi);

describe('shape the type cannot enforce', () => {
  it('has the same number of array entries in both languages', () => {
    /*
     * `StaticDict` constrains array ELEMENT shape but not length, so a
     * translation that dropped one FAQ entry or one limits row would type-check
     * cleanly and quietly ship a shorter page. Comparing the flattened leaf
     * paths catches it, and names the missing one.
     */
    expect(viLeaves.map(([p]) => p)).toEqual(enLeaves.map(([p]) => p));
  });

  it('leaves no empty string — a blank renders as a gap nobody reports', () => {
    for (const [path, value] of [...enLeaves, ...viLeaves]) {
      expect(value.trim(), path).not.toBe('');
    }
  });
});

describe('the values themselves', () => {
  it('has no VI entry left identical to its English source', () => {
    /*
     * What a copy-paste translation looks like. Listed exceptions rather than a
     * blanket allowance, the same discipline `tt-i18n-keys.test.ts` uses.
     */
    const SAME_ON_PURPOSE = new Set([
      // Mode names that are proper nouns or already the Vietnamese usage.
      'landing.modes[2].name',
      // The language switch says what you are switching TO, so each side is
      // deliberately in the other language.
      'common.switchTo',
      'common.switchToLabel',
      // Ken Burns-style proper nouns would go here; none yet.
    ]);

    const enMap = new Map(enLeaves);
    const identical = viLeaves
      .filter(([path, value]) => !SAME_ON_PURPOSE.has(path) && enMap.get(path) === value)
      .map(([path]) => path);

    expect(identical).toEqual([]);
  });

  it('states the docs/04 §2 item 6 countdown promise in both languages', () => {
    /*
     * The one S2-decision deliverable outside the app. The E2E asserts it
     * reaches the rendered page; this asserts it exists in the SOURCE, so a
     * translation pass that rewrote the FAQ cannot quietly drop it and leave
     * only a rendering test to notice.
     */
    expect(en.faq[0]!.a).toMatch(/accurate while the tab is visible/i);
    expect(en.faq[0]!.a).toMatch(/best-effort/i);
    expect(vi.faq[0]!.a).toMatch(/chính xác khi tab đang hiển thị/);
    expect(vi.faq[0]!.a).toMatch(/tốt nhất có thể/);
  });

  it('keeps the published limits in step with what the app enforces', () => {
    /*
     * docs/02 §1 and CLAUDE.md invariant 4 — "limits are spec, not
     * suggestions". The table is prose in two languages rather than derived
     * from the engine constants (formatting milliseconds into "10:02" on a
     * static page to save six rows is a poor trade), so this is the guard that
     * the prose still names the real numbers.
     */
    const both = [...enLeaves, ...viLeaves].map(([, v]) => v).join(' ');
    for (const figure of ['10:02', '95', '91:00', '50', '24']) {
      expect(both, `limit ${figure} missing from the landing copy`).toContain(figure);
    }
  });
});
