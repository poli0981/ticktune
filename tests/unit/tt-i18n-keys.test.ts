import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../src/app/i18n/en.json';
import vi from '../../src/app/i18n/vi.json';

/**
 * The key-diff guard — docs/08 §3, docs/13 §1.
 *
 * `08 §3`: "CI guard: a Vitest test diffs key sets of `en.json` vs `vi.json` —
 * any missing/extra key fails the build". `13 §1` files the same row as "from
 * P5, when the dictionaries exist".
 *
 * It exists because the failure it guards is **silent**. i18next falls back to
 * the reference language for a missing key, so a VI dictionary that quietly
 * lost a string renders perfect English inside a Vietnamese interface and no
 * test that asserts "some text appeared" can tell. The build is the only place
 * that can notice.
 *
 * Both directions are checked, and they are not the same failure: a key missing
 * from `vi` is an untranslated string, and a key only in `vi` is a string
 * nothing can ever render — the second is the one a type system cannot catch,
 * because `TtKey` is derived from EN.
 */

type Json = { [k: string]: string | Json };

/** `{ a: { b: 'x' } }` → `['a.b']`. Sorted, so a diff reads in order. */
function flatten(node: Json, prefix = ''): string[] {
  return Object.entries(node)
    .flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`)))
    .sort();
}

const enKeys = flatten(en as Json);
const viKeys = flatten(vi as Json);

describe('en.json and vi.json describe the same interface', () => {
  it('has no key missing from vi — those render as English inside a VI UI', () => {
    expect(enKeys.filter((k) => !viKeys.includes(k))).toEqual([]);
  });

  it('has no key missing from en — those are unreachable and untypeable', () => {
    // `TtKey` is derived from the EN dictionary, so a vi-only key cannot be
    // addressed from a call site at all. It is dead weight that reads as work.
    expect(viKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  it('is non-empty, so an empty pair cannot pass by having nothing to differ', () => {
    // The degenerate green: two empty files agree perfectly.
    expect(enKeys.length).toBeGreaterThan(50);
  });
});

describe('the values themselves', () => {
  it('leaves no empty string — a blank renders as a gap nobody can report', () => {
    for (const dict of [en, vi] as Json[]) {
      for (const key of flatten(dict)) {
        expect(valueAt(dict, key), key).not.toBe('');
      }
    }
  });

  it('uses the same interpolation placeholders in both languages', () => {
    /*
     * The failure this catches: a translator renaming `{{count}}` to `{{số}}`,
     * or dropping it. i18next silently leaves an unknown placeholder in the
     * output, so the user sees a literal `{{count}}` on screen — and every test
     * that checks "the string contains the word tracks" still passes.
     */
    for (const key of enKeys) {
      expect(placeholders(valueAt(en as Json, key)), key).toEqual(
        placeholders(valueAt(vi as Json, key)),
      );
    }
  });

  it('has no key whose VI and EN text are identical by accident', () => {
    /*
     * Not a hard rule — some strings are genuinely the same in both languages,
     * and those are listed rather than guessed at. What this catches is a
     * dictionary filled by copy-paste, which is how a "translated" file ships
     * with English in it.
     */
    const SAME_ON_PURPOSE = new Set([
      'setup.mode.youtube',
      'player.badge.youtube',
      'player.trackinfo.album',
      'player.trackinfo.codec',
      'player.trackinfo.bitrate',
      'player.trackinfo.url',
      'player.trackinfo.videoId',
      'player.trackinfo.sourceYoutube',
      // Deliberately in the OTHER language on each side: the toggle says what
      // you are switching TO, so it must be legible to someone who cannot read
      // the current one.
      'header.lang.toVi',
      'header.lang.toEn',
      // Pure interpolation plus a symbol.
      'player.loop.count',
    ]);

    const identical = enKeys.filter(
      (k) => !SAME_ON_PURPOSE.has(k) && valueAt(en as Json, k) === valueAt(vi as Json, k),
    );
    expect(identical).toEqual([]);
  });
});

describe('every key has a caller, and every caller has a key', () => {
  /*
   * The gate `knip` structurally cannot provide. `knip.json`'s `project` globs
   * cover `.ts`, `.svelte` and `.astro` — **not `.json`** — so the dictionaries
   * sit outside its file set entirely and an orphan key is invisible to it.
   *
   * That matters here more than it would elsewhere. This project's signature
   * defect is a thing declared and never consumed, and a dictionary is the
   * easiest place in the codebase to create one: a key reads as finished work,
   * costs nothing to add, and renders nowhere. Two were caught by hand while
   * these files were being written (`toast.import.TT-YT-006` and `-007`, which
   * only ever travel through `ttLog` and could never reach a toast).
   *
   * The `t()` call sites are the authority, and they are greppable because
   * docs/08 §3 requires keys to be stable literal ids rather than expressions.
   */
  const SRC = join(process.cwd(), 'src', 'app');

  /**
   * Namespaces whose caller no grep can see. Each prefix needs a reason.
   *
   * Kept as PREFIXES rather than a blanket allow-list: adding
   * `toast.import.` exempts exactly the codes the toast looks up, and leaves
   * every sibling namespace still required to have a literal caller.
   */
  const CALLED_INDIRECTLY_PREFIX = [
    // `TtToast.message()` builds `toast.import.<log code>` from the code the
    // import pipeline returned.
    'toast.import.',
    // `TtTrackInfo` builds `player.trackinfo.<stem>` from the rows
    // `tt-track-display.ts` returns — the engine may not import from state
    // (docs/12 §3.1), so it hands back stems and the component translates.
    // The field ORDER is the contract there, and its own tests assert that
    // every stem it emits has an entry here.
    'player.trackinfo.',
  ];

  /** Keys that exist for a caller no grep can see. Each needs a reason. */
  const CALLED_INDIRECTLY = new Set<string>([
    // Built by concatenating an overlay's `key` stem with `.title` / `.cause`
    // (`tt-yt-player.ts` owns the stems; `TtYouTubeRail` renders them).
    'yt.err.blocked.title',
    'yt.err.blocked.cause',
    'yt.err.gone.title',
    'yt.err.gone.cause',
    'yt.err.invalid.title',
    'yt.err.invalid.cause',
    'yt.err.player.title',
    'yt.err.player.cause',
  ]);

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return e.name === 'i18n' || e.name === 'spike' ? [] : sources(full);
      return /\.(svelte|ts)$/.test(e.name) ? [readFileSync(full, 'utf8')] : [];
    });
  }

  const called = new Set(
    sources(SRC).flatMap((text) =>
      [...text.matchAll(/\.t\(\s*'([a-zA-Z0-9_.-]+)'/g)].map((m) => m[1] ?? ''),
    ),
  );

  it('has no key that nothing renders', () => {
    // Prefixes are how the indirect callers above are expressed, so a whole
    // namespace is not exempted by one entry.
    const orphans = enKeys.filter(
      (k) =>
        !called.has(k) &&
        !CALLED_INDIRECTLY.has(k) &&
        !CALLED_INDIRECTLY_PREFIX.some((p) => k.startsWith(p)),
    );
    expect(orphans).toEqual([]);
  });

  it('finds a dictionary entry for every key a call site names', () => {
    // The direction the type system already covers — asserted anyway, because
    // `TtKey` only constrains literal arguments and this catches a call built
    // some other way before it reaches a user as a raw id.
    expect([...called].filter((k) => !enKeys.includes(k)).sort()).toEqual([]);
  });
});

function valueAt(dict: Json, key: string): string {
  const value = key.split('.').reduce<string | Json | undefined>((node, part) => {
    if (node === undefined || typeof node === 'string') return undefined;
    return node[part];
  }, dict);
  return typeof value === 'string' ? value : '';
}

/** `'Importing {{done}}/{{total}}'` → `['done', 'total']`. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? '').sort();
}
