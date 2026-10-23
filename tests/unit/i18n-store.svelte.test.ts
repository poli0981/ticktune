import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '../../src/app/state/i18n.svelte';

/**
 * The runtime dictionary's store — docs/08 §2.
 *
 * `tt-i18n-keys.test.ts` proves the three dictionaries agree; this proves the
 * store in front of them does what the app relies on. Two of these claims are
 * otherwise held up only by comments:
 *
 * - `t()` reading `#lang` IS the subscription. Without it a component renders
 *   the right string once and never again, and the language toggle looks
 *   inert until some unrelated re-render (docs/08 §2: "instant, no reload").
 * - `start()` sets `<html lang>` even when the language has not changed, and
 *   `setLang()` does not. Screen readers choose a voice from that attribute.
 *
 * Named `.svelte.test.ts` so it compiles as a Svelte module: the subscription
 * claim is asserted with a real `$effect`, not inferred. And imported ONCE,
 * statically, unlike the other store suites: `vi.resetModules()` would hand the
 * store a second Svelte runtime, whose signals this file's effects cannot see.
 */

afterEach(() => {
  i18n.start('vi');
});

describe('answering before boot', () => {
  // First in the file on purpose: nothing has called start() yet.
  it('answers at import, in Vietnamese — never the key itself', () => {
    expect(i18n.lang).toBe('vi');
    expect(i18n.t('setup.start')).toBe('Bắt đầu');
  });
});

describe('switching language — instant, no reload (docs/08 §2)', () => {
  it('re-runs whatever read a string when the language changes', () => {
    const seen: string[] = [];
    const stop = $effect.root(() => {
      $effect(() => {
        seen.push(i18n.t('setup.start'));
      });
    });
    flushSync();
    i18n.setLang('en');
    flushSync();
    i18n.setLang('ja');
    flushSync();
    stop();

    expect(seen).toEqual(['Bắt đầu', 'Start', '開始']);
  });

  it('re-runs a `has()` lookup too — the import toast asks before it reads', () => {
    let asks = 0;
    const stop = $effect.root(() => {
      $effect(() => {
        i18n.has('toast.import.TT-IMP-001');
        asks++;
      });
    });
    flushSync();
    i18n.setLang('en');
    flushSync();
    stop();

    expect(asks).toBe(2);
  });

  it('sets <html lang> for screen readers', () => {
    i18n.setLang('ja');
    expect(document.documentElement.lang).toBe('ja');
  });

  it('does nothing for the language already active', () => {
    i18n.setLang('en');
    document.documentElement.lang = 'xx';
    i18n.setLang('en');

    expect(document.documentElement.lang).toBe('xx');
  });
});

describe('start — adopting the language settings.load() decided', () => {
  it('sets <html lang> even when the language has not changed', () => {
    document.documentElement.lang = 'xx';
    i18n.start('vi');

    expect(document.documentElement.lang).toBe('vi');
    expect(i18n.t('setup.start')).toBe('Bắt đầu');
  });

  it('switches the dictionary when the stored language differs', () => {
    i18n.start('en');

    expect(i18n.lang).toBe('en');
    expect(i18n.t('setup.start')).toBe('Start');
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('locale — the tag Intl formats with (docs/08 §3)', () => {
  it('follows the language', () => {
    expect(i18n.locale).toBe('vi-VN');
    i18n.setLang('ja');
    expect(i18n.locale).toBe('ja-JP');
  });

  it('formats English clock times on 24 hours, beside a 24-hour countdown', () => {
    i18n.setLang('en');
    const at = new Date(2026, 9, 23, 18, 5);
    const text = new Intl.DateTimeFormat(i18n.locale, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(at);

    expect(text).toBe('18:05');
  });
});

describe('lookups', () => {
  it('interpolates user text verbatim — Svelte escapes it once, i18next must not again', () => {
    i18n.setLang('en');

    expect(i18n.t('player.queue.remove', { title: 'Bird & Boy <live>' })).toBe(
      'Remove Bird & Boy <live>',
    );
  });

  it('knows a registered log code from an unregistered one', () => {
    expect(i18n.has('toast.import.TT-IMP-001')).toBe(true);
    expect(i18n.has('toast.import.TT-IMP-999')).toBe(false);
  });
});
