/**
 * Settings export / import — docs/02 §3.4 (v2.0).
 *
 * A preset is the user's settings as a JSON file they keep, and nothing else:
 * never a file, a queue, a link list (D3 — those are session-only) and never
 * `legalAccepted`, which records what THIS machine's user agreed to and cannot
 * travel with a file someone hands over. Pure: the component owns the Blob and
 * the picker, the store owns persistence.
 */
import { clampSettings, type TtSettings } from './tt-settings-schema';

const APP = 'ticktune';
const KIND = 'settings';

interface TtSettingsFile {
  app: typeof APP;
  kind: typeof KIND;
  schema: number;
  exportedAt: string;
  settings: Omit<TtSettings, 'legalAccepted' | 'schema'>;
}

/** `ticktune-settings-YYYYMMDD.json`, by the user's own calendar. */
export function settingsFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `ticktune-settings-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.json`;
}

export function exportSettings(current: TtSettings, now: Date): string {
  const settings = Object.fromEntries(
    Object.entries(current).filter(([k]) => k !== 'legalAccepted' && k !== 'schema'),
  ) as TtSettingsFile['settings'];
  const file: TtSettingsFile = {
    app: APP,
    kind: KIND,
    schema: current.schema,
    exportedAt: now.toISOString(),
    settings,
  };
  return JSON.stringify(file, null, 2);
}

export type TtSettingsImport =
  { ok: true; settings: TtSettings } | { ok: false; reason: 'unreadable' | 'not-ours' };

/**
 * A file back into settings — through `clampSettings`, exactly like a stored
 * row, so a hand-edited preset can no more produce an invalid app than a
 * hand-edited IndexedDB can (docs/02 §3.1). The file's own `schema` goes in with
 * it, so a preset from before a migration is migrated like a row would be.
 * `legalAccepted` is always the current one: importing someone's preset must
 * neither accept the terms for this user nor revoke their acceptance.
 */
export function importSettings(text: string, current: TtSettings): TtSettingsImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const f = (parsed !== null && typeof parsed === 'object' ? parsed : {}) as Record<
    string,
    unknown
  >;
  const settings = f['settings'];
  if (f['app'] !== APP || f['kind'] !== KIND || settings === null || typeof settings !== 'object') {
    return { ok: false, reason: 'not-ours' };
  }
  return {
    ok: true,
    settings: clampSettings({
      ...(settings as Record<string, unknown>),
      schema: typeof f['schema'] === 'number' ? f['schema'] : 0,
      legalAccepted: current.legalAccepted,
    }),
  };
}
