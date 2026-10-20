/**
 * Spike S4b — from runs to the docs/15 §S4 verdict. Pure, shared by the
 * harness page and `scripts/s4b-sweep.ts`.
 */
import {
  allPass,
  judgeMasterFade,
  judgeMusicXfade,
  judgeTestXfade,
  judgeZero,
  type TtCheck,
  type TtRunMetrics,
} from './tt-s4b-metrics';
import type { TtS4bRunConfig } from './tt-s4b-sweep-plan';

export interface TtJudgedRun {
  label: string;
  cfg: TtS4bRunConfig;
  metrics: TtRunMetrics;
  checks: TtCheck[];
  /** The run met its rules. */
  pass: boolean;
  /** For a control: it FAILED, as it must. For anything else: it passed. */
  ok: boolean;
}

function checksFor(cfg: TtS4bRunConfig, m: TtRunMetrics): TtCheck[] {
  const timing = { marginS: cfg.marginS, guardS: cfg.guardS };
  switch (cfg.judge) {
    case 'music-xfade':
      return judgeMusicXfade(m, timing);
    case 'zero':
      return judgeZero(m);
    case 'master':
      return judgeMasterFade(m);
    case 'control':
      return cfg.mode === 'zero' ? judgeZero(m) : judgeTestXfade(m, timing);
    case 'test-xfade':
      return judgeTestXfade(m, timing);
  }
}

export function judgeRun(r: {
  label: string;
  cfg: TtS4bRunConfig;
  metrics: TtRunMetrics;
}): TtJudgedRun {
  const checks = checksFor(r.cfg, r.metrics);
  const pass = allPass(checks);
  return { ...r, checks, pass, ok: r.cfg.judge === 'control' ? !pass : pass };
}

interface TtCriterion {
  name: string;
  pass: boolean;
  detail: string;
}

export interface TtVerdict {
  outcome: 'PASS' | 'FAIL' | 'HARNESS INVALID';
  criteria: TtCriterion[];
  /** The 0 s switch the engine should use, if any passed. */
  zeroChoice: 'Z1' | 'Z2' | 'Z3' | null;
  /** The duration source that kept header-less VBR on time, if either did. */
  durationSource: 'element' | 'exact' | null;
}

const count = (runs: TtJudgedRun[]) => `${runs.filter((r) => r.ok).length}/${runs.length}`;

export function verdict(runs: TtJudgedRun[]): TtVerdict {
  const by = (pred: (r: TtJudgedRun) => boolean) => runs.filter(pred);
  const criteria: TtCriterion[] = [];

  const controls = by((r) => r.cfg.judge === 'control');
  const harnessValid = controls.length >= 3 && controls.every((r) => r.ok);
  criteria.push({
    name: 'harness can fail: every control run FAILS',
    pass: harnessValid,
    detail: controls
      .map((r) => `${r.label}: ${r.pass ? 'PASSED (bad)' : 'failed (good)'}`)
      .join('; '),
  });

  const tests = by((r) => r.cfg.judge === 'test-xfade');
  criteria.push({
    name: 'test files: overlap ±150 ms, no truncation, head loss ≤ 150 ms, no click',
    pass: tests.length > 0 && tests.every((r) => r.ok),
    detail: `${count(tests)} runs pass`,
  });

  const zeroBy = (z: 'Z1' | 'Z2' | 'Z3') => by((r) => r.cfg.judge === 'zero' && r.cfg.zero === z);
  const zeroChoice =
    (['Z2', 'Z1', 'Z3'] as const).find(
      (z) => zeroBy(z).length > 0 && zeroBy(z).every((r) => r.ok),
    ) ?? null;
  criteria.push({
    name: '0 s: gap ±150 ms and no click, for at least one switch',
    pass: zeroChoice !== null,
    detail: (['Z1', 'Z2', 'Z3'] as const).map((z) => `${z} ${count(zeroBy(z))}`).join(', '),
  });

  const master = by((r) => r.cfg.judge === 'master');
  const control = runs.find((r) => r.cfg.group === 'master' && r.cfg.judge === 'test-xfade');
  const drift =
    master[0]?.metrics.overlapMs != null && control?.metrics.overlapMs != null
      ? Math.abs(master[0].metrics.overlapMs - control.metrics.overlapMs)
      : null;
  criteria.push({
    name: 'master fade mid-crossfade: on schedule, no click, overlap within 20 ms of its control',
    pass: master.length > 0 && master.every((r) => r.ok) && drift !== null && drift <= 20,
    detail: `${count(master)} runs pass; overlap drift ${drift ?? '–'} ms`,
  });

  const noxing = (src: 'element' | 'exact') =>
    by((r) => r.cfg.group.endsWith('noxing') && r.cfg.durationSource === src);
  const durationSource =
    (['element', 'exact'] as const).find(
      (s) => noxing(s).length > 0 && noxing(s).every((r) => r.ok),
    ) ?? null;
  criteria.push({
    name: 'header-less VBR kept on time by some duration source',
    pass: durationSource !== null,
    detail: `element ${count(noxing('element'))}, exact ${count(noxing('exact'))}`,
  });

  const corpus = by((r) => r.cfg.group === 'corpus');
  if (corpus.length) {
    criteria.push({
      name: 'real VBR music (as shipped): no truncation, no early cut',
      pass: corpus.every((r) => r.ok),
      detail: `${count(corpus)} runs pass`,
    });
  }

  const outcome = !harnessValid
    ? 'HARNESS INVALID'
    : criteria.every((c) => c.pass)
      ? 'PASS'
      : 'FAIL';
  return { outcome, criteria, zeroChoice, durationSource };
}
