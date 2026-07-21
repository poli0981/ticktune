import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TT_GATE, ttIsBlocked } from '../../src/lib/tt-gate-const';

/**
 * The mobile gate exists twice on purpose: once as TT_GATE/ttIsBlocked() (the
 * source of truth) and once hand-inlined into TtBase.astro's `is:inline` head
 * script, because it must run before the parser reaches any module script
 * (docs/07 §2, §3.1) and therefore cannot import anything.
 *
 * Duplication that must not drift is a bug waiting to happen, so this suite
 * extracts the real inline script from the layout and proves the two agree on
 * every interesting viewport — rather than trusting a "keep these in sync"
 * comment. Hard invariant 6 depends on it.
 */

// Resolved from the project root: under happy-dom, import.meta.url is not a
// file: URL, so new URL(..., import.meta.url) cannot be used here.
const LAYOUT = readFileSync(resolve(process.cwd(), 'src/layouts/TtBase.astro'), 'utf8');

function extractInlineGate(): string {
  const m = LAYOUT.match(/<script is:inline>([\s\S]*?)<\/script>/);
  if (!m?.[1]) throw new Error('No is:inline gate script found in TtBase.astro');
  return m[1];
}

/** Runs the extracted script against fake globals and reports whether it blocked. */
function runInlineGate(innerWidth: number, coarse: boolean, hover: boolean): boolean {
  const documentElement = { dataset: {} as Record<string, string> };
  const matchMedia = (q: string) => ({
    matches: q.includes('pointer: coarse') ? coarse : q.includes('hover: hover') ? hover : false,
  });
  const fn = new Function('window', 'matchMedia', 'document', extractInlineGate());
  fn({ innerWidth, matchMedia }, matchMedia, { documentElement });
  return documentElement.dataset['ttBlocked'] === '1';
}

function fakeWindow(innerWidth: number, coarse: boolean, hover: boolean): Window {
  return {
    innerWidth,
    matchMedia: (q: string) => ({
      matches: q.includes('pointer: coarse') ? coarse : q.includes('hover: hover') ? hover : false,
    }),
  } as unknown as Window;
}

const CASES: Array<{ name: string; w: number; coarse: boolean; hover: boolean; blocked: boolean }> =
  [
    { name: 'desktop 1440 with mouse', w: 1440, coarse: false, hover: true, blocked: false },
    { name: 'exactly at minWidth', w: 1024, coarse: false, hover: true, blocked: false },
    { name: 'one px below minWidth', w: 1023, coarse: false, hover: true, blocked: true },
    { name: 'phone 412', w: 412, coarse: true, hover: false, blocked: true },
    { name: 'landscape tablet, touch only', w: 1280, coarse: true, hover: false, blocked: true },
    // A touch-screen laptop reports hover — docs/07 §2 says allow it.
    { name: 'touch laptop (coarse + hover)', w: 1440, coarse: true, hover: true, blocked: false },
    { name: 'narrow desktop window', w: 900, coarse: false, hover: true, blocked: true },
  ];

describe('ttIsBlocked()', () => {
  it.each(CASES)('$name → blocked=$blocked', ({ w, coarse, hover, blocked }) => {
    expect(ttIsBlocked(fakeWindow(w, coarse, hover))).toBe(blocked);
  });
});

describe('the inline gate in TtBase.astro', () => {
  it('hardcodes the same minWidth as TT_GATE', () => {
    expect(extractInlineGate()).toContain(String(TT_GATE.minWidth));
  });

  it('tests the coarse-and-not-hover clause while blockCoarseOnly is set', () => {
    const src = extractInlineGate();
    expect(TT_GATE.blockCoarseOnly).toBe(true);
    expect(src).toContain('pointer: coarse');
    expect(src).toContain('hover: hover');
  });

  it.each(CASES)('agrees with ttIsBlocked() — $name', ({ w, coarse, hover, blocked }) => {
    expect(runInlineGate(w, coarse, hover)).toBe(blocked);
  });

  it('sets data-tt-blocked only when blocking', () => {
    expect(runInlineGate(400, true, false)).toBe(true);
    expect(runInlineGate(1920, false, true)).toBe(false);
  });
});
