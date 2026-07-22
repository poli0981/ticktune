import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OVERLAY_SKIP_MS,
  TtYtPlayer,
  YT_ENDED,
  YT_PAUSED,
  YT_PLAYING,
  overlayForError,
  type TtYtPlayerApi,
  type TtYtPlayerEvents,
  type TtYtPlayerHost,
  type TtYtPlayerPorts,
} from '../../src/app/engine/youtube/tt-yt-player';
import type { TtTrack } from '../../src/app/engine/importer/types';

/**
 * docs/06 §2 and §4 — the player's decisions, with no player.
 *
 * The IFrame API cannot run in a unit test and CI may not depend on YouTube at
 * all (docs/13 §4), so everything worth asserting lives behind the injected
 * `create`. What is left in the driver is a script tag and a constructor call.
 */

const track = (over: Partial<TtTrack> = {}): TtTrack => ({
  id: 'track-1',
  source: 'youtube',
  status: 'ok',
  title: 'x',
  artist: 'y',
  durationMs: null,
  videoId: 'dQw4w9WgXcQ',
  addedAt: 0,
  ...over,
});

let api: { [K in keyof TtYtPlayerApi]: ReturnType<typeof vi.fn> };
let events: TtYtPlayerEvents | null;
let host: { [K in keyof TtYtPlayerHost]: ReturnType<typeof vi.fn> };
let ports: TtYtPlayerPorts;

beforeEach(() => {
  vi.useFakeTimers();
  events = null;
  api = {
    loadVideoById: vi.fn(),
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    setVolume: vi.fn(),
    mute: vi.fn(),
    unMute: vi.fn(),
    getDuration: vi.fn().mockReturnValue(0),
    getCurrentTime: vi.fn().mockReturnValue(0),
    destroy: vi.fn(),
  };
  host = { onAdvance: vi.fn(), onOverlay: vi.fn(), onStatus: vi.fn(), onLog: vi.fn() };
  ports = {
    create: (e) => {
      events = e;
      return api as unknown as TtYtPlayerApi;
    },
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (h) => clearTimeout(h),
  };
});

function started(): TtYtPlayer {
  const p = new TtYtPlayer(ports, host as unknown as TtYtPlayerHost);
  p.load(track());
  events?.onReady();
  return p;
}

describe('one instance, reused — docs/06 §2', () => {
  it('creates the player once and swaps the video after that', () => {
    const create = vi.fn(ports.create);
    const p = new TtYtPlayer({ ...ports, create }, host as unknown as TtYtPlayerHost);

    p.load(track({ videoId: 'aaaaaaaaaaa' }));
    events?.onReady();
    p.load(track({ videoId: 'bbbbbbbbbbb' }));

    // Rebuilding per track would reload the iframe, drop the gesture chain that
    // authorised playback, and flash an empty hole where the ToS wants a player.
    expect(create).toHaveBeenCalledTimes(1);
    expect(api.loadVideoById).toHaveBeenLastCalledWith('bbbbbbbbbbb');
    expect(api.destroy).not.toHaveBeenCalled();
  });

  it('plays the track that was requested before the API was ready', () => {
    const p = new TtYtPlayer(ports, host as unknown as TtYtPlayerHost);
    p.load(track({ videoId: 'ccccccccccc' }));
    // Nothing can be loaded yet — the player does not exist.
    expect(api.loadVideoById).not.toHaveBeenCalled();

    events?.onReady();
    expect(api.loadVideoById).toHaveBeenCalledWith('ccccccccccc');
    expect(api.playVideo).toHaveBeenCalled();
    expect(p.ready).toBe(true);
  });

  it('ignores a track with no videoId rather than constructing anything', () => {
    // `exactOptionalPropertyTypes` forbids passing an explicit undefined, which
    // is the point: the field is ABSENT on a local track, not set to undefined.
    const noId: TtTrack = track();
    delete noId.videoId;
    const p = new TtYtPlayer(ports, host as unknown as TtYtPlayerHost);
    p.load(noId);
    expect(p.ready).toBe(false);
  });
});

describe('state changes drive the queue', () => {
  it('ENDED advances', () => {
    started();
    events?.onStateChange(YT_ENDED);
    expect(host.onAdvance).toHaveBeenCalledTimes(1);
    expect(host.onStatus).toHaveBeenLastCalledWith(false);
  });

  it('PLAYING and PAUSED only report status', () => {
    started();
    events?.onStateChange(YT_PLAYING);
    expect(host.onStatus).toHaveBeenLastCalledWith(true);
    events?.onStateChange(YT_PAUSED);
    expect(host.onStatus).toHaveBeenLastCalledWith(false);
    expect(host.onAdvance).not.toHaveBeenCalled();
  });

  it('an unknown state does nothing', () => {
    started();
    events?.onStateChange(3); // buffering
    expect(host.onAdvance).not.toHaveBeenCalled();
  });
});

describe('overlayForError — docs/06 §4 after S1', () => {
  it('sends 150 and 101 to the blocked card, marked ambiguous', () => {
    // S1 measured 150 for six distinct causes. Age-restricted and
    // region-blocked are genuinely indistinguishable, so the card says both
    // rather than picking one and sounding certain.
    for (const code of [101, 150]) {
      expect(overlayForError(code)).toEqual({
        key: 'yt.err.blocked',
        code: 'TT-YT-150',
        ambiguous: true,
      });
    }
  });

  it('keeps the unobserved codes mapped, but not ambiguous', () => {
    expect(overlayForError(100).key).toBe('yt.err.gone');
    expect(overlayForError(2).key).toBe('yt.err.invalid');
    expect(overlayForError(5).key).toBe('yt.err.player');
    expect([100, 2, 5].map((c) => overlayForError(c).ambiguous)).toEqual([false, false, false]);
  });

  it('an unmeasured code lands in the honest bucket, never in "gone"', () => {
    // Telling someone their video was deleted when we do not know is the
    // specific wrong sentence S1 was written to stop.
    expect(overlayForError(42).key).toBe('yt.err.blocked');
    expect(overlayForError(42).key).not.toBe('yt.err.gone');
  });
});

describe('an error shows a card, then moves on by itself', () => {
  it('reports the overlay and logs the code against the track', () => {
    started();
    events?.onError(150);

    expect(host.onOverlay).toHaveBeenLastCalledWith({
      key: 'yt.err.blocked',
      code: 'TT-YT-150',
      ambiguous: true,
    });
    expect(host.onLog).toHaveBeenCalledWith('TT-YT-150', 'track-1');
    expect(host.onStatus).toHaveBeenLastCalledWith(false);
  });

  it('does not advance until the skip delay elapses', () => {
    started();
    events?.onError(150);

    vi.advanceTimersByTime(OVERLAY_SKIP_MS - 1);
    expect(host.onAdvance).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(host.onAdvance).toHaveBeenCalledTimes(1);
    // The card is cleared before the next track loads, or it would sit over a
    // video that is playing fine.
    expect(host.onOverlay).toHaveBeenLastCalledWith(null);
  });

  it('"Skip now" takes the same path without the wait, and only once', () => {
    const p = started();
    events?.onError(150);
    p.skipNow();

    expect(host.onAdvance).toHaveBeenCalledTimes(1);
    // The pending timer must be cancelled, or the queue jumps two tracks.
    vi.advanceTimersByTime(OVERLAY_SKIP_MS * 2);
    expect(host.onAdvance).toHaveBeenCalledTimes(1);
  });

  it('loading the next track cancels a pending skip', () => {
    const p = started();
    events?.onError(150);
    p.load(track({ id: 'track-2', videoId: 'ddddddddddd' }));

    vi.advanceTimersByTime(OVERLAY_SKIP_MS * 2);
    expect(host.onAdvance).not.toHaveBeenCalled();
    expect(host.onOverlay).toHaveBeenLastCalledWith(null);
  });

  it('two errors in a row do not stack two advances', () => {
    started();
    events?.onError(150);
    events?.onError(150);
    vi.advanceTimersByTime(OVERLAY_SKIP_MS);
    expect(host.onAdvance).toHaveBeenCalledTimes(1);
  });
});

describe('volume is on YouTube scale, not the gain scale', () => {
  it('converts 0–1 to 0–100', () => {
    const p = started();
    p.applyVolume(0.8, false);
    // setVolume(0.8) is a silent player, and it looks exactly like a mute bug.
    expect(api.setVolume).toHaveBeenCalledWith(80);
    expect(api.unMute).toHaveBeenCalled();
  });

  it('clamps rather than trusting the caller', () => {
    const p = started();
    p.applyVolume(9, false);
    expect(api.setVolume).toHaveBeenLastCalledWith(100);
    p.applyVolume(-1, false);
    expect(api.setVolume).toHaveBeenLastCalledWith(0);
  });

  it('mutes through the player, not by zeroing the volume', () => {
    // Zeroing would lose the user's level, so unmuting could not restore it.
    const p = started();
    p.applyVolume(0.5, true);
    expect(api.mute).toHaveBeenCalled();
    expect(api.setVolume).toHaveBeenCalledWith(50);
  });

  it('is inert before the player exists', () => {
    const p = new TtYtPlayer(ports, host as unknown as TtYtPlayerHost);
    expect(() => p.applyVolume(0.5, false)).not.toThrow();
  });
});

describe('duration and position — docs/06 §2 backfill', () => {
  it('reports null while YouTube still says 0, never 0:00', () => {
    // getDuration() returns 0 until the video loads. Passing that through would
    // render "0:00", which reads as a real value; null renders "–", which is
    // what we actually know (hard invariant 5).
    const p = started();
    api.getDuration.mockReturnValue(0);
    expect(p.durationMs).toBeNull();
    api.getCurrentTime.mockReturnValue(0);
    expect(p.positionMs).toBeNull();
  });

  it('converts seconds to ms once it knows', () => {
    const p = started();
    api.getDuration.mockReturnValue(212.4);
    api.getCurrentTime.mockReturnValue(30.5);
    expect(p.durationMs).toBe(212_400);
    expect(p.positionMs).toBe(30_500);
  });

  it('is null before the player exists', () => {
    const p = new TtYtPlayer(ports, host as unknown as TtYtPlayerHost);
    expect(p.durationMs).toBeNull();
    expect(p.positionMs).toBeNull();
  });
});

describe('dispose', () => {
  it('destroys the player and cancels a pending skip', () => {
    const p = started();
    events?.onError(150);
    p.dispose();

    expect(api.destroy).toHaveBeenCalled();
    vi.advanceTimersByTime(OVERLAY_SKIP_MS * 2);
    expect(host.onAdvance).not.toHaveBeenCalled();
    expect(p.ready).toBe(false);
  });
});
