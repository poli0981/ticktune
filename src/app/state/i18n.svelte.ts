import i18next from 'i18next';
import en from '../i18n/en.json';
import vi from '../i18n/vi.json';
import type { TtLang } from './tt-settings-schema';

/**
 * The runtime dictionary — docs/08 §2.
 *
 * ## Why a store wraps i18next at all
 *
 * `i18next.t` is a plain function with no notion of Svelte reactivity, so a
 * component calling it directly would render the right string once and then
 * never again — a language toggle would appear to do nothing until the next
 * unrelated re-render. `t()` here reads `#lang` first, and that read is what
 * makes every caller a subscriber. docs/08 §2 requires the switch to be instant
 * and reload-free; this is the whole mechanism behind that sentence.
 *
 * ## Bundled, not fetched
 *
 * `docs/08 §2`: "resources bundled from `src/app/i18n/{en,vi}.json` (no HTTP
 * backend, no language detector — explicit toggle only)". Two small JSON files
 * imported at build time, so there is no request to fail, no flash of keys, and
 * nothing for hard invariant 1 to worry about. The detector is omitted on
 * purpose: `initialLang` (`tt-settings-schema.ts`) already implements §2's rule
 * — stored setting first, then `navigator.language`, then EN — and two
 * mechanisms deciding the same thing is how they come to disagree.
 */

/**
 * The shape both dictionaries share. EN is the reference.
 *
 * Not exported: `TtKey` is the only thing callers need, and knip fails the build
 * on an unused export (docs/12 §5) — the same rule that keeps the settings
 * unions private until a component names them.
 */
type TtDict = typeof en;

/**
 * Initialised at MODULE LOAD, not on `start()`.
 *
 * `i18next.t` returns the key itself before `init` has run, so any render that
 * beat the boot sequence would paint `setup.start` at the user. Doing it here
 * removes the window entirely: importing the store is enough to make `t()`
 * answer, and `start()` is left with the one job only the app can do — saying
 * which language `settings.load()` decided on.
 *
 * It also means a component test needs no i18n setup at all. That is a
 * consequence rather than the reason, but it is the kind of consequence worth
 * noticing: a design that needs a test harness to hold it upright usually needs
 * the app to hold it upright too.
 *
 * VI is the starting language because `docs/08` opens with "Vietnamese is the
 * default"; `start()` corrects it a moment later if the stored setting differs.
 */
void i18next.init({
  lng: 'vi',
  // EN, not VI. The UI default is Vietnamese, but the FALLBACK is the reference
  // dictionary — `TtKey` is derived from `en.json`, so EN is the only file
  // guaranteed to hold every key (docs/08 §2.1).
  fallbackLng: 'en',
  resources: { en: { translation: en }, vi: { translation: vi } },
  // docs/08 §2.1, and NOT a hardening opportunity: Svelte already escapes every
  // interpolation and `{@html}` is banned outright, so i18next's default would
  // escape a second time and turn a track called "Bird & Boy" into
  // "Bird &amp;amp; Boy". Every interpolated value here is user-supplied text.
  interpolation: { escapeValue: false },
  returnNull: false,
});

class I18nStore {
  /**
   * The active language.
   *
   * `$state`, and read by `t()` on every call: that is not a redundant read,
   * it is the subscription. Removing it makes the toggle silently inert.
   */
  #lang = $state<TtLang>('vi');

  get lang(): TtLang {
    return this.#lang;
  }

  /**
   * The BCP-47 tag for `Intl` — docs/08 §3.
   *
   * "Numbers/dates/durations: `Intl.NumberFormat`/`Intl.DateTimeFormat` with the
   * active locale". Two call sites hardcoded `'vi-VN'` until 2026-07-23, so a
   * user on EN got Vietnamese date formatting.
   *
   * `en-GB` rather than `en-US`, for one reason: it is 24-hour. The Finished
   * screen prints a clock time next to a DSEG7 countdown whose formats are
   * 24-hour by definition (`04 §4`), and an AM/PM reading beside it would be the
   * only 12-hour number on the screen.
   */
  get locale(): string {
    return this.#lang === 'vi' ? 'vi-VN' : 'en-GB';
  }

  /**
   * Adopt the language `settings.load()` resolved — the app shell's one call.
   *
   * Separate from `setLang` because this is boot, not a user action: it sets the
   * document language even when the value has not changed, which `setLang`
   * deliberately skips.
   */
  start(lang: TtLang): void {
    if (lang !== this.#lang) void i18next.changeLanguage(lang);
    this.#lang = lang;
    this.#applyDocumentLang();
  }

  /**
   * Switch language — docs/08 §2: instant, no reload, persisted by the caller.
   *
   * Persistence is deliberately NOT done here. `settings` owns Dexie and this
   * store owns the runtime; a store that wrote both would make the language the
   * one setting with two sources of truth.
   */
  setLang(lang: TtLang): void {
    if (lang === this.#lang) return;
    void i18next.changeLanguage(lang);
    this.#lang = lang;
    this.#applyDocumentLang();
  }

  /**
   * Look up a key.
   *
   * @param key a stable id such as `setup.start` — never an English sentence
   *   (docs/08 §3). Typed against the EN dictionary, so a typo is a build error
   *   rather than a string that renders as its own key.
   */
  t(key: TtKey, vars?: Record<string, string | number>): string {
    // The reactive read. See the class note — this line is the subscription.
    void this.#lang;
    return i18next.t(key, vars ?? {});
  }

  /**
   * Is there an entry for this key?
   *
   * For the one lookup that cannot be a literal: the import toast addresses
   * `toast.import.<log code>`, and the code comes from the pipeline at runtime.
   * Asking first is what keeps an unregistered code falling back to a sentence
   * rather than rendering its own key at the user (`01 §2` principle 5).
   *
   * Takes `string`, not `TtKey`, because a caller that already had a `TtKey`
   * would not need to ask.
   */
  has(key: string): boolean {
    void this.#lang;
    return i18next.exists(key);
  }

  /**
   * docs/08 §2 and docs/03 §8 — "Language of parts": screen readers pick a voice
   * from this attribute, so a VI interface announced in an English voice is an
   * accessibility defect rather than a cosmetic one.
   */
  #applyDocumentLang(): void {
    if (typeof document !== 'undefined') document.documentElement.lang = this.#lang;
  }
}

/**
 * Every key in the dictionary, as a union.
 *
 * Flattened from the EN file, which makes EN the reference by construction: a
 * key that exists only in `vi` is not addressable, and a key in neither is a
 * type error at the call site. The CI guard covers the direction types cannot —
 * a key present in EN and *missing* from VI still type-checks.
 */
type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type TtKey = Leaves<TtDict>;

export const i18n = new I18nStore();
