import { describe, expect, it, vi } from 'vitest';
import { TtAudioEngine } from '../../src/app/engine/audio/tt-audio-engine';
import { applyVolume, restoreFadeGain } from '../../src/app/engine/audio/tt-audio-graph';
import { equalPowerOut, equalPowerOutCurve } from '../../src/app/engine/audio/tt-gain-curve';
import { detectWrap } from '../../src/app/engine/audio/tt-loop-count';
import { TtUrlLedger, urlKey } from '../../src/app/engine/audio/tt-object-urls';
import type { TtAudioPorts, TtGainPort, TtMediaPort } from '../../src/app/engine/audio/types';
import type { TtTrack } from '../../src/app/engine/importer/types';

/** docs/05 §1-§3 — the audio decisions, against fakes rather than Web Audio. */

function fakeGain(): TtGainPort & { calls: string[] } {
  const calls: string[] = [];
  let value = 1;
  return {
    calls,
    get value() {
      return value;
    },
    setValue: (v, t) => {
      value = v;
      calls.push(`set:${v}@${t}`);
    },
    setCurve: (_v, t, d) => calls.push(`curve@${t}+${d}`),
    cancelScheduled: (t) => calls.push(`cancel@${t}`),
  };
}

function fakeDeck(): TtMediaPort & {
  src: string;
  playing: boolean;
  looped: boolean;
  plays: number;
} {
  return {
    src: '',
    playing: false,
    looped: false,
    plays: 0,
    currentTimeS: 0,
    durationS: 5,
    setSrc(url: string) {
      this.src = url;
    },
    async play() {
      this.plays++;
      this.playing = true;
    },
    pause() {
      this.playing = false;
    },
    setLoop(l: boolean) {
      this.looped = l;
    },
  } as TtMediaPort & { src: string; playing: boolean; looped: boolean; plays: number };
}

function harness(over: { ctxState?: 'suspended' | 'running' } = {}) {
  const decks = [fakeDeck(), fakeDeck()];
  const deckGains = [fakeGain(), fakeGain()];
  const userGain = fakeGain();
  const fadeGain = fakeGain();
  const created: string[] = [];
  const revoked: string[] = [];
  let urlSeq = 0;
  let ctxState: 'suspended' | 'running' = over.ctxState ?? 'running';

  const ports: TtAudioPorts = {
    ctx: {
      nowS: 10,
      get state() {
        return ctxState;
      },
      resume: vi.fn(async () => {
        ctxState = 'running';
      }),
    },
    deck: (id) => decks[id]!,
    deckGain: (id) => deckGains[id]!,
    userGain,
    fadeGain,
    createUrl: () => {
      const u = `blob:url-${++urlSeq}`;
      created.push(u);
      return u;
    },
    revokeUrl: (u) => revoked.push(u),
    // Resolves immediately, so the resume timeout is instant in tests.
    delay: () => Promise.resolve(),
  };

  const logs: string[] = [];
  const statuses: string[] = [];
  const loops: number[] = [];
  const engine = new TtAudioEngine(ports, {
    onLog: (code) => logs.push(code),
    onLoop: (n) => loops.push(n),
    onStatus: (s) => statuses.push(s),
  });

  return {
    engine,
    ports,
    decks,
    deckGains,
    userGain,
    fadeGain,
    created,
    revoked,
    logs,
    statuses,
    loops,
  };
}

const track = (id = 't1'): TtTrack =>
  ({
    id,
    source: 'local',
    status: 'ok',
    title: 'x',
    artist: 'y',
    durationMs: 5_000,
    file: new File([new Uint8Array(4)], 'x.mp3'),
    addedAt: 0,
  }) as TtTrack;

describe('equal-power curve (docs/05 §2)', () => {
  it('runs 1 → 0 with the half-power midpoint', () => {
    expect(equalPowerOut(0)).toBeCloseTo(1, 6);
    expect(equalPowerOut(0.5)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(equalPowerOut(1)).toBeCloseTo(0, 6);
  });

  it('keeps out² + in² = 1 across the curve — the "equal power" property', () => {
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const out = equalPowerOut(t);
      const inn = Math.sin((t * Math.PI) / 2);
      expect(out * out + inn * inn).toBeCloseTo(1, 6);
    }
  });

  it('clamps out-of-range input rather than producing a negative gain', () => {
    expect(equalPowerOut(-1)).toBeCloseTo(1, 6);
    expect(equalPowerOut(2)).toBeCloseTo(0, 6);
  });

  it('samples a monotonically decreasing curve', () => {
    const c = equalPowerOutCurve(16);
    expect(c).toHaveLength(16);
    expect(c[0]).toBeCloseTo(1, 6);
    expect(c[15]).toBeCloseTo(0, 6);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeLessThan(c[i - 1]!);
  });
});

describe('detectWrap (docs/05 §2 — loop fires no `ended`)', () => {
  it('counts a wrap on a 5 s file', () => {
    expect(detectWrap(4.9, 0.1, 5)).toBe(true);
  });

  it('does NOT count a user seeking backwards', () => {
    // A scrub back of 2 s on a 5 s file is under half the duration.
    expect(detectWrap(4.9, 2.9, 5)).toBe(false);
  });

  it('does not count forward movement or jitter', () => {
    expect(detectWrap(1.0, 1.25, 5)).toBe(false);
    expect(detectWrap(1.0, 0.99, 5)).toBe(false);
  });

  it('refuses to decide on an unsettled duration', () => {
    // VBR MP3s whose duration the browser revises mid-playback (docs/05 §2).
    expect(detectWrap(4.9, 0.1, Number.NaN)).toBe(false);
    expect(detectWrap(4.9, 0.1, Number.POSITIVE_INFINITY)).toBe(false);
    expect(detectWrap(4.9, 0.1, 0)).toBe(false);
  });
});

describe('TtUrlLedger (docs/05 §3)', () => {
  it('is idempotent per key — ten acquires, one URL', () => {
    const create = vi.fn(() => 'blob:x');
    const ledger = new TtUrlLedger(create, vi.fn());
    const f = new File([new Uint8Array(1)], 'a.mp3');

    for (let i = 0; i < 10; i++) ledger.acquire('media:t1', f);
    expect(create).toHaveBeenCalledTimes(1);
    expect(ledger.size).toBe(1);
  });

  it('keys media per TRACK, so a shared file across decks is one URL', () => {
    // The crossfade loop style loads the same file on both decks. Keying per
    // deck would create two URLs for one file and break the §3 bound.
    expect(urlKey('t1', 'media')).toBe('media:t1');
    expect(urlKey('t1', 'cover')).toBe('cover:t1');
  });

  it('tolerates a double release', () => {
    const revoke = vi.fn();
    const ledger = new TtUrlLedger(() => 'blob:x', revoke);
    ledger.acquire('media:t1', new File([], 'a.mp3'));
    ledger.release('media:t1');
    ledger.release('media:t1');
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(ledger.size).toBe(0);
  });

  it('holds the queueLength + 2 bound under random add/remove', () => {
    let n = 0;
    const ledger = new TtUrlLedger(() => `blob:${++n}`, vi.fn());
    const f = new File([], 'a.mp3');
    const ids: string[] = [];

    for (let i = 0; i < 60; i++) {
      const id = `t${i % 12}`;
      if (i % 3 === 0) {
        ledger.releaseTrack(id);
      } else {
        ledger.acquire(urlKey(id, 'media'), f);
        ledger.acquire(urlKey(id, 'cover'), f);
        if (!ids.includes(id)) ids.push(id);
      }
      // 12 tracks: ≤ 12 covers + ≤ 2 media is the §3 arithmetic. Media URLs are
      // released with their track, so the live set never runs away.
      expect(ledger.size).toBeLessThanOrEqual(24);
    }

    ledger.releaseAll();
    expect(ledger.size).toBe(0);
    expect(ledger.withinBound(0)).toBe(true);
  });
});

describe('TtAudioEngine', () => {
  it('swaps .src on the SAME deck rather than making a new source node', () => {
    // createMediaElementSource may be called once per element, so the engine
    // must reuse the decks. Ten loads, still deck 0, ten src writes.
    const h = harness();
    for (let i = 0; i < 10; i++) h.engine.load(track(`t${i}`), true);
    expect(h.decks[0]!.src).toBe('blob:url-10');
    expect(h.decks[1]!.src).toBe('');
  });

  it('releases the previous track’s URLs when it is replaced', () => {
    // docs/02 §4: a second import in Single mode REPLACES. Ten replacements
    // must not accumulate ten live URLs.
    const h = harness();
    for (let i = 0; i < 10; i++) h.engine.load(track(`t${i}`), true);
    expect(h.engine.liveUrls).toBe(1);
    expect(h.revoked).toHaveLength(9);
  });

  it('sets the hard loop on the element (docs/05 §2)', () => {
    const h = harness();
    h.engine.load(track(), true);
    expect(h.decks[0]!.looped).toBe(true);
  });

  it('counts loops from a currentTime regression, starting at ×1', () => {
    const h = harness();
    h.engine.load(track(), true);
    expect(h.engine.loops).toBe(1);

    const deck = h.decks[0]!;
    for (const t of [1, 2, 3, 4, 4.9]) {
      (deck as { currentTimeS: number }).currentTimeS = t;
      h.engine.onTimeUpdate();
    }
    expect(h.engine.loops).toBe(1);

    (deck as { currentTimeS: number }).currentTimeS = 0.1; // wrapped
    h.engine.onTimeUpdate();
    expect(h.engine.loops).toBe(2);
    expect(h.loops).toEqual([2]);
  });

  it('reports TT-PLY-100 and stays "blocked" when play() is refused', async () => {
    const h = harness();
    h.engine.load(track(), true);
    h.decks[0]!.play = () => Promise.reject(new Error('NotAllowedError'));

    await h.engine.play();

    expect(h.logs).toEqual(['TT-PLY-100']);
    // Never a fake "playing": a silent app must not look like a working one.
    expect(h.engine.status).toBe('blocked');
    expect(h.statuses.at(-1)).toBe('blocked');
  });

  it('resumes a suspended context before playing', async () => {
    const h = harness({ ctxState: 'suspended' });
    h.engine.load(track(), true);
    await h.engine.play();

    expect(h.ports.ctx.resume).toHaveBeenCalled();
    expect(h.engine.status).toBe('playing');
  });

  it('unlock() is idempotent and does not re-resume a running context', async () => {
    const h = harness({ ctxState: 'running' });
    await h.engine.unlock();
    await h.engine.unlock();
    expect(h.ports.ctx.resume).not.toHaveBeenCalled();
  });

  it('survives a resume() that rejects', async () => {
    const h = harness({ ctxState: 'suspended' });
    h.ports.ctx.resume = vi.fn(() => Promise.reject(new Error('nope')));
    await expect(h.engine.unlock()).resolves.toBeUndefined();
    expect(h.logs).toEqual(['TT-PLY-105']);
  });

  it('does NOT hang when resume() never settles, and reports TT-PLY-105', async () => {
    // Measured on CI 2026-07-21: in headless Firefox with no audio output
    // device, `resume()` neither resolves nor rejects. With a bare await, this
    // meant play() never ran — the app sat there having "started", with no
    // sound, no error and nothing in the log. A desktop with a disabled sound
    // device reaches the same state.
    const h = harness({ ctxState: 'suspended' });
    h.ports.ctx.resume = vi.fn(() => new Promise<void>(() => {}));

    h.engine.load(track(), true);
    await h.engine.play();

    expect(h.logs).toContain('TT-PLY-105');
    // The important half: playback was still ATTEMPTED rather than abandoned.
    expect(h.decks[0]!.plays).toBe(1);
  });

  it('reports the dead output once, not on every play', async () => {
    const h = harness({ ctxState: 'suspended' });
    h.ports.ctx.resume = vi.fn(() => new Promise<void>(() => {}));
    h.engine.load(track(), true);

    await h.engine.play();
    await h.engine.play();
    await h.engine.play();

    // Repeating a fact about the machine on every play would bury the log.
    expect(h.logs.filter((c) => c === 'TT-PLY-105')).toHaveLength(1);
  });

  it('logs TT-PLY-101 and stops on a media error, leaving the timer alone', () => {
    const h = harness();
    h.engine.load(track(), true);
    h.engine.onMediaError();

    expect(h.logs).toEqual(['TT-PLY-101']);
    expect(h.engine.status).toBe('error');
    expect(h.decks[0]!.playing).toBe(false);
  });

  it('treats a track with no file as a playback error, not a crash', () => {
    const h = harness();
    // Omitted, not set to undefined — exactOptionalPropertyTypes (docs/12 §2)
    // makes those different types, and absence is what a YouTube track has.
    const noFile: TtTrack = { ...track() };
    delete noFile.file;
    h.engine.load(noFile, true);
    expect(h.logs).toEqual(['TT-PLY-101']);
  });

  it('silences both deck gains on stop', () => {
    const h = harness();
    h.engine.load(track(), true);
    h.engine.stop();
    expect(h.deckGains[0]!.value).toBe(0);
    expect(h.deckGains[1]!.value).toBe(0);
    expect(h.deckGains[0]!.calls.some((c) => c.startsWith('cancel@'))).toBe(true);
  });

  it('dispose() releases every URL', () => {
    const h = harness();
    h.engine.load(track(), true);
    h.engine.dispose();
    expect(h.engine.liveUrls).toBe(0);
  });
});

describe('the split master stage (docs/05 §1, D-5)', () => {
  it('volume writes touch userGain and never fadeGain', () => {
    // The crash this split exists to prevent: an automation write inside an
    // active setValueCurveAtTime window throws NotSupportedError.
    const h = harness();
    h.fadeGain.setCurve(new Float32Array([1, 0]), 10, 2);
    const fadeCallsBefore = [...h.fadeGain.calls];

    applyVolume(h.ports, 0.4, false);
    h.engine.setVolume(0.9, false);

    expect(h.userGain.value).toBe(0.9);
    expect(h.fadeGain.calls).toEqual(fadeCallsBefore);
  });

  it('mute is a userGain write, so it is safe mid-fade too', () => {
    const h = harness();
    applyVolume(h.ports, 0.8, true);
    expect(h.userGain.value).toBe(0);
  });

  it('clamps volume into range', () => {
    const h = harness();
    applyVolume(h.ports, 5, false);
    expect(h.userGain.value).toBe(1);
    applyVolume(h.ports, -2, false);
    expect(h.userGain.value).toBe(0);
  });

  it('restoreFadeGain cancels before writing, so a restart is not silent', () => {
    const h = harness();
    h.fadeGain.setCurve(new Float32Array([1, 0]), 10, 2);
    restoreFadeGain(h.ports);

    expect(h.fadeGain.value).toBe(1);
    const cancelIdx = h.fadeGain.calls.findIndex((c) => c.startsWith('cancel@'));
    const setIdx = h.fadeGain.calls.lastIndexOf('set:1@10');
    expect(cancelIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeGreaterThan(cancelIdx);
  });
});
