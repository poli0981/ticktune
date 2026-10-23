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
    holdAt: (t, v) => {
      value = v;
      calls.push(`hold:${v}@${t}`);
    },
    rampTo: (v, t) => {
      value = v;
      calls.push(`ramp:${v}@${t}`);
    },
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
    unload() {
      this.src = '';
      this.playing = false;
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

function harness(
  over: {
    ctxState?: 'suspended' | 'running';
    onLiveUrls?: (n: number) => void;
    /** Hold `delay()` until `flush()` — the crossfade's timers, under test control. */
    manualDelay?: boolean;
  } = {},
) {
  const decks = [fakeDeck(), fakeDeck()];
  const deckGains = [fakeGain(), fakeGain()];
  const userGain = fakeGain();
  const fadeGain = fakeGain();
  const created: string[] = [];
  const revoked: string[] = [];
  let urlSeq = 0;
  let ctxState: 'suspended' | 'running' = over.ctxState ?? 'running';
  let nowS = 10;
  const pending: Array<() => void> = [];

  const ports: TtAudioPorts = {
    ctx: {
      get nowS() {
        return nowS;
      },
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
    // Resolves immediately, so the resume timeout is instant in tests — or,
    // with `manualDelay`, when the test says so.
    delay: () => (over.manualDelay ? new Promise<void>((r) => pending.push(r)) : Promise.resolve()),
  };

  const logs: string[] = [];
  const statuses: string[] = [];
  const loops: number[] = [];
  const ended: number[] = [];
  const errors: string[] = [];
  const crossfades: string[] = [];
  const engine = new TtAudioEngine(ports, {
    onCrossfade: (id) => crossfades.push(id),
    onLog: (code) => logs.push(code),
    onLoop: (n) => loops.push(n),
    onEnded: () => ended.push(1),
    onStatus: (s) => statuses.push(s),
    onError: (id) => errors.push(id),
    ...(over.onLiveUrls ? { onLiveUrls: over.onLiveUrls } : {}),
  });

  return {
    engine,
    errors,
    crossfades,
    setNow: (t: number) => {
      nowS = t;
    },
    /** Let every timer the engine is waiting on fire, then settle. */
    flush: async () => {
      while (pending.length) pending.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    },
    ports,
    decks,
    deckGains,
    ended,
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
    for (let i = 0; i < 10; i++) h.engine.load(track(`t${i}`), 'hard');
    expect(h.decks[0]!.src).toBe('blob:url-10');
    expect(h.decks[1]!.src).toBe('');
  });

  it('releases the previous track’s URLs when it is replaced', () => {
    // docs/02 §4: a second import in Single mode REPLACES. Ten replacements
    // must not accumulate ten live URLs.
    const h = harness();
    for (let i = 0; i < 10; i++) h.engine.load(track(`t${i}`), 'hard');
    expect(h.engine.liveUrls).toBe(1);
    expect(h.revoked).toHaveLength(9);
  });

  it('keeps the previous track’s COVER when the next one loads — only its media goes', () => {
    // v1.1.1: load() released the cover with the media. The track was still in
    // the queue, so its info modal, the Setup preview and the cover backdrop
    // pointed at a revoked URL from the moment the playlist moved on.
    const h = harness();
    const cover = h.engine.acquireCoverUrl('a', new Uint8Array([1, 2, 3]), 'image/png');
    h.engine.load(track('a'), 'none');
    h.engine.load(track('b'), 'none');

    expect(h.revoked).not.toContain(cover);
    expect(h.revoked).toHaveLength(1); // a's media URL, and only that
    expect(h.engine.liveUrls).toBe(2); // a's cover + b's media

    h.engine.releaseTrack('a'); // the track is removed: now its cover goes
    expect(h.revoked).toContain(cover);
  });

  it('reports every change of the live-URL count — the canary the panel shows', () => {
    const counts: number[] = [];
    const h = harness({ onLiveUrls: (n: number) => counts.push(n) });
    h.engine.acquireCoverUrl('a', new Uint8Array([1]), 'image/png');
    h.engine.load(track('a'), 'none');
    h.engine.load(track('b'), 'none');
    h.engine.dispose();
    // b's media is acquired before a's goes (v2.0): a deck that is still
    // sounding keeps its file until it has been ramped out.
    expect(counts).toEqual([1, 2, 3, 2, 0]);
  });

  it('sets the hard loop on the element (docs/05 §2)', () => {
    const h = harness();
    h.engine.load(track(), 'hard');
    expect(h.decks[0]!.looped).toBe(true);
  });

  it('counts loops from a currentTime regression, starting at ×1', () => {
    const h = harness();
    h.engine.load(track(), 'hard');
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
    h.engine.load(track(), 'hard');
    // What browsers actually throw for an autoplay refusal.
    h.decks[0]!.play = () => Promise.reject(new DOMException('refused', 'NotAllowedError'));

    await h.engine.play();

    expect(h.logs).toEqual(['TT-PLY-100']);
    // Never a fake "playing": a silent app must not look like a working one.
    expect(h.engine.status).toBe('blocked');
    expect(h.statuses.at(-1)).toBe('blocked');
  });

  it('ignores an AbortError — a newer load replaced the source, not a refusal', async () => {
    // Rapid ⏭ or removing the playing track rejects the pending play() this way;
    // it used to log a false TT-PLY-100 and flash ▶ per skip.
    const h = harness();
    h.engine.load(track(), 'none');
    h.decks[0]!.play = () => Promise.reject(new DOMException('interrupted', 'AbortError'));

    await h.engine.play();

    expect(h.logs).toEqual([]);
    expect(h.engine.status).not.toBe('blocked');
  });

  it('a decode failure is an ERROR for the queue, not an autoplay complaint', async () => {
    /*
     * docs/02 §6. The element's `error` event fires before play() rejects; the
     * catch then overwrote `error` with `blocked`, logged TT-PLY-100, and the
     * session never heard about the track — a playlist stopped dead on it.
     */
    const h = harness();
    const t = track();
    h.engine.load(t, 'none');
    h.decks[0]!.play = () => {
      h.engine.onMediaError();
      return Promise.reject(new DOMException('decode', 'NotSupportedError'));
    };

    await h.engine.play();
    await Promise.resolve(); // onError is deferred one microtask

    expect(h.logs).toEqual(['TT-PLY-101']);
    expect(h.engine.status).toBe('error');
    expect(h.errors).toEqual([t.id]);
  });

  it('fails the track when play() rejects with a media error and no event fired', async () => {
    const h = harness();
    const t = track();
    h.engine.load(t, 'none');
    h.decks[0]!.play = () => Promise.reject(new DOMException('decode', 'NotSupportedError'));

    await h.engine.play();
    await Promise.resolve();

    expect(h.logs).toEqual(['TT-PLY-101']);
    expect(h.errors).toEqual([t.id]);
  });

  it('resumes a suspended context before playing', async () => {
    const h = harness({ ctxState: 'suspended' });
    h.engine.load(track(), 'hard');
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

    h.engine.load(track(), 'hard');
    await h.engine.play();

    expect(h.logs).toContain('TT-PLY-105');
    // The important half: playback was still ATTEMPTED rather than abandoned.
    expect(h.decks[0]!.plays).toBe(1);
  });

  it('reports the dead output once, not on every play', async () => {
    const h = harness({ ctxState: 'suspended' });
    h.ports.ctx.resume = vi.fn(() => new Promise<void>(() => {}));
    h.engine.load(track(), 'hard');

    await h.engine.play();
    await h.engine.play();
    await h.engine.play();

    // Repeating a fact about the machine on every play would bury the log.
    expect(h.logs.filter((c) => c === 'TT-PLY-105')).toHaveLength(1);
  });

  it('logs TT-PLY-101 and stops on a media error, leaving the timer alone', () => {
    const h = harness();
    h.engine.load(track(), 'hard');
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
    h.engine.load(noFile, 'hard');
    expect(h.logs).toEqual(['TT-PLY-101']);
  });

  it('silences both deck gains on stop', () => {
    const h = harness();
    h.engine.load(track(), 'hard');
    h.engine.stop();
    expect(h.deckGains[0]!.value).toBe(0);
    expect(h.deckGains[1]!.value).toBe(0);
    expect(h.deckGains[0]!.calls.some((c) => c.startsWith('cancel@'))).toBe(true);
  });

  it('dispose() releases every URL', () => {
    const h = harness();
    h.engine.load(track(), 'hard');
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

describe('crossfade — docs/05 §2, spike S4b', () => {
  /** A 30 s track: armed from 10 s left (8 s lead + 2 s fade), fading at 2.3 s left. */
  const long = (id: string): TtTrack => ({ ...track(id), durationMs: 30_000 });

  async function playing(h: ReturnType<typeof harness>, loop: 'none' | 'crossfade' = 'none') {
    h.engine.setCrossfade(2_000);
    h.engine.load(long('a'), loop);
    await h.engine.play();
    (h.decks[0] as { durationS: number }).durationS = 30;
  }

  function at(h: ReturnType<typeof harness>, deck: 0 | 1, t: number) {
    (h.decks[deck] as { currentTimeS: number }).currentTimeS = t;
    h.engine.onTimeUpdate(deck);
  }

  it('arms the next track on the idle deck ahead of the trigger, silent', async () => {
    const h = harness({ manualDelay: true });
    await playing(h);
    h.engine.setNext(long('b'));

    at(h, 0, 5); // 25 s left: too early
    expect(h.decks[1]!.src).toBe('');

    at(h, 0, 21); // 9 s left
    expect(h.decks[1]!.src).not.toBe('');
    expect(h.decks[1]!.playing).toBe(false);
    expect(h.deckGains[1]!.value).toBe(0);
  });

  it('starts at fade + margin before the end: both curves on the audio clock, the next deck plays', async () => {
    const h = harness({ manualDelay: true });
    await playing(h);
    h.engine.setNext(long('b'));

    at(h, 0, 27.6); // 2.4 s left > 2 s + 0.3 s margin
    expect(h.decks[1]!.plays).toBe(0);
    at(h, 0, 27.8); // 2.2 s left: fire
    expect(h.deckGains[0]!.calls).toContain('curve@10+2');
    expect(h.deckGains[1]!.calls).toContain('curve@10+2');
    expect(h.decks[1]!.plays).toBe(1);
  });

  it('becomes real when the next deck plays — the queue hears it exactly once', async () => {
    const h = harness({ manualDelay: true });
    await playing(h);
    h.engine.setNext(long('b'));
    at(h, 0, 27.8);
    await Promise.resolve();

    expect(h.crossfades).toEqual(['b']);
    // Later reports from the fading deck change nothing: its clock and its
    // `ended` are no longer anyone's. Counting that `ended` skipped a track.
    at(h, 0, 29.9);
    h.engine.onEnded(0);
    expect(h.ended).toEqual([]);
    expect(h.crossfades).toEqual(['b']);
    expect(h.engine.status).toBe('playing');
  });

  it('finishes: the outgoing deck stops, empties and gives its file back', async () => {
    const h = harness({ manualDelay: true });
    await playing(h);
    h.engine.setNext(long('b'));
    at(h, 0, 27.8);
    await Promise.resolve();
    const aUrl = h.decks[0]!.src;

    h.setNow(12.05);
    await h.flush();

    expect(h.decks[0]!.src).toBe('');
    expect(h.revoked).toContain(aUrl);
    expect(h.engine.liveUrls).toBe(1);
    expect(h.engine.crossfading).toBe(false);
  });

  it('a next deck that will not play: the outgoing plays out, no advance, TT-PLY-108', async () => {
    const h = harness({ manualDelay: true });
    await playing(h);
    h.engine.setNext(long('b'));
    h.decks[1]!.play = () => Promise.reject(new DOMException('decode', 'NotSupportedError'));
    at(h, 0, 27.8);
    await Promise.resolve();
    await Promise.resolve();

    expect(h.crossfades).toEqual([]);
    expect(h.logs).toEqual(['TT-PLY-108']);
    expect(h.deckGains[0]!.calls.at(-1)).toMatch(/^ramp:1@/);
    // No second attempt on this track; its own `ended` makes the one advance.
    at(h, 0, 28.5);
    h.engine.onEnded(0);
    expect(h.ended).toEqual([1]);
  });

  it('a pause mid-fade holds both curves and ramps them out; play resumes them from there', async () => {
    const h = harness({ manualDelay: true });
    await playing(h);
    h.engine.setNext(long('b'));
    at(h, 0, 27.8);
    await Promise.resolve();

    h.setNow(11); // halfway
    h.engine.pause();
    expect(h.engine.status).toBe('paused');
    for (const g of h.deckGains) {
      expect(g.calls.some((c) => c.startsWith('hold:') && c.endsWith('@11'))).toBe(true);
      expect(g.calls.at(-1)).toBe('ramp:0@11.015');
    }
    await h.flush();
    expect(h.decks[0]!.playing).toBe(false);
    expect(h.decks[1]!.playing).toBe(false);

    h.setNow(20);
    await h.engine.play();
    expect(h.engine.status).toBe('playing');
    // The rest of the same curve — one second of the two — not a fresh one,
    // starting just after the 15 ms ramp back up.
    for (const g of h.deckGains) {
      const [, start, len] = /^curve@([\d.]+)\+([\d.]+)$/.exec(g.calls.at(-1) ?? '') ?? [];
      expect(Number(start)).toBeCloseTo(20.016, 6);
      expect(Number(len)).toBeCloseTo(1, 6);
    }
    expect(h.crossfades).toEqual(['b']);
  });

  it('a load mid-fade (⏭) takes the outgoing deck and ramps the incoming one out', async () => {
    const h = harness({ manualDelay: true });
    await playing(h);
    h.engine.setNext(long('b'));
    at(h, 0, 27.8);
    await Promise.resolve();

    h.engine.load(long('c'), 'none');
    expect(h.engine.crossfading).toBe(false);
    expect(h.deckGains[1]!.calls.at(-1)).toBe('ramp:0@10.015');
    const cUrl = h.decks[0]!.src;
    await h.flush();
    expect(h.decks[0]!.src).toBe(cUrl);
    expect(h.decks[1]!.src).toBe(''); // b, ramped out and given back
    expect(h.crossfades).toEqual(['b']);
  });

  it('a Single loop crossfade fades the track into itself and counts the pass', async () => {
    const h = harness({ manualDelay: true });
    await playing(h, 'crossfade');
    expect(h.decks[0]!.looped).toBe(false); // the element must reach its end

    at(h, 0, 27.8);
    await Promise.resolve();
    expect(h.decks[1]!.src).toBe(h.decks[0]!.src); // one file, one URL, two decks
    expect(h.loops).toEqual([2]);
    expect(h.crossfades).toEqual([]); // not the queue's business
    expect(h.engine.liveUrls).toBe(1);
  });

  it('a 0 s fade is a hard cut at `ended` — onto the armed deck (Z2)', async () => {
    const h = harness({ manualDelay: true });
    await playing(h);
    h.engine.setCrossfade(0);
    h.engine.setNext(long('b'));
    at(h, 0, 25); // 5 s left: armed, and no curve
    const armed = h.decks[1]!.src;
    expect(armed).not.toBe('');
    expect(h.deckGains[0]!.calls.some((c) => c.startsWith('curve@'))).toBe(false);

    h.engine.onEnded(0);
    expect(h.ended).toEqual([1]);
    h.engine.load(long('b'), 'none'); // what the shell does on `ended`
    await h.engine.play();
    expect(h.decks[1]!.src).toBe(armed); // not re-sourced: S4b's 11–24 ms switch
    expect(h.decks[1]!.plays).toBe(1);
  });

  it('a length nobody knows: no crossfade, TT-PLY-106 once, and `ended` advances', async () => {
    const h = harness({ manualDelay: true });
    h.engine.setCrossfade(2_000);
    h.engine.load({ ...track('a'), durationMs: null }, 'none');
    await h.engine.play();
    (h.decks[0] as { durationS: number }).durationS = Number.NaN;
    h.engine.setNext(long('b'));

    at(h, 0, 1);
    at(h, 0, 2);
    expect(h.logs).toEqual(['TT-PLY-106']);
    expect(h.decks[1]!.plays).toBe(0);
    h.engine.onEnded(0);
    expect(h.ended).toEqual([1]);
  });

  it('the trigger trusts the importer’s length over the element’s estimate', async () => {
    // S4b: on header-less VBR the element's estimate was so far off that no
    // fade "fit"; on raw ADTS it fired 0.2–0.5 s early.
    const h = harness({ manualDelay: true });
    await playing(h);
    (h.decks[0] as { durationS: number }).durationS = 31.5; // the element's guess
    h.engine.setNext(long('b'));
    at(h, 0, 27.8); // 2.2 s left by the TRUE length, 3.7 by the guess
    expect(h.decks[1]!.plays).toBe(1);
  });

  it('a next that changes before the trigger gives the armed deck back', async () => {
    const h = harness({ manualDelay: true });
    await playing(h);
    h.engine.setNext(long('b'));
    at(h, 0, 21);
    const bUrl = h.decks[1]!.src;

    h.engine.setNext(long('c'));
    expect(h.decks[1]!.src).toBe('');
    expect(h.revoked).toContain(bUrl);
  });

  it('a pause before the incoming deck has started abandons the fade — the outgoing track is what pauses', async () => {
    const h = harness({ manualDelay: true });
    await playing(h);
    h.engine.setNext(long('b'));
    at(h, 0, 27.8); // the fade starts; b's play() has not resolved yet
    h.engine.pause();

    expect(h.engine.status).toBe('paused');
    expect(h.engine.crossfading).toBe(false);
    expect(h.deckGains[0]!.calls.at(-1)).toBe('set:1@10');
    expect(h.deckGains[1]!.calls.at(-1)).toBe('set:0@10');
    expect(h.decks[0]!.playing).toBe(false);
    expect(h.decks[1]!.playing).toBe(false);
    // b's play() resolving afterwards must not make the abandoned fade real.
    await Promise.resolve();
    expect(h.crossfades).toEqual([]);
  });

  it('a resume the browser refuses mid-fade leaves the run paused, and says so (TT-PLY-100)', async () => {
    const h = harness({ manualDelay: true });
    await playing(h);
    h.engine.setNext(long('b'));
    at(h, 0, 27.8);
    await Promise.resolve();
    h.setNow(11);
    h.engine.pause();
    await h.flush();

    const refuse = () => Promise.reject(new DOMException('no gesture', 'NotAllowedError'));
    h.decks[0]!.play = refuse;
    h.decks[1]!.play = refuse;
    await h.engine.play();

    expect(h.engine.status).toBe('paused');
    expect(h.logs).toEqual(['TT-PLY-100']);
  });

  it('a resume after the last sample of a fade finishes it — a zero-length curve throws RangeError', async () => {
    const h = harness({ manualDelay: true });
    await playing(h);
    h.engine.setNext(long('b'));
    at(h, 0, 27.8); // curves from 10 s, 2 s long
    await Promise.resolve();
    h.setNow(12); // the end of the curve, before its finish timer has fired
    h.engine.pause();
    await h.flush();
    const before = h.deckGains.map((g) => g.calls.length);

    h.setNow(20);
    await h.engine.play();

    expect(h.engine.status).toBe('playing');
    expect(h.engine.crossfading).toBe(false);
    expect(h.decks[0]!.src).toBe(''); // the outgoing deck gave its file back
    for (const [i, g] of h.deckGains.entries()) {
      expect(g.calls.slice(before[i]).filter((c) => c.startsWith('curve@'))).toEqual([]);
    }
  });

  it('a Single loop crossfade that could not fade loops by hand at `ended`', async () => {
    const h = harness({ manualDelay: true });
    h.engine.setCrossfade(2_000);
    h.engine.load({ ...track('a'), durationMs: null }, 'crossfade');
    await h.engine.play();
    // No length anywhere, so no fade: the element plays to its end instead.
    (h.decks[0] as { durationS: number }).durationS = Number.NaN;
    at(h, 0, 1);
    h.engine.onEnded(0);

    expect(h.loops).toEqual([2]);
    expect(h.ended).toEqual([]); // the same track again — not the queue's advance
    expect(h.decks[0]!.plays).toBe(2);
    expect(h.engine.status).toBe('playing');
  });
});

describe('what the playback store reads back — docs/05 §2', () => {
  it('reads position and length from the deck that is current — the incoming one after a fade', async () => {
    const h = harness({ manualDelay: true });
    h.engine.setCrossfade(2_000);
    h.engine.load({ ...track('a'), durationMs: 30_000 }, 'none');
    await h.engine.play();
    (h.decks[0] as { durationS: number }).durationS = 30;
    h.engine.setNext({ ...track('b'), durationMs: 30_000 });
    (h.decks[0] as { currentTimeS: number }).currentTimeS = 27.8;
    h.engine.onTimeUpdate(0);
    await Promise.resolve();

    Object.assign(h.decks[1]!, { currentTimeS: 1.5, durationS: 30 });
    expect(h.engine.positionMs).toBe(1_500);
    expect(h.engine.durationMs).toBe(30_000);
  });

  it('reports no length — never NaN — until the element knows one', () => {
    // The store falls back to the importer's length with `??`, which NaN defeats.
    const h = harness();
    h.engine.load(track('a'), 'none');
    for (const unsettled of [Number.NaN, 0, Number.POSITIVE_INFINITY]) {
      (h.decks[0] as { durationS: number }).durationS = unsettled;
      expect(h.engine.durationMs).toBeNull();
    }
    (h.decks[0] as { durationS: number }).durationS = 212.3456;
    expect(h.engine.durationMs).toBe(212_346);
  });

  it('holds the configured fade to 0–5 s, and anything unreadable to 0', () => {
    const h = harness();
    h.engine.setCrossfade(9_999);
    expect(h.engine.crossfadeMs).toBe(5_000);
    h.engine.setCrossfade(-1);
    expect(h.engine.crossfadeMs).toBe(0);
    h.engine.setCrossfade(Number.NaN);
    expect(h.engine.crossfadeMs).toBe(0);
  });

  it('switches the loop of the track already playing — and a 0 s crossfade loop is a hard one (Z2)', () => {
    const h = harness();
    h.engine.setCrossfade(2_000);
    h.engine.load(track('a'), 'hard');
    expect(h.decks[0]!.looped).toBe(true);
    h.engine.setLoopMode('crossfade');
    expect(h.decks[0]!.looped).toBe(false); // the element must reach its end to fade
    h.engine.setCrossfade(0);
    expect(h.decks[0]!.looped).toBe(true);
  });
});
