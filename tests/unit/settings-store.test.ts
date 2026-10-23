import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TT_DEFAULT_SETTINGS } from '../../src/app/state/tt-settings-schema';
// Type-only, so these do NOT pin a module instance: each test re-imports the
// stores after `vi.resetModules()` to get its own copy of the singletons.
import type * as LogMod from '../../src/app/engine/log/tt-log';
import type * as SettingsMod from '../../src/app/state/settings.svelte';

/**
 * The settings store — Dexie's one row, docs/02 §3.2.
 *
 * `clampSettings` and `initialLang` decide every value and are tested on their
 * own (`tt-settings-schema.test.ts`). What only this tier can see is what the
 * store does with them, and the defect that defines it was invisible to every
 * unit test that existed: `patch()` handed IndexedDB the runes proxy itself,
 * structured clone threw `DataCloneError` on every write, the catch swallowed
 * it, and settings silently never persisted — while the UI looked right,
 * because the in-memory value had already changed. The legal-gate E2E caught it.
 *
 * Dexie is faked by one in-memory table, and its `put` structured-clones the
 * row exactly as IndexedDB does — which is the whole point: a Proxy fails here
 * the way it failed in the browser.
 */

const rows = new Map<string, Record<string, unknown>>();
const table = {
  get: vi.fn((key: string) => Promise.resolve(rows.get(key))),
  put: vi.fn((row: Record<string, unknown>) => {
    rows.set(String(row['key']), structuredClone(row));
    return Promise.resolve(row['key']);
  }),
  delete: vi.fn((key: string) => {
    rows.delete(key);
    return Promise.resolve();
  }),
};

/** Every `new Dexie(name)` and the schema it declared. */
let opened: { name: string; version: number; stores: Record<string, string> }[];

vi.mock('dexie', () => ({
  default: class {
    settings: unknown;
    readonly #name: string;
    constructor(name: string) {
      this.#name = name;
    }
    version(version: number) {
      return {
        stores: (stores: Record<string, string>) => {
          opened.push({ name: this.#name, version, stores });
          this.settings = table;
        },
      };
    }
  },
}));

let settings: typeof SettingsMod.settings;
let ttLog: typeof LogMod.ttLog;

const warned = (code: string) => ttLog.entries('warn').filter((e) => e.code === code);

beforeEach(async () => {
  vi.resetModules();
  rows.clear();
  opened = [];
  for (const fn of Object.values(table)) fn.mockClear();
  ({ settings } = await import('../../src/app/state/settings.svelte'));
  ({ ttLog } = await import('../../src/app/engine/log/tt-log'));
});

describe('load — the stored row, under the defaults', () => {
  it('opens no database until something asks — boot never waits on it (docs/02 §1)', async () => {
    expect(opened).toHaveLength(0);
    expect(settings.loaded).toBe(false);
    expect(settings.current).toEqual(TT_DEFAULT_SETTINGS);

    await settings.load();
    await settings.patch({ volume: 0.5 });
    expect(opened).toEqual([{ name: 'ticktune', version: 1, stores: { settings: 'key' } }]);
  });

  it('gives a first visit the defaults, in the language its browser asks for', async () => {
    const value = await settings.load('ja-JP');

    expect(settings.loaded).toBe(true);
    expect(value).toEqual({ ...TT_DEFAULT_SETTINGS, lang: 'ja' });
    expect(table.get).toHaveBeenCalledWith('app');
  });

  it('lets the stored row win, and fills the fields an older build never wrote', async () => {
    rows.set('app', { key: 'app', schema: 2, lang: 'en', volume: 0.3, endAction: 'loop' });
    const value = await settings.load('vi-VN');

    // The stored language beats the browser's: it was the user's choice.
    expect(value.lang).toBe('en');
    expect(value.volume).toBe(0.3);
    expect(value.endAction).toBe('loop');
    expect(value.crossfadeMs).toBe(TT_DEFAULT_SETTINGS.crossfadeMs);
    expect(value.finishNotify).toBe(TT_DEFAULT_SETTINGS.finishNotify);
  });

  it('clamps a stored value it would never have written', async () => {
    rows.set('app', { key: 'app', schema: 2, volume: 7, endAction: 'explode' });
    const value = await settings.load();

    expect(value.volume).toBe(1);
    expect(value.endAction).toBe(TT_DEFAULT_SETTINGS.endAction);
  });

  it('falls back to defaults on an unreadable store and still finishes booting', async () => {
    table.get.mockRejectedValueOnce(new Error('InvalidStateError'));
    const value = await settings.load('en-US');

    expect(value).toEqual({ ...TT_DEFAULT_SETTINGS, lang: 'en' });
    expect(settings.loaded).toBe(true);
    expect(warned('TT-SYS-204')).toHaveLength(1);
  });
});

describe('patch — clamped, then persisted as a plain object', () => {
  /*
   * The legal gate's Accept, as it really writes. A flat patch would prove
   * nothing: spreading the proxy copies its top level into a plain object, and
   * only a NESTED value — this one, or `gradientCustom` — is still a proxy when
   * IndexedDB clones the row. That is why the gate's E2E was the test that
   * caught it.
   */
  it('persists a row IndexedDB can clone — never the runes proxy', async () => {
    await settings.load();
    await settings.patch({
      legalAccepted: { version: '2.0', acceptedAt: 1_760_000_000_000 },
      gradientCustom: ['#112233', '#445566'],
    });

    expect(warned('TT-SYS-204')).toHaveLength(0);
    // A JSON round trip is this file's snapshot: runes only compile in .svelte(.ts).
    expect(rows.get('app')).toEqual({
      key: 'app',
      ...JSON.parse(JSON.stringify(settings.current)),
    });
    expect(rows.get('app')).toMatchObject({
      legalAccepted: { version: '2.0', acceptedAt: 1_760_000_000_000 },
      gradientCustom: ['#112233', '#445566'],
    });
  });

  it('writes the whole object, so the next load reads back what the user saw', async () => {
    await settings.load('en');
    await settings.patch({ crossfadeMs: 4_000 });
    vi.resetModules();
    const fresh = (await import('../../src/app/state/settings.svelte')).settings;

    expect(await fresh.load('vi')).toEqual({
      ...TT_DEFAULT_SETTINGS,
      lang: 'en',
      crossfadeMs: 4_000,
    });
  });

  it('clamps an invalid patch before it lands — in memory and on disk', async () => {
    await settings.load();
    await settings.patch({ volume: -3 });

    expect(settings.current.volume).toBe(0);
    expect(rows.get('app')?.['volume']).toBe(0);
  });

  it('keeps a failed write in memory and says so', async () => {
    await settings.load();
    table.put.mockRejectedValueOnce(new Error('QuotaExceededError'));
    await settings.patch({ volume: 0.2 });

    expect(settings.current.volume).toBe(0.2);
    expect(rows.has('app')).toBe(false);
    expect(warned('TT-SYS-204')).toHaveLength(1);
  });
});

describe('reset — a first-time visitor again (docs/03 §6)', () => {
  it('decides the language the way a first visit does, not from the defaults', async () => {
    await settings.load();
    await settings.patch({ lang: 'ja', volume: 0.1 });
    await settings.reset('en-GB');

    // The default is 'vi'. An English browser used to see Vietnamese here, and
    // English only after a reload.
    expect(settings.current).toEqual({ ...TT_DEFAULT_SETTINGS, lang: 'en' });
    expect(table.delete).toHaveBeenCalledWith('app');
    expect(rows.has('app')).toBe(false);
  });

  it('resets in memory even when the row cannot be deleted', async () => {
    await settings.load();
    await settings.patch({ volume: 0.1 });
    table.delete.mockRejectedValueOnce(new Error('InvalidStateError'));
    await settings.reset('vi-VN');

    expect(settings.current).toEqual(TT_DEFAULT_SETTINGS);
    expect(warned('TT-SYS-204')).toHaveLength(1);
  });
});
