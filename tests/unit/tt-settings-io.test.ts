import { describe, expect, it } from 'vitest';
import {
  exportSettings,
  importSettings,
  settingsFileName,
} from '../../src/app/state/tt-settings-io';
import { TT_DEFAULT_SETTINGS, type TtSettings } from '../../src/app/state/tt-settings-schema';

/** docs/02 §3.4 — a preset is settings and nothing else, and comes back clamped. */

const accepted = { version: '1.1', acceptedAt: 1_700_000_000_000 };
const mine: TtSettings = {
  ...TT_DEFAULT_SETTINGS,
  lang: 'en',
  legalAccepted: accepted,
  scanlines: false,
  countdownSize: 'l',
  volume: 0.3,
};
const NOW = new Date(2026, 9, 20, 23, 5);

describe('export', () => {
  it('names the file by the local date', () => {
    expect(settingsFileName(NOW)).toBe('ticktune-settings-20261020.json');
  });

  it('says what it is, and carries every setting but the legal acceptance', () => {
    const file = JSON.parse(exportSettings(mine, NOW)) as Record<string, unknown>;
    expect(file['app']).toBe('ticktune');
    expect(file['kind']).toBe('settings');
    expect(file['schema']).toBe(TT_DEFAULT_SETTINGS.schema);
    expect(file['exportedAt']).toBe(NOW.toISOString());
    const s = file['settings'] as Record<string, unknown>;
    expect(s).not.toHaveProperty('legalAccepted');
    expect(s).not.toHaveProperty('schema');
    expect(s['scanlines']).toBe(false);
    expect(s['countdownSize']).toBe('l');
    // Every other field travels: the preset is the whole panel.
    const expected = Object.keys(TT_DEFAULT_SETTINGS).filter(
      (k) => k !== 'legalAccepted' && k !== 'schema',
    );
    expect(Object.keys(s).sort()).toEqual(expected.sort());
  });
});

describe('import', () => {
  const fresh: TtSettings = { ...TT_DEFAULT_SETTINGS, legalAccepted: accepted };

  it('round-trips an export', () => {
    const r = importSettings(exportSettings(mine, NOW), fresh);
    expect(r).toEqual({ ok: true, settings: mine });
  });

  it('keeps THIS user’s legal acceptance, whatever the file says', () => {
    const foreign = JSON.stringify({
      app: 'ticktune',
      kind: 'settings',
      schema: 2,
      settings: { legalAccepted: { version: '9.9', acceptedAt: 1 } },
    });
    const r = importSettings(foreign, fresh);
    expect(r.ok && r.settings.legalAccepted).toEqual(accepted);

    const none = { ...TT_DEFAULT_SETTINGS, legalAccepted: null };
    const r2 = importSettings(foreign, none);
    expect(r2.ok && r2.settings.legalAccepted).toBeNull();
  });

  it('clamps a hand-edited preset like a stored row', () => {
    const edited = JSON.stringify({
      app: 'ticktune',
      kind: 'settings',
      schema: 2,
      settings: { volume: 7, countdownSize: 'xxl', endFadeMs: -5, unknownField: 'dropped' },
    });
    const r = importSettings(edited, fresh);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.settings.volume).toBe(1);
    expect(r.settings.countdownSize).toBe(TT_DEFAULT_SETTINGS.countdownSize);
    expect(r.settings.endFadeMs).toBe(0);
    expect(r.settings).not.toHaveProperty('unknownField');
  });

  it('migrates a preset from before schema 2 like a row would be', () => {
    const old = JSON.stringify({
      app: 'ticktune',
      kind: 'settings',
      schema: 1,
      settings: { visualizer: 'ring' },
    });
    const r = importSettings(old, fresh);
    expect(r.ok && r.settings.visualizer).toBe('off');
  });

  it.each([
    ['not JSON at all', 'hello', 'unreadable'],
    ['JSON, not ours', '{"name":"something else"}', 'not-ours'],
    ['our app, another kind', '{"app":"ticktune","kind":"queue","settings":{}}', 'not-ours'],
    ['no settings object', '{"app":"ticktune","kind":"settings","settings":null}', 'not-ours'],
    ['a bare array', '[1,2,3]', 'not-ours'],
    ['null', 'null', 'not-ours'],
  ])('refuses %s', (_, text, reason) => {
    expect(importSettings(text, fresh)).toEqual({ ok: false, reason });
  });
});
