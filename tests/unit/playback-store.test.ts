import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TtTrack } from '../../src/app/engine/importer/types';
import type { TtAudioEvents } from '../../src/app/engine/audio/types';
// Type-only, so these do NOT pin a module instance: each test re-imports the
// stores after `vi.resetModules()` to get its own copy of the singletons.
import type * as LogMod from '../../src/app/engine/log/tt-log';
import type * as PlaybackMod from '../../src/app/state/playback.svelte';
import type * as SettingsMod from '../../src/app/state/settings.svelte';

/**
 * The playback store — the docs/12 §3.3 seam between the shell and the audio
 * driver.
 *
 * **This tier exists because neither side can fail these.** The engine has
 * always faded, paused and crossfaded correctly, and is unit-tested doing so;
 * the shell only calls actions. What sits between them is ordering and
 * ownership, and that is where v1.1's review found the defect at the top of
 * this file: the end-of-run pause was fire-and-forget, so with `endAction`
 * restart or loop — the next run starting 400 ms after zero — the previous
 * run's timer paused the NEW run's audio at `endFadeMs`, and the countdown kept
 * going in silence with ▶ on the transport.
 *
 * The driver is faked — it owns `AudioContext` and two media elements, which
 * Node does not have (docs/13 §1). The engine calls are recorded, and the
 * events the real driver would send are fired by hand.
 */

const track = (over: Partial<TtTrack> = {}): TtTrack => ({
  id: 'track-1',
  source: 'local',
  status: 'ok',
  title: 'x',
  artist: 'y',
  durationMs: 180_000,
  addedAt: 0,
  ...over,
});

/** One per `new TtAudioDriver`, so laziness and a rebuild are observable. */
class FakeDriver {
  readonly events: TtAudioEvents;
  readonly engine = {
    load: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    stop: vi.fn(),
    setVolume: vi.fn(),
    setCrossfade: vi.fn(),
    setLoopMode: vi.fn(),
    setNext: vi.fn(),
    acquireCoverUrl: vi.fn((): string => 'blob:cover'),
    releaseTrack: vi.fn(),
    positionMs: 0,
    durationMs: null as number | null,
  };
  readonly unlock = vi.fn(() => Promise.resolve());
  readonly refresh = vi.fn();
  readonly resetFade = vi.fn();
  readonly dispose = vi.fn();
  readonly readFrequencyData = vi.fn();
  readonly readTimeDomainData = vi.fn();
  readonly runEndBehavior = vi.fn(() => ({ fadeMs: 2_000, flash: true, action: 'restart' }));
  peakRms = 0.25;
  binCount = 1024;

  constructor(events: TtAudioEvents) {
    this.events = events;
    drivers.push(this);
  }
}

let drivers: FakeDriver[];

vi.mock('../../src/app/engine/audio/tt-audio-driver', () => ({ TtAudioDriver: FakeDriver }));

let playback: typeof PlaybackMod.playback;
let settings: typeof SettingsMod.settings;
let ttLog: typeof LogMod.ttLog;

/** The driver the store built; fails the test if it built none. */
const driver = (): FakeDriver => {
  const d = drivers.at(-1);
  if (!d) throw new Error('the store has not built its driver');
  return d;
};

beforeEach(async () => {
  vi.resetModules();
  drivers = [];
  ({ playback } = await import('../../src/app/state/playback.svelte'));
  ({ settings } = await import('../../src/app/state/settings.svelte'));
  ({ ttLog } = await import('../../src/app/engine/log/tt-log'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the driver is built on the first action that needs one — never at import', () => {
  it('builds nothing for a page view that never plays', () => {
    playback.pause();
    playback.stop();
    playback.applyVolume();
    playback.applyCrossfade();
    playback.setNext(track());
    playback.releaseTrack('track-1');
    playback.tick();

    expect(drivers).toHaveLength(0);
    expect(playback.binCount).toBe(0);
    expect(playback.peakRms).toBe(0);
    expect(playback.status).toBe('idle');
  });

  it('answers a timer-only run (?ttdebug=1) with no end behaviour at all', () => {
    expect(playback.runEndBehavior()).toBeNull();
    expect(drivers).toHaveLength(0);
  });

  it('hands the stored crossfade to the engine the moment it exists', async () => {
    settings.current.crossfadeMs = 3_500;
    await playback.unlock();

    expect(drivers).toHaveLength(1);
    expect(driver().unlock).toHaveBeenCalledOnce();
    expect(driver().engine.setCrossfade).toHaveBeenCalledWith(3_500);
  });

  it('builds it once, however many actions follow', async () => {
    await playback.load(track(), false);
    await playback.play();
    await playback.unlock();

    expect(drivers).toHaveLength(1);
  });
});

describe('the end-of-run pause belongs to the run that scheduled it', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('pauses only after the fade has finished — never at its first sample', async () => {
    await playback.load(track(), false);
    expect(playback.runEndBehavior()).toEqual({ flash: true, action: 'restart' });

    vi.advanceTimersByTime(1_999);
    expect(driver().engine.pause).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(driver().engine.pause).toHaveBeenCalledOnce();
  });

  it('passes the stored End Behavior and the mute to the driver', async () => {
    Object.assign(settings.current, {
      endFadeMs: 0,
      endChime: false,
      endFlash: true,
      endAction: 'loop',
      muted: true,
    });
    await playback.load(track(), false);
    playback.runEndBehavior();

    expect(driver().runEndBehavior).toHaveBeenCalledWith(
      { endFadeMs: 0, endChime: false, endFlash: true, endAction: 'loop' },
      true,
    );
  });

  /** Every action as one shape, so the test awaits a promise whichever it is. */
  type Next = (p: typeof playback) => Promise<void>;
  it.each<[string, Next]>([
    ['play — "Chạy lại" inside the fade', (p) => p.play()],
    ['load — the next run starting 400 ms after zero', (p) => p.load(track(), false)],
    ['stop', async (p) => p.stop()],
    ['resetFade — the stage re-armed before a run', async (p) => p.resetFade()],
  ])('is cancelled by %s', async (_name, next) => {
    await playback.load(track(), false);
    playback.runEndBehavior();
    await next(playback);

    vi.advanceTimersByTime(10_000);
    expect(driver().engine.pause).not.toHaveBeenCalled();
  });

  it('keeps one pending pause when the run ends twice', async () => {
    await playback.load(track(), false);
    playback.runEndBehavior();
    vi.advanceTimersByTime(1_000);
    playback.runEndBehavior();

    vi.advanceTimersByTime(1_999);
    expect(driver().engine.pause).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(driver().engine.pause).toHaveBeenCalledOnce();
  });

  it('is cancelled by dispose', async () => {
    await playback.load(track(), false);
    playback.runEndBehavior();
    const old = driver();
    playback.dispose();

    vi.advanceTimersByTime(10_000);
    expect(old.engine.pause).not.toHaveBeenCalled();
    expect(old.dispose).toHaveBeenCalledOnce();
  });
});

describe('load — what the engine is told about the track', () => {
  it('loads a playlist track with no loop, so that `ended` fires at all', async () => {
    settings.current.singleLoopStyle = 'crossfade';
    const t = track();
    await playback.load(t, false);

    expect(driver().engine.load).toHaveBeenCalledWith(t, 'none');
  });

  it('loads a Single track with the stored loop style, read at this load', async () => {
    settings.current.singleLoopStyle = 'crossfade';
    const t = track();
    await playback.load(t, true);
    expect(driver().engine.load).toHaveBeenLastCalledWith(t, 'crossfade');

    settings.current.singleLoopStyle = 'hard';
    await playback.load(t, true);
    expect(driver().engine.load).toHaveBeenLastCalledWith(t, 'hard');
  });

  it('applies the stored volume and resets what the last track left behind', async () => {
    Object.assign(settings.current, { volume: 0.3, muted: true });
    await playback.load(track({ id: 'a', durationMs: 90_000 }), false);
    driver().events.onLoop(4);
    driver().engine.positionMs = 50_000;
    playback.tick();

    await playback.load(track({ id: 'b', durationMs: 120_000 }), false);

    expect(driver().engine.setVolume).toHaveBeenLastCalledWith(0.3, true);
    expect(playback.track?.id).toBe('b');
    expect(playback.loops).toBe(1);
    expect(playback.positionMs).toBe(0);
    expect(playback.durationMs).toBe(120_000);
  });
});

describe('settings that reach a track already playing', () => {
  it('changes the loop of the track looping now in Single mode', async () => {
    await playback.load(track(), true);
    settings.current.singleLoopStyle = 'crossfade';
    playback.applyLoopStyle();

    expect(driver().engine.setLoopMode).toHaveBeenCalledWith('crossfade');
  });

  it('leaves a playlist track unlooped — the setting is Single mode’s', async () => {
    await playback.load(track(), false);
    settings.current.singleLoopStyle = 'crossfade';
    playback.applyLoopStyle();

    expect(driver().engine.setLoopMode).not.toHaveBeenCalled();
  });

  it('carries volume and crossfade changes to the engine', async () => {
    await playback.load(track(), false);
    Object.assign(settings.current, { volume: 0.5, muted: false, crossfadeMs: 0 });
    playback.applyVolume();
    playback.applyCrossfade();

    expect(driver().engine.setVolume).toHaveBeenLastCalledWith(0.5, false);
    expect(driver().engine.setCrossfade).toHaveBeenLastCalledWith(0);
    expect(driver().refresh).toHaveBeenCalled();
  });
});

describe('what the driver reports flows back into the runes', () => {
  it('mirrors status, loops and the live-URL count', async () => {
    await playback.unlock();
    driver().events.onStatus('playing');
    driver().events.onLoop(3);
    driver().events.onLiveUrls?.(2);

    expect(playback.status).toBe('playing');
    expect(playback.loops).toBe(3);
    expect(playback.liveUrls).toBe(2);
  });

  it('tells the shell a track ended, so the queue can advance', async () => {
    const onEnded = vi.fn();
    playback.onEnded = onEnded;
    await playback.unlock();
    driver().events.onEnded();

    expect(onEnded).toHaveBeenCalledOnce();
  });

  it('reports a decode failure for the track it holds', async () => {
    const onError = vi.fn();
    playback.onError = onError;
    await playback.load(track({ id: 'a' }), false);
    driver().events.onError?.('a');

    expect(onError).toHaveBeenCalledWith('a');
  });

  it('drops a failure reported for a track already replaced — acting on it would skip this one', async () => {
    const onError = vi.fn();
    playback.onError = onError;
    await playback.load(track({ id: 'a' }), false);
    await playback.load(track({ id: 'b' }), false);
    driver().events.onError?.('a');

    expect(onError).not.toHaveBeenCalled();
  });

  it('logs the code and an opaque track id — never a file name (docs/12 §6)', async () => {
    await playback.unlock();
    driver().events.onLog('TT-PLY-101', { trackId: 'track-9', name: 'secret.mp3' });
    driver().events.onLog('TT-PLY-100');

    const [named, bare] = ttLog.entries().slice(-2);
    expect(named).toMatchObject({
      level: 'warn',
      code: 'TT-PLY-101',
      message: '',
      trackId: 'track-9',
    });
    expect(JSON.stringify(named)).not.toContain('secret.mp3');
    expect(bare).toMatchObject({ code: 'TT-PLY-100', message: '' });
    expect(bare).not.toHaveProperty('trackId');
  });
});

describe('a crossfade lands on the track the shell armed — docs/05 §2', () => {
  it('makes the incoming track the current one, from its start', async () => {
    const onCrossfade = vi.fn();
    playback.onCrossfade = onCrossfade;
    const next = track({ id: 'b', durationMs: 200_000 });
    await playback.load(track({ id: 'a', durationMs: 90_000 }), false);
    driver().events.onLoop(2);
    playback.setNext(next);
    driver().events.onCrossfade?.('b');

    expect(driver().engine.setNext).toHaveBeenCalledWith(next);
    // Equal, not identical: `$state` hands back its own proxy of the track.
    expect(playback.track).toEqual(next);
    expect(playback.loops).toBe(1);
    expect(playback.positionMs).toBe(0);
    expect(playback.durationMs).toBe(200_000);
    expect(onCrossfade).toHaveBeenCalledWith('b');
  });

  it('keeps the current track when the transition names another one', async () => {
    playback.onCrossfade = vi.fn();
    await playback.load(track({ id: 'a' }), false);
    playback.setNext(track({ id: 'b' }));
    driver().events.onCrossfade?.('c');

    expect(playback.track?.id).toBe('a');
  });
});

describe('tick — the element is the truth about position and length', () => {
  it('pulls the position, and the element’s length once it knows one', async () => {
    await playback.load(track({ durationMs: 180_000 }), false);
    Object.assign(driver().engine, { positionMs: 12_345, durationMs: 181_250 });
    playback.tick();

    expect(playback.positionMs).toBe(12_345);
    expect(playback.durationMs).toBe(181_250);
  });

  it("falls back to the importer's length while the element has none", async () => {
    await playback.load(track({ durationMs: 180_000 }), false);
    driver().engine.durationMs = null;
    playback.tick();

    expect(playback.durationMs).toBe(180_000);
  });
});

describe('the importer’s cover port', () => {
  it('works detached from the store — it is handed over as a bare function', () => {
    const { makeCoverUrl } = playback;
    expect(makeCoverUrl('t', new Uint8Array([1]), 'image/png')).toBe('blob:cover');
  });

  it('turns a failure into "no cover" — decoration never fails an import', async () => {
    await playback.unlock();
    driver().engine.acquireCoverUrl.mockImplementation(() => {
      throw new Error('quota');
    });

    expect(playback.makeCoverUrl('t', new Uint8Array([1]), 'image/png')).toBeNull();
  });
});

describe('stop and dispose', () => {
  it('stops, re-arms the fade stage and rewinds the readouts', async () => {
    await playback.load(track(), false);
    driver().events.onLoop(5);
    driver().engine.positionMs = 9_000;
    playback.tick();
    playback.stop();

    expect(driver().engine.stop).toHaveBeenCalledOnce();
    expect(driver().resetFade).toHaveBeenCalledOnce();
    expect(playback.loops).toBe(1);
    expect(playback.positionMs).toBe(0);
  });

  it('forgets the track and builds a fresh driver for the next action', async () => {
    await playback.load(track(), false);
    driver().events.onStatus('playing');
    playback.dispose();

    expect(playback.track).toBeNull();
    expect(playback.status).toBe('idle');
    await playback.unlock();
    expect(drivers).toHaveLength(2);
  });

  it('reads the analyser through the driver once there is one', async () => {
    await playback.unlock();
    const into = new Uint8Array(new ArrayBuffer(4));
    playback.readFrequencyData(into);
    playback.readTimeDomainData(into);

    expect(playback.binCount).toBe(1024);
    expect(playback.peakRms).toBe(0.25);
    expect(driver().readFrequencyData).toHaveBeenCalledWith(into);
    expect(driver().readTimeDomainData).toHaveBeenCalledWith(into);
  });
});
