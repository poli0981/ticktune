import { describe, expect, it } from 'vitest';
import {
  TT_DROP_MAX_ENTRIES,
  applyEntryCap,
  orderEntries,
} from '../../src/app/engine/importer/tt-drop-order';
import type { TtDropNode } from '../../src/app/engine/importer/tt-drop-order';

/** docs/02 §4 step 0 — the decisions, extracted out of the driver. */

const f = (name: string): File => new File([new Uint8Array(1)], name);
const node = (name: string, children?: TtDropNode[]): TtDropNode =>
  children ? { name, children } : { name, file: f(name) };

describe('orderEntries', () => {
  it('is deterministic regardless of the order the OS handed entries over', () => {
    // A drop is inherently unordered, and in Single mode the pipeline keeps the
    // FIRST accepted file — so without a stable rule, dropping the same folder
    // twice could import a different track each time.
    const a = orderEntries([node('c.mp3'), node('a.mp3'), node('b.mp3')]);
    const b = orderEntries([node('b.mp3'), node('c.mp3'), node('a.mp3')]);
    expect(a.map((x) => x.name)).toEqual(['a.mp3', 'b.mp3', 'c.mp3']);
    expect(b.map((x) => x.name)).toEqual(a.map((x) => x.name));
  });

  it('sorts numerically, so track2 precedes track10', () => {
    const out = orderEntries([node('track10.mp3'), node('track2.mp3'), node('track1.mp3')]);
    expect(out.map((x) => x.name)).toEqual(['track1.mp3', 'track2.mp3', 'track10.mp3']);
  });

  it('walks directories depth-first', () => {
    const tree = [
      node('B-album', [node('02.mp3'), node('01.mp3')]),
      node('A-album', [node('01.mp3')]),
      node('loose.mp3'),
    ];
    // A-album's contents, then B-album's, then the loose file — 'A' < 'B' < 'l'.
    expect(orderEntries(tree).map((x) => x.name)).toEqual([
      '01.mp3',
      '01.mp3',
      '02.mp3',
      'loose.mp3',
    ]);
  });

  it('handles nesting and empty directories', () => {
    const tree = [node('outer', [node('inner', [node('deep.mp3')]), node('empty', [])])];
    expect(orderEntries(tree).map((x) => x.name)).toEqual(['deep.mp3']);
    expect(orderEntries([])).toEqual([]);
  });
});

describe('applyEntryCap', () => {
  it('passes a normal drop through untouched', () => {
    const files = [f('a.mp3'), f('b.mp3')];
    const r = applyEntryCap(files);
    expect(r.files).toHaveLength(2);
    expect(r.dropped).toBe(0);
  });

  it('caps at 500 and reports how many it dropped', () => {
    // The cap bounds the SCAN, before any per-file work — dropping a music
    // library must not spend minutes walking to import at most 95 tracks.
    const files = Array.from({ length: 640 }, (_, i) => f(`t${i}.mp3`));
    const r = applyEntryCap(files);

    expect(TT_DROP_MAX_ENTRIES).toBe(500);
    expect(r.files).toHaveLength(500);
    expect(r.dropped).toBe(140); // → TT-IMP-008
  });

  it('keeps the first N, so the ordering rule decides which survive', () => {
    const files = Array.from({ length: TT_DROP_MAX_ENTRIES + 1 }, (_, i) => f(`t${i}.mp3`));
    const r = applyEntryCap(files);
    expect(r.files[0]?.name).toBe('t0.mp3');
    expect(r.files.at(-1)?.name).toBe(`t${TT_DROP_MAX_ENTRIES - 1}.mp3`);
  });

  it('does not mutate its input', () => {
    const files = [f('a.mp3')];
    applyEntryCap(files).files.push(f('b.mp3'));
    expect(files).toHaveLength(1);
  });
});
