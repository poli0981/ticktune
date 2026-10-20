/**
 * Spike S4b — what a run MEASURED, from the audio itself (docs/15 §S4).
 *
 * Pure. The old harness read back the `gain.value` it had scheduled, so its
 * "overlap" agreed with the schedule by construction and could not fail. Every
 * number here comes from the probe: per-deck signal before and after the deck
 * gain, and the master before and after `fadeGain`, one 128-frame block at a
 * time. tests/unit/s4b-metrics.test.ts shows the old metric passing the three
 * failures these catch.
 */

/** One render quantum as the probe reports it. */
export interface TtBlock {
  /** `currentFrame` at the start of the block. */
  f: number;
  /** Mean square of the input before the gain under test. */
  pre: number;
  /** Mean square after it. */
  post: number;
  /** Largest |x[n] − 2x[n−1] + x[n−2]| after the gain, continuous across blocks. */
  d2: number;
  /** Samples at or above 0.999 after the gain. */
  clip: number;
}

export type TtEventKind =
  | 'trigger'
  | 'play-out'
  | 'play-in'
  | 'curve-start'
  | 'curve-end'
  | 'ended-out'
  | 'ended-in'
  | 'switch'
  | 'pause'
  | 'resume'
  | 'master-fade'
  /** A user-volume write: recorded, but a step in it is not the crossfade's click. */
  | 'volume'
  | 'error';

/** Something the runner did or saw, on the audio clock (seconds). */
export interface TtRunEvent {
  kind: TtEventKind;
  atS: number;
  detail?: string;
}

/** A run's raw record — what the runner collects and the metrics read. */
export interface TtRunTrace {
  sampleRate: number;
  /** `[outgoing, incoming]` deck probes; for a loop run, deck order per transition. */
  out: TtBlock[];
  in: TtBlock[];
  master: TtBlock[];
  events: TtRunEvent[];
  /** The scheduled crossfade, when there was one. */
  schedule: { startS: number; effS: number } | null;
  /** The scheduled master fade (mode `master`). */
  masterFade: { startS: number; lenS: number } | null;
  /** Leading/trailing silence of the files, from the manifest (0 for tones). */
  outTrailSilenceS: number;
  inLeadSilenceS: number;
}

const BLOCK = 128;
/** −60 dBFS as a mean square: below this a deck is "not playing". */
const PRESENT_MS = 1e-6;
/** The overlap threshold θ: both gains at or above −20 dB. */
const THETA = 0.1;
/** −50 dBFS as an amplitude — a discontinuity smaller than this is inaudible. */
const CLICK_FLOOR = 10 ** (-50 / 20);
/**
 * Asymmetric: the main thread SEES an `ended` or a `play()` after the audio
 * changed, by up to a `timeupdate` period, so a click is looked for well before
 * the event and only a little after it.
 */
const CLICK_BEFORE_S = 0.3;
const CLICK_AFTER_S = 0.1;
const CLICK_BASELINE_S = 0.5;
/** A realized-gain step between two consecutive blocks larger than this is a cut. */
const GAIN_JUMP = 0.25;

const present = (b: TtBlock | undefined): b is TtBlock => !!b && b.pre > PRESENT_MS;
const gainOf = (b: TtBlock): number => Math.sqrt(b.post / b.pre);
const secs = (t: TtRunTrace, b: TtBlock): number => b.f / t.sampleRate;
const ms = (s: number): number => Math.round(s * 1000);

/**
 * docs/15 §S4's overlap for an IDEAL equal-power fade of length `effS`,
 * measured at threshold θ: both `cos(πt/2) ≥ θ` and `sin(πt/2) ≥ θ`, which
 * holds for `1 − (4/π)·asin θ` of the fade — 0.8725·eff at θ = 0.1. Comparing
 * against `effS` itself, as the old harness did, spent 127 of the 150 ms
 * tolerance on a perfect run at 5 s.
 */
export function idealOverlapS(effS: number, theta = THETA): number {
  return effS * (1 - (4 / Math.PI) * Math.asin(theta));
}

/** Time both decks are playing with realized gain ≥ θ. */
function overlapS(t: TtRunTrace, theta = THETA): number {
  const inByFrame = new Map(t.in.map((b) => [b.f, b]));
  let n = 0;
  for (const a of t.out) {
    const b = inByFrame.get(a.f);
    if (present(a) && present(b) && gainOf(a) >= theta && gainOf(b) >= theta) n++;
  }
  return (n * BLOCK) / t.sampleRate;
}

/** First block at or after `fromS` where `pred` holds on a present block. */
function firstWhere(
  t: TtRunTrace,
  blocks: TtBlock[],
  fromS: number,
  pred: (b: TtBlock) => boolean,
): number | null {
  for (const b of blocks) {
    if (secs(t, b) < fromS) continue;
    if (present(b) && pred(b)) return secs(t, b);
  }
  return null;
}

/**
 * Fit a measured fade to the scheduled curve from two crossings.
 *
 * Out: `g = cos(π/2·(x−s)/L)`, crossing 0.9 at `a90` and 0.1 at `a10` of the
 * fade. In: `g = sin(…)`, crossing 0.1 and 0.9 likewise. Two points pin `s`
 * and `L`; a block is 2.7 ms at 48 kHz, so that is the resolution.
 */
export function fitFade(
  t: TtRunTrace,
  blocks: TtBlock[],
  kind: 'out' | 'in',
  fromS: number,
): { startS: number; lenS: number } | null {
  const p = (g: number) => (2 / Math.PI) * (kind === 'out' ? Math.acos(g) : Math.asin(g));
  const [g1, g2] = kind === 'out' ? [0.9, 0.1] : [0.1, 0.9];
  const cross = (g: number) =>
    firstWhere(t, blocks, fromS, (b) => (kind === 'out' ? gainOf(b) <= g : gainOf(b) >= g));
  const t1 = cross(g1);
  const t2 = cross(g2);
  if (t1 === null || t2 === null || t2 <= t1) return null;
  const lenS = (t2 - t1) / (p(g2) - p(g1));
  return { startS: t1 - p(g1) * lenS, lenS };
}

export interface TtClick {
  atMs: number;
  where: 'out' | 'in' | 'master';
  kind: 'discontinuity' | 'gain-step';
}

/**
 * Clicks near a transition: a second difference more than 10× the p99 of the
 * preceding 500 ms and above −50 dBFS, or a realized-gain step > 0.25 between
 * two playing blocks. Only within ±100 ms of something the runner DID, so a
 * drum hit in the music is not a click.
 */
export function findClicks(t: TtRunTrace): TtClick[] {
  const marks = t.events
    // Not marks: the run's own setup (`play-out` starts a tone the harness has
    // seeked into mid-wave — a real step, but not the transition under test),
    // decisions, errors, and user-volume writes.
    .filter((e) => !['error', 'trigger', 'volume', 'play-out'].includes(e.kind))
    .map((e) => e.atS);
  const near = (s: number) => marks.some((m) => s >= m - CLICK_BEFORE_S && s <= m + CLICK_AFTER_S);
  const out: TtClick[] = [];
  const scan = (blocks: TtBlock[], where: TtClick['where']) => {
    const base = Math.round((CLICK_BASELINE_S * t.sampleRate) / BLOCK);
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      const at = secs(t, b);
      if (!near(at)) continue;
      const prev = blocks
        .slice(Math.max(0, i - base), i)
        .map((x) => x.d2)
        .sort((x, y) => x - y);
      const p99 = prev.length ? prev[Math.floor(prev.length * 0.99)]! : 0;
      if (b.d2 > CLICK_FLOOR && b.d2 > 10 * p99) {
        out.push({ atMs: ms(at), where, kind: 'discontinuity' });
      }
      const a = blocks[i - 1];
      if (
        where !== 'master' &&
        present(a) &&
        present(b) &&
        Math.abs(gainOf(b) - gainOf(a)) > GAIN_JUMP
      ) {
        out.push({ atMs: ms(at), where, kind: 'gain-step' });
      }
    }
  };
  scan(t.out, 'out');
  scan(t.in, 'in');
  scan(t.master, 'master');
  return out;
}

export interface TtRunMetrics {
  overlapMs: number | null;
  idealOverlapMs: number | null;
  overlapErrMs: number | null;
  outFit: { startErrMs: number; lenErrMs: number } | null;
  inFit: { startErrMs: number; lenErrMs: number } | null;
  /** First incoming signal after its `play()`. */
  inStartLatencyMs: number | null;
  /** Incoming signal that arrived after its curve had already begun rising. */
  headLossMs: number | null;
  /** Outgoing SIGNAL end − fade end. Negative: it stopped while still audible. */
  endGuardSignalMs: number | null;
  /** Outgoing `ended` − fade end. Content-independent, for real music. */
  endGuardEndedMs: number | null;
  /** 0 s runs: silence across the switch, net of the files' own silence. */
  gapMs: number | null;
  clicks: TtClick[];
  /** Steady test tones only: master level during the fade vs before, worst |dB|. */
  equalPowerDevDb: number | null;
  clipped: number;
  masterFadeFit: { startErrMs: number; lenErrMs: number } | null;
  errors: string[];
}

const event = (t: TtRunTrace, kind: TtEventKind) => t.events.find((e) => e.kind === kind);

/** Everything docs/15 §S4's verdict needs, from one trace. */
export function measureRun(t: TtRunTrace): TtRunMetrics {
  const sch = t.schedule;
  // The LAST curve-end, not start + eff: a run paused mid-fade finishes later.
  const lastCurveEnd = t.events.filter((e) => e.kind === 'curve-end').at(-1);
  const fadeEndS = sch ? (lastCurveEnd?.atS ?? sch.startS + sch.effS) : null;

  const outFit = sch ? fitFade(t, t.out, 'out', sch.startS - 0.2) : null;
  const inFit = sch ? fitFade(t, t.in, 'in', sch.startS - 0.2) : null;

  const playIn = event(t, 'play-in');
  const firstIn = playIn ? firstWhere(t, t.in, playIn.atS - 0.05, () => true) : null;

  const lastOut = [...t.out].reverse().find(present);
  const endedOut = event(t, 'ended-out');

  // The 0 s gap is what a listener hears, so it reads AUDIBLE output — after
  // the gain — rather than the media signal before it.
  let gapMs: number | null = null;
  if (!sch) {
    const audible = (b: TtBlock) => b.post > PRESENT_MS;
    const lastHeard = [...t.out].reverse().find(audible);
    const firstHeard = playIn
      ? t.in.find((b) => secs(t, b) >= playIn.atS - 0.05 && audible(b))
      : undefined;
    if (lastHeard && firstHeard) {
      gapMs = ms(secs(t, firstHeard) - secs(t, lastHeard) - t.outTrailSilenceS - t.inLeadSilenceS);
    }
  }

  let equalPowerDevDb: number | null = null;
  if (sch) {
    const before = t.master.filter(
      (b) => present(b) && secs(t, b) > sch.startS - 0.5 && secs(t, b) < sch.startS,
    );
    const during = t.master.filter(
      (b) => present(b) && secs(t, b) >= sch.startS && secs(t, b) <= sch.startS + sch.effS,
    );
    if (before.length && during.length) {
      const ref = before.reduce((s, b) => s + b.post, 0) / before.length;
      // Averaged over ~21 ms so a single quiet block of a beating pair cannot
      // dominate; the quantity is power, so the average is the right one.
      const W = 8;
      let worst = 0;
      for (let i = 0; i + W <= during.length; i += W) {
        const p = during.slice(i, i + W).reduce((s, b) => s + b.post, 0) / W;
        worst = Math.max(worst, Math.abs(10 * Math.log10(p / ref)));
      }
      equalPowerDevDb = Math.round(worst * 100) / 100;
    }
  }

  let masterFadeFit: TtRunMetrics['masterFadeFit'] = null;
  if (t.masterFade) {
    const f = fitFade(t, t.master, 'out', t.masterFade.startS - 0.2);
    if (f) {
      masterFadeFit = {
        startErrMs: ms(f.startS - t.masterFade.startS),
        lenErrMs: ms(f.lenS - t.masterFade.lenS),
      };
    }
  }

  const overlap = sch ? overlapS(t) : null;
  const ideal = sch ? idealOverlapS(sch.effS) : null;

  return {
    overlapMs: overlap === null ? null : ms(overlap),
    idealOverlapMs: ideal === null ? null : ms(ideal),
    overlapErrMs: overlap === null || ideal === null ? null : ms(overlap - ideal),
    outFit:
      sch && outFit
        ? { startErrMs: ms(outFit.startS - sch.startS), lenErrMs: ms(outFit.lenS - sch.effS) }
        : null,
    inFit:
      sch && inFit
        ? { startErrMs: ms(inFit.startS - sch.startS), lenErrMs: ms(inFit.lenS - sch.effS) }
        : null,
    inStartLatencyMs: playIn && firstIn !== null ? ms(firstIn - playIn.atS) : null,
    headLossMs: sch && firstIn !== null ? Math.max(0, ms(firstIn - sch.startS)) : null,
    endGuardSignalMs: fadeEndS !== null && lastOut ? ms(secs(t, lastOut) - fadeEndS) : null,
    endGuardEndedMs: fadeEndS !== null && endedOut ? ms(endedOut.atS - fadeEndS) : null,
    gapMs,
    clicks: findClicks(t),
    equalPowerDevDb,
    clipped: t.master.reduce((s, b) => s + b.clip, 0),
    masterFadeFit,
    errors: t.events.filter((e) => e.kind === 'error').map((e) => e.detail ?? 'error'),
  };
}

// ── verdict rules (docs/15 §S4) ─────────────────────────────────────────────

const TOLERANCE_MS = 150;

export interface TtCheck {
  name: string;
  pass: boolean;
  detail: string;
}

/**
 * A crossfade run on a TEST file. Every rule can fail: that is the point — a
 * rule that could not fail is the bug this harness replaces.
 */
export function judgeTestXfade(
  m: TtRunMetrics,
  cfg: { marginS: number; guardS: number },
): TtCheck[] {
  const upper = (cfg.marginS + cfg.guardS) * 1000 + TOLERANCE_MS;
  return [
    {
      name: 'overlap within ±150 ms of ideal',
      pass: m.overlapErrMs !== null && Math.abs(m.overlapErrMs) <= TOLERANCE_MS,
      detail: `err ${m.overlapErrMs} ms (measured ${m.overlapMs} / ideal ${m.idealOverlapMs})`,
    },
    {
      name: 'outgoing still playing when its fade ends',
      pass: m.endGuardSignalMs !== null && m.endGuardSignalMs >= 0 && m.endGuardSignalMs <= upper,
      detail: `signal end − fade end = ${m.endGuardSignalMs} ms (allowed 0…${upper})`,
    },
    {
      name: 'incoming loses ≤ 150 ms of its fade-in',
      pass: m.headLossMs !== null && m.headLossMs <= TOLERANCE_MS,
      detail: `head loss ${m.headLossMs} ms`,
    },
    { name: 'no click', pass: m.clicks.length === 0, detail: `${m.clicks.length} click(s)` },
    { name: 'no exception', pass: m.errors.length === 0, detail: m.errors.join('; ') || '—' },
  ];
}

/** A crossfade run on REAL music: timing by `ended`, which content cannot fool. */
export function judgeMusicXfade(
  m: TtRunMetrics,
  cfg: { marginS: number; guardS: number },
): TtCheck[] {
  const upper = (cfg.marginS + cfg.guardS) * 1000 + TOLERANCE_MS;
  return [
    {
      name: 'no truncation, no early cut',
      pass: m.endGuardEndedMs !== null && m.endGuardEndedMs >= 0 && m.endGuardEndedMs <= upper,
      detail: `ended − fade end = ${m.endGuardEndedMs} ms (allowed 0…${upper})`,
    },
    { name: 'no exception', pass: m.errors.length === 0, detail: m.errors.join('; ') || '—' },
  ];
}

/** A 0 s run: the gap, net of the files' own silence, and no click. */
export function judgeZero(m: TtRunMetrics): TtCheck[] {
  return [
    {
      name: 'gap within ±150 ms',
      pass: m.gapMs !== null && Math.abs(m.gapMs) <= TOLERANCE_MS,
      detail: `gap ${m.gapMs} ms`,
    },
    { name: 'no click', pass: m.clicks.length === 0, detail: `${m.clicks.length} click(s)` },
    { name: 'no exception', pass: m.errors.length === 0, detail: m.errors.join('; ') || '—' },
  ];
}

/** The master fade landing mid-crossfade (docs/05 §1's split stage). */
export function judgeMasterFade(m: TtRunMetrics): TtCheck[] {
  const f = m.masterFadeFit;
  return [
    {
      name: 'master fade on schedule (±10 ms)',
      pass: !!f && Math.abs(f.startErrMs) <= 10 && Math.abs(f.lenErrMs) <= 10,
      detail: f ? `start ${f.startErrMs} ms, length ${f.lenErrMs} ms` : 'not measured',
    },
    { name: 'no click', pass: m.clicks.length === 0, detail: `${m.clicks.length} click(s)` },
    { name: 'no exception', pass: m.errors.length === 0, detail: m.errors.join('; ') || '—' },
  ];
}

export const allPass = (checks: TtCheck[]): boolean => checks.every((c) => c.pass);
