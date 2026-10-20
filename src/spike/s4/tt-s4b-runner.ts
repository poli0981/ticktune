/**
 * Spike S4b — runs one configuration on the SHIPPING graph and returns what
 * the probes measured (docs/15 §S4).
 *
 * Browser-only and deliberately dumb: every decision is in tt-crossfade.ts
 * (when to fade) and tt-s4b-metrics.ts (what happened), both pure and
 * unit-tested. This file plays media, schedules curves and writes down what it
 * did, on the audio clock.
 */
import { buildTtGraph, ttGraphPorts, type TtGraph } from '../../app/engine/audio/tt-audio-driver';
import { applyVolume, restoreFadeGain } from '../../app/engine/audio/tt-audio-graph';
import { planEndBehavior, runEndBehavior } from '../../app/engine/audio/tt-end-behavior';
import probeUrl from './tt-s4b-probe.worklet.ts?worker&url';
import {
  measureRun,
  type TtBlock,
  type TtEventKind,
  type TtRunEvent,
  type TtRunMetrics,
  type TtRunTrace,
} from './tt-s4b-metrics';
import { crossfadePlan, curve, gainIn, gainOut } from '../../app/engine/audio/tt-crossfade';
import type { TtS4bFixture, TtS4bRunConfig } from './tt-s4b-sweep-plan';

interface TtDurationEvent {
  deck: 0 | 1;
  atS: number;
  mediaS: number;
  from: number | null;
  to: number | null;
}

export interface TtS4bRunResult {
  label: string;
  cfg: TtS4bRunConfig;
  metrics: TtRunMetrics;
  durations: TtDurationEvent[];
  events: TtRunEvent[];
  browser: string;
}

interface Rig {
  ctx: AudioContext;
  graph: TtGraph;
  /** deck 0, deck 1, master. */
  probes: [AudioWorkletNode, AudioWorkletNode, AudioWorkletNode];
  blocks: [TtBlock[], TtBlock[], TtBlock[]];
  waiting: Array<(() => void) | null>;
}

type Ev = (kind: TtEventKind, atS?: number, detail?: string) => void;

let ctx: AudioContext | null = null;
let rig: Rig | null = null;
const files = new Map<string, File>();
let fixtures: TtS4bFixture[] = [];

export const loadedFixtures = (): TtS4bFixture[] => fixtures;
export const loadedFileCount = (): number => files.size;

/** Audio files plus `manifest.json` from `pnpm s4b:fixtures`. */
export async function loadFiles(list: File[]): Promise<void> {
  for (const f of list) {
    if (f.name.endsWith('.json')) {
      fixtures = (JSON.parse(await f.text()) as { files: TtS4bFixture[] }).files;
    } else {
      files.set(f.name, f);
    }
  }
}

/** Call from a user gesture: it resumes the context (docs/05 §1). */
export function unlock(): Promise<AudioContextState> {
  ctx ??= new AudioContext();
  const c = ctx;
  return c.resume().then(async () => {
    await ensureRig(c);
    return c.state;
  });
}

export const contextState = (): AudioContextState | 'none' => ctx?.state ?? 'none';

async function ensureRig(c: AudioContext): Promise<Rig> {
  if (rig) return rig;
  const graph = buildTtGraph(c);
  await c.audioWorklet.addModule(probeUrl);
  const make = () =>
    new AudioWorkletNode(c, 'tt-s4b-probe', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
  const probes: Rig['probes'] = [make(), make(), make()];
  const r: Rig = { ctx: c, graph, probes, blocks: [[], [], []], waiting: [null, null, null] };
  probes.forEach((p, i) => {
    p.port.onmessage = (e: MessageEvent<TtBlock[] | string>) => {
      if (Array.isArray(e.data)) r.blocks[i]!.push(...e.data);
      else {
        r.waiting[i]?.();
        r.waiting[i] = null;
      }
    };
    p.connect(c.destination); // silent output: keeps the node in the render graph
  });
  graph.sources[0].connect(probes[0], 0, 0);
  graph.deckGains[0].connect(probes[0], 0, 1);
  graph.sources[1].connect(probes[1], 0, 0);
  graph.deckGains[1].connect(probes[1], 0, 1);
  graph.userGain.connect(probes[2], 0, 0);
  graph.fadeGain.connect(probes[2], 0, 1);
  rig = r;
  return r;
}

async function flushProbes(r: Rig): Promise<void> {
  await Promise.all(
    r.probes.map(
      (p, i) =>
        new Promise<void>((res) => {
          r.waiting[i] = res;
          p.port.postMessage('flush');
        }),
    ),
  );
}

function resetRig(r: Rig): void {
  const now = r.ctx.currentTime;
  for (const el of r.graph.elements) {
    el.pause();
    el.loop = false;
    el.removeAttribute('src');
    el.load();
  }
  for (const g of r.graph.deckGains) {
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(0, now);
  }
  const ports = ttGraphPorts(r.graph);
  restoreFadeGain(ports);
  applyVolume(ports, 1, false);
  r.probes.forEach((p) => p.port.postMessage('reset'));
  r.blocks.forEach((b) => (b.length = 0));
}

function once(target: EventTarget, type: string, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const on = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      target.removeEventListener(type, on);
      reject(new Error(`${type} timed out`));
    }, timeoutMs);
    target.addEventListener(type, on, { once: true });
  });
}

/** Metadata, or the media error that means it will never come. */
function loaded(el: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const ac = new AbortController();
    el.addEventListener('loadedmetadata', () => (ac.abort(), resolve()), { signal: ac.signal });
    el.addEventListener('error', () => (ac.abort(), reject(new Error('media error'))), {
      signal: ac.signal,
    });
  });
}

async function seek(el: HTMLAudioElement, s: number): Promise<void> {
  const done = once(el, 'seeked');
  el.currentTime = s;
  await done;
}

const finite = (v: number): number | null => (Number.isFinite(v) ? v : null);

function trackDurations(r: Rig, into: TtDurationEvent[], signal: AbortSignal): void {
  r.graph.elements.forEach((el, deck) => {
    let last = Number.NaN;
    const on = () => {
      const to = el.duration;
      if (Object.is(to, last)) return;
      into.push({
        deck: deck as 0 | 1,
        atS: r.ctx.currentTime,
        mediaS: el.currentTime,
        from: finite(last),
        to: finite(to),
      });
      last = to;
    };
    el.addEventListener('loadedmetadata', on, { signal });
    el.addEventListener('durationchange', on, { signal });
  });
}

const fileOf = (name: string): File => {
  const f = files.get(name);
  if (!f) throw new Error(`file not loaded: ${name}`);
  return f;
};
const fixtureOf = (name: string): TtS4bFixture =>
  fixtures.find((f) => f.name === name) ?? {
    name,
    family: 'manual',
    exactS: 0,
    leadSilenceS: 0,
    trailSilenceS: 0,
    fromStart: false,
    kind: 'test',
  };

/** A de-click ramp: long enough to remove the step, short enough not to be heard. */
const DECLICK_S = 0.015;

/**
 * How long after the de-click ramp the element is paused. The render thread
 * runs ahead of `currentTime` by a varying amount, and at +5 ms one 5 s run in
 * three still stopped the media before the ramp had reached zero. The cost is
 * ~60 ms of already-silent media skipped on resume.
 */
const PAUSE_MARGIN_S = 0.045;

/** Freeze `p` at its value at time `t`: atomically where the browser can. */
function holdAt(p: AudioParam, t: number, value: number): void {
  if (typeof p.cancelAndHoldAtTime === 'function') {
    p.cancelAndHoldAtTime(t);
  } else {
    p.cancelScheduledValues(t);
    p.setValueAtTime(value, t);
  }
}

/** Seconds before the end to start a tail run: enough for the fade plus a settle. */
const tailLeadS = (cfg: TtS4bRunConfig) => Math.max(cfg.fadeMs / 1000 + 6, 8);

interface Transition {
  schedule: TtRunTrace['schedule'];
  masterFade: TtRunTrace['masterFade'];
  fromS: number;
  toS: number;
}

/**
 * One crossfade from `outIdx` to `inIdx`. The outgoing deck is already playing;
 * the incoming one is armed (src set, metadata loaded) or set at the trigger.
 */
function transition(
  r: Rig,
  cfg: TtS4bRunConfig,
  o: {
    outIdx: 0 | 1;
    inIdx: 0 | 1;
    inUrl: string;
    fxOut: TtS4bFixture;
    fxIn: TtS4bFixture;
    armed: boolean;
  },
  ev: Ev,
): Promise<Transition> {
  const { ctx: c, graph } = r;
  const elOut = graph.elements[o.outIdx];
  const elIn = graph.elements[o.inIdx];
  const gOut = graph.deckGains[o.outIdx];
  const gIn = graph.deckGains[o.inIdx];
  const fromS = c.currentTime;
  const dur = () =>
    cfg.durationSource === 'exact' && o.fxOut.exactS > 0 ? o.fxOut.exactS : elOut.duration;

  return new Promise((resolve) => {
    const ac = new AbortController();
    let schedule: Transition['schedule'] = null;
    let masterFade: Transition['masterFade'] = null;
    let decided = false;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ac.abort();
      resolve({ schedule, masterFade, fromS, toS: c.currentTime });
    };
    const at = (fn: () => void, atS: number) =>
      setTimeout(fn, Math.max(0, (atS - c.currentTime) * 1000));
    const fail = (what: string) => (e: unknown) =>
      ev('error', c.currentTime, `${what}: ${e instanceof Error ? e.name : String(e)}`);

    elOut.addEventListener(
      'ended',
      () => {
        ev('ended-out');
        if (!schedule) at(finish, c.currentTime + 1.5);
      },
      { signal: ac.signal },
    );
    elIn.addEventListener('ended', () => ev('ended-in'), { signal: ac.signal });

    const holdAndResume = (sch: { startS: number; effS: number }) => {
      const now = c.currentTime;
      const u = Math.min(1, Math.max(0, (now - sch.startS) / sch.effS));
      const held: Array<[GainNode, number]> = [
        [gOut, gainOut(u)],
        [gIn, gainIn(u)],
      ];
      // Hold the value the curve has reached, then DE-CLICK: `pause()` on a
      // playing element is a step (the first sweep counted 6–8 clicks per run
      // without the ramp). The hold must be ATOMIC: cancelScheduledValues on an
      // active curve restores the pre-curve value (1 or 0), and the render
      // thread can play a quantum of it before the next call lands — the
      // second sweep caught exactly that. cancelAndHoldAtTime does both at once;
      // Firefox lacks it, so it falls back and is measured by hand.
      for (const [g, v] of held) {
        holdAt(g.gain, now, v);
        g.gain.linearRampToValueAtTime(0, now + DECLICK_S);
      }
      at(
        () => {
          elOut.pause();
          elIn.pause();
          ev('pause');
        },
        now + DECLICK_S + PAUSE_MARGIN_S,
      );
      setTimeout(() => {
        ev('resume');
        Promise.all([elOut.play(), elIn.play()]).then(() => {
          const t = c.currentTime;
          for (const [g, v] of held) {
            g.gain.cancelScheduledValues(t);
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(v, t + DECLICK_S);
          }
          // Starts just after the ramp's end event: a curve may not overlap one.
          const t2 = t + DECLICK_S + 0.001;
          const rem = (1 - u) * sch.effS;
          gOut.gain.setValueCurveAtTime(curve('out', u), t2, rem);
          gIn.gain.setValueCurveAtTime(curve('in', u), t2, rem);
          ev('curve-end', t2 + rem);
          at(finish, t2 + rem + 1.5);
        }, fail('resume'));
      }, 1000);
    };

    elOut.addEventListener(
      'timeupdate',
      () => {
        if (decided || done) return;
        const plan = crossfadePlan({
          durationS: dur(),
          currentTimeS: elOut.currentTime,
          nowS: c.currentTime,
          fadeMs: cfg.fadeMs,
          incomingDurationS: o.fxIn.exactS > 0 ? o.fxIn.exactS : null,
          marginS: cfg.marginS,
          latencyS: cfg.latencyS,
          guardS: cfg.guardS,
        });
        if (plan.kind === 'wait') return;
        decided = true;
        if (plan.kind === 'never') {
          ev('trigger', c.currentTime, `never: ${plan.reason}`);
          ev('error', c.currentTime, `no crossfade: ${plan.reason}`);
          return; // `ended` finishes the run
        }
        ev('trigger', c.currentTime, `eff ${plan.effS.toFixed(3)} s`);
        schedule = { startS: plan.startS, effS: plan.effS };
        if (!o.armed) elIn.src = o.inUrl;
        gOut.gain.setValueCurveAtTime(curve('out'), plan.startS, plan.effS);
        gIn.gain.setValueCurveAtTime(curve('in'), plan.startS, plan.effS);
        ev('curve-start', plan.startS);
        ev('curve-end', plan.startS + plan.effS);

        const playIn = () => {
          ev('play-in');
          elIn.play().catch(fail('play-in'));
        };
        if (cfg.control === 'delay-in-300') setTimeout(playIn, 300);
        else playIn();

        if (cfg.control === 'pause-out-400') {
          at(
            () => {
              elOut.pause();
              ev('pause', c.currentTime, 'control');
            },
            plan.startS + plan.effS - 0.4,
          );
        }

        if (cfg.mode === 'master') {
          at(
            () => {
              try {
                const end = planEndBehavior(
                  { endFadeMs: 2000, endChime: false, endFlash: false, endAction: 'stay' },
                  false,
                  c.currentTime,
                );
                runEndBehavior(end, ttGraphPorts(graph), {
                  scheduleChime: () => {},
                  onLog: () => {},
                });
                masterFade = { startS: end.startedAtS, lenS: end.fadeMs / 1000 };
                ev('master-fade', end.startedAtS);
              } catch (e) {
                fail('master fade')(e);
              }
            },
            plan.startS + 0.4 * plan.effS,
          );
          // The split stage's reason to exist: a volume write mid-fade must not throw.
          at(
            () => {
              try {
                applyVolume(ttGraphPorts(graph), 0.98, false);
                ev('volume');
              } catch (e) {
                fail('volume write')(e);
              }
            },
            plan.startS + 0.6 * plan.effS,
          );
        }

        if (cfg.mode === 'pause') at(() => holdAndResume(schedule!), plan.startS + plan.effS / 2);
        else at(finish, plan.startS + plan.effS + 1.5);
      },
      { signal: ac.signal },
    );

    const limitS = Math.max(30, (Number.isFinite(dur()) ? dur() : 30) + 20);
    at(() => {
      ev('error', c.currentTime, 'timeout');
      finish();
    }, c.currentTime + limitS);
  });
}

function traceOf(
  r: Rig,
  part: { outIdx: 0 | 1; inIdx: 0 | 1; fromS: number; toS: number; splitS?: number },
  events: TtRunEvent[],
  t: Pick<TtRunTrace, 'schedule' | 'masterFade'>,
  fxOut: TtS4bFixture,
  fxIn: TtS4bFixture,
): TtRunTrace {
  const sr = r.ctx.sampleRate;
  const inWin = (b: TtBlock) => b.f / sr >= part.fromS && b.f / sr <= part.toS;
  const split = part.splitS;
  const outBlocks = r.blocks[part.outIdx].filter(
    (b) => inWin(b) && (split === undefined || b.f / sr < split),
  );
  const inBlocks = r.blocks[part.inIdx].filter(
    (b) => inWin(b) && (split === undefined || b.f / sr >= split),
  );
  return {
    sampleRate: sr,
    out: outBlocks,
    in: inBlocks,
    master: r.blocks[2].filter(inWin),
    events: events.filter((e) => e.atS >= part.fromS - 0.5 && e.atS <= part.toS + 0.5),
    schedule: t.schedule,
    masterFade: t.masterFade,
    outTrailSilenceS: fxOut.trailSilenceS,
    inLeadSilenceS: fxIn.leadSilenceS,
  };
}

/** Run one configuration. A loop run returns two transitions. */
export async function run(cfg: TtS4bRunConfig): Promise<TtS4bRunResult[]> {
  if (!rig) throw new Error('unlock first — it needs a user gesture');
  const r = rig;
  resetRig(r);
  const fxA = fixtureOf(cfg.a);
  const fxB = cfg.b ? fixtureOf(cfg.b) : fxA;
  const urlA = URL.createObjectURL(fileOf(cfg.a));
  const urlB = cfg.mode === 'loop' || !cfg.b ? urlA : URL.createObjectURL(fileOf(cfg.b));
  const events: TtRunEvent[] = [];
  const ev: Ev = (kind, atS = r.ctx.currentTime, detail) =>
    events.push(detail === undefined ? { kind, atS } : { kind, atS, detail });
  const durations: TtDurationEvent[] = [];
  const ac = new AbortController();
  trackDurations(r, durations, ac.signal);
  const [elA, elB] = r.graph.elements;
  const [gA, gB] = r.graph.deckGains;
  const fromStart = cfg.fromStart || fxA.fromStart;

  try {
    const traces: TtRunTrace[] = [];
    elA.src = urlA;
    await loaded(elA);
    const durA = cfg.durationSource === 'exact' && fxA.exactS > 0 ? fxA.exactS : elA.duration;
    if (!fromStart) await seek(elA, Math.max(0, durA - (cfg.mode === 'zero' ? 4 : tailLeadS(cfg))));

    const armIn = cfg.mode === 'loop' || cfg.mode === 'zero' || cfg.armLeadS > 0;
    if (armIn && cfg.zero !== 'Z1') {
      elB.src = urlB;
      await loaded(elB).catch(() => ev('error', r.ctx.currentTime, 'incoming media error'));
    }

    const t0 = r.ctx.currentTime;
    gA.gain.setValueAtTime(1, t0);
    gB.gain.setValueAtTime(cfg.zero === 'Z2' ? 1 : 0, t0);
    await flushProbes(r);
    r.blocks.forEach((b) => (b.length = 0));
    ev('play-out');
    await elA.play();

    if (cfg.mode === 'zero') {
      const z = await zeroSwitch(r, cfg, { urlB, fxA }, ev);
      await flushProbes(r);
      traces.push(
        traceOf(
          r,
          {
            outIdx: 0,
            inIdx: z.inIdx,
            fromS: t0,
            toS: r.ctx.currentTime,
            ...(z.splitS === undefined ? {} : { splitS: z.splitS }),
          },
          events,
          { schedule: null, masterFade: null },
          fxA,
          fxB,
        ),
      );
    } else if (cfg.mode === 'loop') {
      const t1 = await transition(
        r,
        cfg,
        { outIdx: 0, inIdx: 1, inUrl: urlA, fxOut: fxA, fxIn: fxA, armed: true },
        ev,
      );
      elA.pause();
      await seek(elA, 0);
      await seek(elB, Math.max(0, durA - tailLeadS(cfg)));
      const t2 = await transition(
        r,
        cfg,
        { outIdx: 1, inIdx: 0, inUrl: urlA, fxOut: fxA, fxIn: fxA, armed: true },
        ev,
      );
      await flushProbes(r);
      traces.push(
        traceOf(r, { outIdx: 0, inIdx: 1, fromS: t1.fromS, toS: t1.toS }, events, t1, fxA, fxA),
      );
      traces.push(
        traceOf(r, { outIdx: 1, inIdx: 0, fromS: t2.fromS, toS: t2.toS }, events, t2, fxA, fxA),
      );
    } else {
      const t1 = await transition(
        r,
        cfg,
        { outIdx: 0, inIdx: 1, inUrl: urlB, fxOut: fxA, fxIn: fxB, armed: armIn },
        ev,
      );
      await flushProbes(r);
      traces.push(
        traceOf(r, { outIdx: 0, inIdx: 1, fromS: t0, toS: t1.toS }, events, t1, fxA, fxB),
      );
    }

    return traces.map((tr, i) => ({
      label: traces.length > 1 ? `${cfg.label} (${i + 1})` : cfg.label,
      cfg,
      metrics: measureRun(tr),
      durations,
      events: tr.events,
      browser: navigator.userAgent,
    }));
  } finally {
    ac.abort();
    resetRig(r);
    URL.revokeObjectURL(urlA);
    if (urlB !== urlA) URL.revokeObjectURL(urlB);
  }
}

/**
 * The 0 s case, three ways (docs/15 §S4): Z1 swaps `src` on the same deck at
 * `ended` (what the app does today), Z2 starts a pre-armed idle deck at
 * `ended`, Z3 triggers early and crosses over in 10 ms.
 */
function zeroSwitch(
  r: Rig,
  cfg: TtS4bRunConfig,
  o: { urlB: string; fxA: TtS4bFixture },
  ev: Ev,
): Promise<{ inIdx: 0 | 1; splitS?: number }> {
  const { ctx: c, graph } = r;
  const [elA, elB] = graph.elements;
  const [gA, gB] = graph.deckGains;
  return new Promise((resolve) => {
    const ac = new AbortController();
    const finishAfter = (s: number, res: { inIdx: 0 | 1; splitS?: number }) =>
      setTimeout(() => {
        ac.abort();
        resolve(res);
      }, s * 1000);
    const fail = (e: unknown) =>
      ev('error', c.currentTime, `play-in: ${e instanceof Error ? e.name : String(e)}`);

    if (cfg.zero === 'Z3') {
      elA.addEventListener(
        'timeupdate',
        () => {
          const remaining = elA.duration - elA.currentTime;
          if (!(remaining <= cfg.marginS)) return;
          ac.abort();
          const now = c.currentTime;
          ev('trigger', now, 'Z3');
          gA.gain.setValueCurveAtTime(curve('out'), now, 0.01);
          gB.gain.setValueCurveAtTime(curve('in'), now, 0.01);
          ev('curve-start', now);
          ev('curve-end', now + 0.01);
          ev('play-in');
          elB.play().catch(fail);
          elA.addEventListener('ended', () => ev('ended-out'), { once: true });
          finishAfter(remaining + 1.5, { inIdx: 1 });
        },
        { signal: ac.signal },
      );
      return;
    }

    elA.addEventListener(
      'ended',
      () => {
        ev('ended-out');
        if (cfg.zero === 'Z1') {
          const splitS = c.currentTime;
          ev('switch', splitS);
          elA.src = o.urlB;
          ev('play-in');
          elA.play().catch(fail);
          finishAfter(1.5, { inIdx: 0, splitS });
        } else {
          ev('play-in');
          elB.play().catch(fail);
          finishAfter(1.5, { inIdx: 1 });
        }
      },
      { signal: ac.signal, once: true },
    );
  });
}
