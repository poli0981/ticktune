import { describe, it, expect } from 'vitest';
import {
  TT_DEFAULT_SETTINGS,
  clampSettings,
  initialLang,
} from '../../src/app/state/tt-settings-schema';

/**
 * docs/02 §3.1. Clamping runs on read as well as write, because IndexedDB is
 * user-editable and survives across builds — so these cases are not theoretical.
 */

describe('defaults', () => {
  it('match the values docs/02 §3.1 fixes', () => {
    expect(TT_DEFAULT_SETTINGS).toMatchObject({
      lang: 'vi',
      lastMode: 'playlist',
      legalAccepted: null,
      endFadeMs: 2_000,
      endChime: true,
      endAction: 'stay',
      crossfadeMs: 2_000,
      repeatPlaylist: true,
      allowDuplicates: false,
      autoTheme: true,
      singleLoopStyle: 'hard',
      volume: 0.8,
      visualizer: 'ring',
    });
  });

  it('survive a round trip unchanged', () => {
    expect(clampSettings(TT_DEFAULT_SETTINGS)).toEqual(TT_DEFAULT_SETTINGS);
  });
});

describe('clamping garbage', () => {
  it('falls back wholesale for a non-object', () => {
    expect(clampSettings(null)).toEqual(TT_DEFAULT_SETTINGS);
    expect(clampSettings('nope')).toEqual(TT_DEFAULT_SETTINGS);
    expect(clampSettings(42)).toEqual(TT_DEFAULT_SETTINGS);
  });

  it('clamps numbers into their documented ranges', () => {
    const s = clampSettings({
      volume: 99,
      glowIntensity: -5,
      endFadeMs: 999_999,
      crossfadeMs: -1,
      scrimStrength: 1,
      slideshowIntervalMs: 1,
      visualizerSensitivity: 50,
    });
    expect(s.volume).toBe(1);
    expect(s.glowIntensity).toBe(0);
    expect(s.endFadeMs).toBe(5_000);
    expect(s.crossfadeMs).toBe(0);
    expect(s.scrimStrength).toBe(0.6);
    expect(s.slideshowIntervalMs).toBe(5_000);
    expect(s.visualizerSensitivity).toBe(2);
  });

  it('rejects NaN and Infinity rather than storing them', () => {
    const s = clampSettings({ volume: NaN, endFadeMs: Infinity });
    expect(s.volume).toBe(TT_DEFAULT_SETTINGS.volume);
    expect(s.endFadeMs).toBe(TT_DEFAULT_SETTINGS.endFadeMs);
  });

  it('falls back on out-of-set enum values', () => {
    const s = clampSettings({ lang: 'de', endAction: 'explode', visualizer: 'lasers' });
    expect(s.lang).toBe('vi');
    expect(s.endAction).toBe('stay');
    expect(s.visualizer).toBe('ring');
  });

  it('drops unknown fields instead of persisting them', () => {
    const s = clampSettings({ volume: 0.5, somethingElse: 'x' }) as unknown as Record<
      string,
      unknown
    >;
    expect(s['somethingElse']).toBeUndefined();
    expect(s['volume']).toBe(0.5);
  });

  it('always reports the current schema version', () => {
    expect(clampSettings({ schema: 99 }).schema).toBe(1);
  });
});

describe('legalAccepted', () => {
  it('keeps a well-formed record', () => {
    const s = clampSettings({ legalAccepted: { version: '1.0-draft', acceptedAt: 123 } });
    expect(s.legalAccepted).toEqual({ version: '1.0-draft', acceptedAt: 123 });
  });

  it('rejects a malformed one — a bad record must re-show the gate, not skip it', () => {
    expect(clampSettings({ legalAccepted: { version: '1.0' } }).legalAccepted).toBeNull();
    expect(clampSettings({ legalAccepted: 'yes' }).legalAccepted).toBeNull();
    expect(clampSettings({ legalAccepted: { acceptedAt: 1 } }).legalAccepted).toBeNull();
  });
});

describe('gradientCustom', () => {
  it('accepts a pair of #rrggbb', () => {
    expect(clampSettings({ gradientCustom: ['#0a0b0c', '#FFFFFF'] }).gradientCustom).toEqual([
      '#0a0b0c',
      '#FFFFFF',
    ]);
  });

  it('rejects anything else — it goes straight into CSS', () => {
    for (const bad of [['red', 'blue'], ['#fff'], ['#0a0b0c'], 'x', ['#0a0b0c', 'javascript:1']]) {
      expect(clampSettings({ gradientCustom: bad }).gradientCustom).toBeNull();
    }
  });
});

describe('additive-only upgrade (docs/02 §3.2)', () => {
  it('an old row missing new fields gains their defaults', () => {
    const oldRow = { schema: 1, lang: 'en', volume: 0.3 };
    const s = clampSettings({ ...TT_DEFAULT_SETTINGS, ...oldRow });
    expect(s.lang).toBe('en');
    expect(s.volume).toBe(0.3);
    expect(s.endAction).toBe('stay');
    expect(s.visualizerSensitivity).toBe(1.0);
  });
});

describe('initialLang (docs/08 §2)', () => {
  it('prefers the stored choice over the browser', () => {
    expect(initialLang('en', 'vi-VN')).toBe('en');
    expect(initialLang('vi', 'en-US')).toBe('vi');
  });

  it('falls back to VI only for a vi* browser locale', () => {
    expect(initialLang(null, 'vi')).toBe('vi');
    expect(initialLang(null, 'vi-VN')).toBe('vi');
    expect(initialLang(null, 'VI-vn')).toBe('vi');
    expect(initialLang(null, 'en-US')).toBe('en');
    expect(initialLang(null, undefined)).toBe('en');
  });
});
