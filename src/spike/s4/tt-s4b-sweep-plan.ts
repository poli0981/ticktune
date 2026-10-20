/**
 * Spike S4b — which runs a sweep makes (docs/15 §S4).
 *
 * Pure, and shared: `scripts/s4b-sweep.ts` drives it through Playwright, and
 * the harness page runs the same list from its own button so Firefox and
 * Safari can be swept by hand.
 */

/** One file as `scripts/make-s4b-fixtures.ts` describes it in manifest.json. */
export interface TtS4bFixture {
  name: string;
  /** wav, cbr, …, corpus-xing, corpus-noxing, corpus-extra, control-*. */
  family: string;
  /** Pair member for the A→B runs; absent for single files. */
  role?: 'a' | 'b';
  /** True duration from a full ffmpeg decode, seconds. */
  exactS: number;
  leadSilenceS: number;
  trailSilenceS: number;
  /** Seeking uses the very duration estimate under test: play these from 0. */
  fromStart: boolean;
  kind: 'test' | 'music' | 'control';
}

type TtS4bMode = 'inter' | 'loop' | 'zero' | 'master' | 'pause';
type TtS4bJudge = 'test-xfade' | 'music-xfade' | 'zero' | 'master' | 'control';

export interface TtS4bRunConfig {
  label: string;
  group: string;
  mode: TtS4bMode;
  a: string;
  /** Omitted for `loop`, which plays `a` on both decks from one URL. */
  b?: string;
  fadeMs: number;
  zero?: 'Z1' | 'Z2' | 'Z3';
  durationSource: 'element' | 'exact';
  marginS: number;
  latencyS: number;
  guardS: number;
  /** Set and preload the incoming deck this long before the trigger; 0 = at it. */
  armLeadS: number;
  fromStart: boolean;
  /** The deliberately broken runs that MUST fail (docs/15 §S4). */
  control?: 'b-corrupt' | 'delay-in-300' | 'pause-out-400' | 'click';
  judge: TtS4bJudge;
}

const DEFAULTS = { marginS: 0.3, latencyS: 0, guardS: 0.03, armLeadS: 8 } as const;

const PAIRS = ['wav', 'cbr', 'cbr-noinfo', 'vbr-xing', 'adts', 'm4a', 'flac', 'opus'];

function pair(fx: TtS4bFixture[], family: string): [TtS4bFixture, TtS4bFixture] | null {
  const a = fx.find((f) => f.family === family && f.role === 'a');
  const b = fx.find((f) => f.family === family && f.role === 'b');
  return a && b ? [a, b] : null;
}

/**
 * `exact` by default: the first sweep (Edge 155) showed the element's own
 * estimate firing early on raw ADTS and failing outright on header-less VBR,
 * while the true duration kept every family on time. The engine takes the
 * importer's `parseBlob({ duration: true })` value; `element` stays measured,
 * in its own group, as the comparison.
 */
function base(
  label: string,
  group: string,
): Omit<TtS4bRunConfig, 'mode' | 'a' | 'fadeMs' | 'judge'> {
  return { label, group, durationSource: 'exact', fromStart: false, ...DEFAULTS };
}

/** ~15 minutes on one browser: every test-file family, every duration class. */
export function quickPlan(fx: TtS4bFixture[]): TtS4bRunConfig[] {
  const runs: TtS4bRunConfig[] = [];
  const wav = pair(fx, 'wav');
  if (!wav) throw new Error('manifest has no wav pair — run `pnpm s4b:fixtures`');
  const [wa, wb] = wav;

  // ── controls: each MUST fail, or the harness is invalid ──────────────────
  const corrupt = fx.find((f) => f.family === 'control-corrupt');
  const click = fx.find((f) => f.family === 'control-click');
  if (corrupt) {
    runs.push({
      ...base('control: B never starts', 'controls'),
      mode: 'inter',
      a: wa.name,
      b: corrupt.name,
      fadeMs: 2000,
      control: 'b-corrupt',
      judge: 'control',
    });
  }
  runs.push({
    ...base('control: B plays 300 ms late', 'controls'),
    mode: 'inter',
    a: wa.name,
    b: wb.name,
    fadeMs: 2000,
    armLeadS: 0,
    control: 'delay-in-300',
    judge: 'control',
  });
  runs.push({
    ...base('control: A paused 400 ms early', 'controls'),
    mode: 'inter',
    a: wa.name,
    b: wb.name,
    fadeMs: 2000,
    control: 'pause-out-400',
    judge: 'control',
  });
  if (click) {
    runs.push({
      ...base('control: a step in the signal', 'controls'),
      mode: 'zero',
      zero: 'Z2',
      a: click.name,
      b: wb.name,
      fadeMs: 0,
      control: 'click',
      judge: 'control',
    });
  }

  // ── A→B on every test family at 1, 2, 5 s ─────────────────────────────────
  for (const family of PAIRS) {
    const p = pair(fx, family);
    if (!p) continue;
    for (const fadeMs of [1000, 2000, 5000]) {
      runs.push({
        ...base(`${family} ${fadeMs / 1000}s`, 'inter'),
        mode: 'inter',
        a: p[0].name,
        b: p[1].name,
        fadeMs,
        judge: 'test-xfade',
      });
    }
  }

  // ── the element's own duration, as a comparison (not the engine's source) ──
  for (const family of ['adts', 'cbr-noinfo']) {
    const p = pair(fx, family);
    if (!p) continue;
    runs.push({
      ...base(`${family} 2s by element`, 'element-duration'),
      mode: 'inter',
      a: p[0].name,
      b: p[1].name,
      fadeMs: 2000,
      durationSource: 'element',
      judge: 'music-xfade',
    });
  }

  // ── VBR with no header: the duration estimate under test ─────────────────
  for (const family of ['vbr-noxing-up', 'vbr-noxing-down']) {
    const f = fx.find((x) => x.family === family);
    if (!f) continue;
    for (const durationSource of ['element', 'exact'] as const) {
      runs.push({
        ...base(`${family} 2s by ${durationSource}`, 'vbr-noxing'),
        mode: 'inter',
        a: f.name,
        b: wb.name,
        fadeMs: 2000,
        durationSource,
        fromStart: true,
        judge: 'music-xfade',
      });
    }
  }

  // ── loop: one file, one URL, both decks ──────────────────────────────────
  for (const family of ['wav', 'vbr-xing']) {
    const p = pair(fx, family);
    if (p)
      runs.push({
        ...base(`loop ${family} 2s`, 'loop'),
        mode: 'loop',
        a: p[0].name,
        fadeMs: 2000,
        judge: 'test-xfade',
      });
  }

  // ── 0 s: three ways to switch, so the verdict can pick one ───────────────
  for (const family of ['wav', 'cbr']) {
    const p = pair(fx, family);
    if (!p) continue;
    for (const zero of ['Z1', 'Z2', 'Z3'] as const) {
      runs.push({
        ...base(`0s ${zero} ${family}`, 'zero'),
        mode: 'zero',
        zero,
        a: p[0].name,
        b: p[1].name,
        fadeMs: 0,
        judge: 'zero',
      });
    }
  }

  // ── the master stage mid-crossfade, and its control ──────────────────────
  runs.push({
    ...base('master fade in a 5s crossfade', 'master'),
    mode: 'master',
    a: wa.name,
    b: wb.name,
    fadeMs: 5000,
    judge: 'master',
  });
  runs.push({
    ...base('master control: same run, no master fade', 'master'),
    mode: 'inter',
    a: wa.name,
    b: wb.name,
    fadeMs: 5000,
    judge: 'test-xfade',
  });

  // ── pause mid-fade: Firefox has no cancelAndHoldAtTime ───────────────────
  for (const fadeMs of [2000, 5000]) {
    runs.push({
      ...base(`pause mid-fade ${fadeMs / 1000}s`, 'pause'),
      mode: 'pause',
      a: wa.name,
      b: wb.name,
      fadeMs,
      judge: 'test-xfade',
    });
  }
  return runs;
}

/** quick × 3, plus real music: corpus VBR as shipped and with its header removed. */
export function fullPlan(fx: TtS4bFixture[]): TtS4bRunConfig[] {
  const quick = quickPlan(fx);
  const runs = [0, 1, 2].flatMap((r) =>
    quick.map((c) => ({ ...c, label: `${c.label} #${r + 1}` })),
  );
  const wb = pair(fx, 'wav')?.[1];
  if (!wb) return runs;
  // Real masters with a header the browser reads: crossfaded from the tail.
  for (const f of fx.filter((x) => x.family === 'corpus-xing' || x.family === 'corpus-extra')) {
    for (const fadeMs of [1000, 2000, 5000]) {
      runs.push({
        ...base(`corpus ${f.name} ${fadeMs / 1000}s`, 'corpus'),
        mode: 'inter',
        a: f.name,
        b: wb.name,
        fadeMs,
        judge: 'music-xfade',
      });
    }
  }
  for (const f of fx.filter((x) => x.family === 'corpus-noxing')) {
    for (const durationSource of ['element', 'exact'] as const) {
      runs.push({
        ...base(`corpus-noxing ${f.name} 2s by ${durationSource}`, 'corpus-noxing'),
        mode: 'inter',
        a: f.name,
        b: wb.name,
        fadeMs: 2000,
        durationSource,
        fromStart: true,
        judge: 'music-xfade',
      });
    }
  }
  return runs;
}
