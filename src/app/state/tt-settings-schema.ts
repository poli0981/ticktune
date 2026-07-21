/**
 * `TtSettings` — the persisted shape. docs/02 §3.1 is the specification; this is
 * the implementation, and the two must stay in step.
 *
 * Pure data + clamping. No Dexie, no Svelte — so the clamp rules are unit
 * testable without a database or a DOM.
 */

/*
 * `TtMode`, `TtLoopStyle` and `TtEndAction` are declared in
 * `src/lib/tt-domain-types.ts`, not here: the P2 audio and importer engines need
 * to name them, and the engine-purity lint zone forbids an engine importing
 * from state at all, type-only imports included (docs/12 §3.1). Importing them
 * back keeps exactly one definition — the arrays below still own the runtime
 * allow-lists.
 */
import type { TtEndAction, TtLoopStyle, TtMode } from '../../lib/tt-domain-types';

export type TtLang = 'vi' | 'en';

/*
 * The unions below are intentionally NOT exported yet. They are reachable
 * through `TtSettings` by inference, and knip fails the build on unused exports
 * (docs/12 §5) — so each gets exported in the phase whose components actually
 * import it, rather than being exported speculatively now.
 */
type TtBackground = 'solid' | 'gradient' | 'image' | 'slideshow' | 'cover';
type TtSlideXfade = 'fade' | 'kenburns';
type TtSize = 's' | 'm' | 'l';
type TtVisualizer = 'off' | 'bars' | 'wave' | 'ring';

export interface TtSettings {
  readonly schema: 1;

  lang: TtLang;
  lastMode: TtMode;
  legalAccepted: { version: string; acceptedAt: number } | null;

  background: TtBackground;
  gradientPreset: 0 | 1 | 2 | 3 | 4 | 5;
  gradientCustom: [string, string] | null;
  slideshowIntervalMs: number;
  slideshowTransition: TtSlideXfade;
  scrimStrength: number;
  scrimAuto: boolean;
  scanlines: boolean;
  autoTheme: boolean;

  glowIntensity: number;
  countdownSize: TtSize;
  endFadeMs: number;
  endChime: boolean;
  endFlash: boolean;
  endAction: TtEndAction;

  visualizer: TtVisualizer;
  visualizerSensitivity: number;

  volume: number;
  muted: boolean;
  crossfadeMs: number;
  singleLoopStyle: TtLoopStyle;

  shuffle: boolean;
  repeatPlaylist: boolean;
  allowDuplicates: boolean;
}

const TT_SETTINGS_SCHEMA = 1 as const;

export const TT_DEFAULT_SETTINGS: TtSettings = {
  schema: TT_SETTINGS_SCHEMA,
  lang: 'vi',
  lastMode: 'playlist',
  legalAccepted: null,
  background: 'gradient',
  gradientPreset: 0,
  gradientCustom: null,
  slideshowIntervalMs: 10_000,
  slideshowTransition: 'fade',
  scrimStrength: 0.45,
  scrimAuto: true,
  scanlines: true,
  autoTheme: true,
  glowIntensity: 0.8,
  countdownSize: 'm',
  endFadeMs: 2_000,
  endChime: true,
  endFlash: false,
  endAction: 'stay',
  visualizer: 'ring',
  visualizerSensitivity: 1.0,
  volume: 0.8,
  muted: false,
  crossfadeMs: 2_000,
  singleLoopStyle: 'hard',
  shuffle: false,
  repeatPlaylist: true,
  allowDuplicates: false,
};

const LANGS: TtLang[] = ['vi', 'en'];
const MODES: TtMode[] = ['single', 'playlist', 'youtube'];
const BACKGROUNDS: TtBackground[] = ['solid', 'gradient', 'image', 'slideshow', 'cover'];
const XFADES: TtSlideXfade[] = ['fade', 'kenburns'];
const SIZES: TtSize[] = ['s', 'm', 'l'];
const VISUALIZERS: TtVisualizer[] = ['off', 'bars', 'wave', 'ring'];
const LOOPS: TtLoopStyle[] = ['hard', 'crossfade'];
const END_ACTIONS: TtEndAction[] = ['stay', 'restart', 'loop'];

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

const oneOf = <T extends string>(v: unknown, allowed: T[], fallback: T): T =>
  typeof v === 'string' && (allowed as string[]).includes(v) ? (v as T) : fallback;

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Coerce arbitrary stored data into a valid `TtSettings`.
 *
 * Applied on **read as well as write** (docs/02 §3.1): IndexedDB is editable by
 * the user and survives across versions, so a hand-edited or stale row must not
 * be able to produce an invalid app. Unknown fields are dropped; missing ones
 * take their default, which is what makes the additive-only upgrade policy in
 * §3.2 work without a Dexie version bump.
 */
export function clampSettings(raw: unknown): TtSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = TT_DEFAULT_SETTINGS;

  const la = r['legalAccepted'];
  const legalAccepted =
    typeof la === 'object' &&
    la !== null &&
    typeof (la as Record<string, unknown>)['version'] === 'string' &&
    typeof (la as Record<string, unknown>)['acceptedAt'] === 'number'
      ? {
          version: (la as Record<string, unknown>)['version'] as string,
          acceptedAt: (la as Record<string, unknown>)['acceptedAt'] as number,
        }
      : null;

  const gc = r['gradientCustom'];
  const gradientCustom =
    Array.isArray(gc) && gc.length === 2 && gc.every((c) => typeof c === 'string' && HEX.test(c))
      ? ([gc[0], gc[1]] as [string, string])
      : null;

  return {
    schema: TT_SETTINGS_SCHEMA,
    lang: oneOf(r['lang'], LANGS, d.lang),
    lastMode: oneOf(r['lastMode'], MODES, d.lastMode),
    legalAccepted,
    background: oneOf(r['background'], BACKGROUNDS, d.background),
    gradientPreset: num(
      r['gradientPreset'],
      0,
      5,
      d.gradientPreset,
    ) as TtSettings['gradientPreset'],
    gradientCustom,
    slideshowIntervalMs: num(r['slideshowIntervalMs'], 5_000, 60_000, d.slideshowIntervalMs),
    slideshowTransition: oneOf(r['slideshowTransition'], XFADES, d.slideshowTransition),
    scrimStrength: num(r['scrimStrength'], 0.35, 0.6, d.scrimStrength),
    scrimAuto: bool(r['scrimAuto'], d.scrimAuto),
    scanlines: bool(r['scanlines'], d.scanlines),
    autoTheme: bool(r['autoTheme'], d.autoTheme),
    glowIntensity: num(r['glowIntensity'], 0, 1, d.glowIntensity),
    countdownSize: oneOf(r['countdownSize'], SIZES, d.countdownSize),
    endFadeMs: num(r['endFadeMs'], 0, 5_000, d.endFadeMs),
    endChime: bool(r['endChime'], d.endChime),
    endFlash: bool(r['endFlash'], d.endFlash),
    endAction: oneOf(r['endAction'], END_ACTIONS, d.endAction),
    visualizer: oneOf(r['visualizer'], VISUALIZERS, d.visualizer),
    visualizerSensitivity: num(r['visualizerSensitivity'], 0.5, 2, d.visualizerSensitivity),
    volume: num(r['volume'], 0, 1, d.volume),
    muted: bool(r['muted'], d.muted),
    crossfadeMs: num(r['crossfadeMs'], 0, 5_000, d.crossfadeMs),
    singleLoopStyle: oneOf(r['singleLoopStyle'], LOOPS, d.singleLoopStyle),
    shuffle: bool(r['shuffle'], d.shuffle),
    repeatPlaylist: bool(r['repeatPlaylist'], d.repeatPlaylist),
    allowDuplicates: bool(r['allowDuplicates'], d.allowDuplicates),
  };
}

/** docs/08 §2: persisted choice wins, else `navigator.language`, else EN. */
export function initialLang(stored: TtLang | null, navigatorLanguage: string | undefined): TtLang {
  if (stored) return stored;
  return navigatorLanguage?.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}
