import Dexie, { type Table } from 'dexie';
import { ttLog } from '../engine/log/tt-log';
import {
  TT_DEFAULT_SETTINGS,
  clampSettings,
  initialLang,
  type TtSettings,
} from './tt-settings-schema';

/**
 * Persisted settings — docs/02 §3.2.
 *
 * One row, primary key `'app'`. A keyed store rather than a free key/value table
 * so a read is a single `get('app')` and the whole object is typed: no per-key
 * parsing, no partial-write races.
 *
 * **Additive-only for v1.x.** New fields get a default in TT_DEFAULT_SETTINGS
 * and the read path spreads defaults under the stored row, so a row written by
 * an older build gains them without a Dexie version bump. `version(2)` is only
 * needed to rename, remove or retype a field.
 */

interface SettingsRow extends TtSettings {
  key: 'app';
}

class TtDb extends Dexie {
  settings!: Table<SettingsRow, string>;
  constructor() {
    super('ticktune');
    this.version(1).stores({ settings: 'key' });
  }
}

const ROW_KEY = 'app';

class SettingsStore {
  #value = $state<TtSettings>({ ...TT_DEFAULT_SETTINGS });
  #loaded = $state(false);
  #db: TtDb | null = null;

  get current(): TtSettings {
    return this.#value;
  }

  /** False until the first read resolves; boot must not wait on it (docs/02 §1). */
  get loaded(): boolean {
    return this.#loaded;
  }

  #database(): TtDb {
    this.#db ??= new TtDb();
    return this.#db;
  }

  /**
   * Never throws and never blocks boot. A corrupt, unreadable or
   * private-mode-blocked store falls back to defaults and logs TT-SYS-204 —
   * docs/02 §1 requires `boot` to always reach `gate` or `setup`.
   */
  async load(navigatorLanguage?: string): Promise<TtSettings> {
    try {
      const row = await this.#database().settings.get(ROW_KEY);
      // Defaults first, stored row second: that spread IS the upgrade policy.
      this.#value = clampSettings({ ...TT_DEFAULT_SETTINGS, ...(row ?? {}) });
      if (!row) {
        this.#value.lang = initialLang(null, navigatorLanguage);
      }
    } catch {
      this.#value = { ...TT_DEFAULT_SETTINGS, lang: initialLang(null, navigatorLanguage) };
      ttLog.warn('TT-SYS-204', 'settings unreadable, defaults applied');
      // Deliberately not rethrown: settings are a preference, not a precondition.
    }
    this.#loaded = true;
    return this.#value;
  }

  /** Patch + persist. Clamped again on write so an invalid patch cannot land. */
  async patch(partial: Partial<TtSettings>): Promise<void> {
    this.#value = clampSettings({ ...this.#value, ...partial });
    try {
      // $state.snapshot is required, not stylistic: `#value` is a Svelte runes
      // proxy, IndexedDB persists via structured clone, and structured clone
      // throws DataCloneError on a Proxy. Without it every write rejected, the
      // catch below swallowed it, and settings silently never persisted — the
      // UI looked correct because the in-memory value had already updated.
      // Caught by the legal-gate E2E, not by any unit test.
      await this.#database().settings.put({ key: ROW_KEY, ...$state.snapshot(this.#value) });
    } catch {
      ttLog.warn('TT-SYS-204', 'settings write failed, kept in memory');
    }
  }

  /** Settings → General → "reset app" (docs/03 §6). */
  async reset(): Promise<void> {
    this.#value = { ...TT_DEFAULT_SETTINGS };
    try {
      await this.#database().settings.delete(ROW_KEY);
    } catch {
      ttLog.warn('TT-SYS-204', 'settings reset failed');
    }
  }
}

export const settings = new SettingsStore();
