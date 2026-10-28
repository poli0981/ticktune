import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NATIVE_SETTLE_MS,
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
// `Required`, because `onSkipIn` is optional on the interface — the host may
// ignore the countdown — but this fake always provides it and the assertions
// read `.mock` off it.
let host: { [K in keyof Required<TtYtPlayerHost>]: ReturnType<typeof vi.fn> };
let ports: TtYtPlayerPorts;

beforeEach(() => {
  vi.useFakeTimers();
  events = null;
  api = {
    loadVideoById: vi.fn(),
    cueVideoById: vi.fn(),
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    setVolume: vi.fn(),
    mute: vi.fn(),
    unMute: vi.fn(),
    getDuration: vi.fn().mockReturnValue(0),
    getCurrentTime: vi.fn().mockReturnValue(0),
    getVideoData: vi.fn().mockReturnValue({}),
    destroy: vi.fn(),
  };
  host = {
    onAdvance: vi.fn(),
    onOverlay: vi.fn(),
    onStatus: vi.fn(),
    onNativeToggle: vi.fn(),
    onLog: vi.fn(),
    onSkipIn: vi.fn(),
  };
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

  it('a cue selects the video and does NOT play it — paused ⏭/⏮/jump', () => {
    // loadVideoById autoplays; during a paused run that started the music with
    // the countdown frozen. A cue leaves it stopped until the run resumes.
    const p = started();
    vi.mocked(api.playVideo).mockClear();

    p.cue(track({ videoId: 'ddddddddddd' }));

    expect(api.cueVideoById).toHaveBeenCalledWith('ddddddddddd');
    expect(api.loadVideoById).not.toHaveBeenCalledWith('ddddddddddd');
    expect(api.playVideo).not.toHaveBeenCalled();
  });

  it('a cue issued before the API is ready stays a cue on ready', () => {
    const p = new TtYtPlayer(ports, host as unknown as TtYtPlayerHost);
    p.cue(track({ videoId: 'eeeeeeeeeee' }));
    events?.onReady();

    expect(api.cueVideoById).toHaveBeenCalledWith('eeeeeeeeeee');
    expect(api.playVideo).not.toHaveBeenCalled();
  });

  it('a pause before the API is ready is honoured on ready', () => {
    // `#onReady` used to call playVideo() unconditionally, so pausing while the
    // API was still loading was undone the moment it arrived.
    const p = new TtYtPlayer(ports, host as unknown as TtYtPlayerHost);
    p.load(track({ videoId: 'fffffffffff' }));
    p.pause();
    events?.onReady();

    expect(api.cueVideoById).toHaveBeenCalledWith('fffffffffff');
    expect(api.playVideo).not.toHaveBeenCalled();
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

  it('PLAYING and PAUSED report status at once, and neither advances', () => {
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

describe("the player's own ⏯ is the user's — docs/06 §2 (v2.0.4)", () => {
  /*
   * A pause in the frame used to reach `onStatus` and nothing else: the
   * countdown ran on under a ▶, and a play there during a paused run played the
   * music under a frozen countdown. The sequences below are the real player's,
   * measured 2026-10-28 (`tests/manual/yt-matrix.md`).
   */
  const BUFFERING = 3;
  const CUED = 5;
  const UNSTARTED = -1;

  /** A ready player whose video has started, as the app asked. */
  function playing(): TtYtPlayer {
    const p = started();
    events?.onStateChange(BUFFERING);
    events?.onStateChange(YT_PLAYING);
    return p;
  }

  it('a pause the app did not ask for is reported, once it has settled', () => {
    playing();
    events?.onStateChange(YT_PAUSED);

    vi.advanceTimersByTime(NATIVE_SETTLE_MS - 1);
    expect(host.onNativeToggle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(host.onNativeToggle).toHaveBeenCalledOnce();
    expect(host.onNativeToggle).toHaveBeenCalledWith(false);
  });

  it('a play the app did not ask for is reported — during a pause, and on a cued video', () => {
    const p = playing();
    p.pause();
    events?.onStateChange(YT_PAUSED); // our own echo
    events?.onStateChange(BUFFERING); // the frame's ▶: buffering, then playing
    events?.onStateChange(YT_PLAYING);
    vi.advanceTimersByTime(NATIVE_SETTLE_MS);
    expect(host.onNativeToggle).toHaveBeenCalledOnce();
    expect(host.onNativeToggle).toHaveBeenLastCalledWith(true);

    // ⏭ while paused cues the next video; ▶ on it in the frame is still the user's.
    p.pause();
    p.cue(track({ id: 'track-2', videoId: 'ddddddddddd' }));
    events?.onStateChange(UNSTARTED);
    events?.onStateChange(CUED);
    events?.onStateChange(BUFFERING);
    events?.onStateChange(YT_PLAYING);
    vi.advanceTimersByTime(NATIVE_SETTLE_MS);
    expect(host.onNativeToggle).toHaveBeenCalledTimes(2);
    expect(host.onNativeToggle).toHaveBeenLastCalledWith(true);
  });

  it("adopts the user's choice — sends nothing back, and judges the next state against it", () => {
    // The player already obeyed the user. A command sent back is at best a
    // no-op, and mid-scrub a `pauseVideo` could keep the video paused on release.
    playing();
    api.playVideo.mockClear();
    api.pauseVideo.mockClear();

    events?.onStateChange(YT_PAUSED);
    vi.advanceTimersByTime(NATIVE_SETTLE_MS);
    expect(host.onNativeToggle).toHaveBeenLastCalledWith(false);

    // No `pause()` from anyone in between: the frame's ▶ is still a contradiction.
    events?.onStateChange(BUFFERING);
    events?.onStateChange(YT_PLAYING);
    vi.advanceTimersByTime(NATIVE_SETTLE_MS);
    expect(host.onNativeToggle).toHaveBeenLastCalledWith(true);
    expect(host.onNativeToggle).toHaveBeenCalledTimes(2);

    expect(api.pauseVideo).not.toHaveBeenCalled();
    expect(api.playVideo).not.toHaveBeenCalled();
  });

  it("never reports the app's own pause or play — the exhausted queue's pause included", () => {
    // docs/02 §5.1: an exhausted queue pauses the video while the run plays on
    // in silence. Compared with the session, that pause would freeze the
    // countdown; compared with what the app asked for, it is simply ours.
    const p = playing();
    p.pause();
    events?.onStateChange(YT_PAUSED);
    vi.advanceTimersByTime(NATIVE_SETTLE_MS * 2);
    p.play();
    events?.onStateChange(BUFFERING);
    events?.onStateChange(YT_PLAYING);
    vi.advanceTimersByTime(NATIVE_SETTLE_MS * 2);

    expect(host.onNativeToggle).not.toHaveBeenCalled();
  });

  it('a PLAYING still in flight when the app paused does not undo the pause', () => {
    // postMessage is asynchronous both ways: the frame can send PLAYING before
    // our pauseVideo reaches it. Taken at once, the user's ⏸ would bounce back.
    const p = playing();
    p.pause();
    events?.onStateChange(YT_PLAYING);
    vi.advanceTimersByTime(6); // the measured echo: 2–6 ms
    events?.onStateChange(YT_PAUSED);
    vi.advanceTimersByTime(NATIVE_SETTLE_MS * 2);

    expect(host.onNativeToggle).not.toHaveBeenCalled();
  });

  it("a seek's passing PAUSED is not a pause — PAUSED, BUFFERING 1 ms later, PLAYING", () => {
    playing();
    events?.onStateChange(YT_PAUSED);
    vi.advanceTimersByTime(1);
    events?.onStateChange(BUFFERING);
    vi.advanceTimersByTime(820);
    events?.onStateChange(YT_PLAYING);
    vi.advanceTimersByTime(NATIVE_SETTLE_MS * 2);

    expect(host.onNativeToggle).not.toHaveBeenCalled();
  });

  it('a PAUSED right before ENDED advances once and pauses nothing', () => {
    // Taken at once, the run would pause and the shell's advance — which only
    // moves a playing run — would be dropped: a stuck queue, a frozen clock.
    playing();
    events?.onStateChange(YT_PAUSED);
    events?.onStateChange(YT_ENDED);
    vi.advanceTimersByTime(NATIVE_SETTLE_MS * 2);

    expect(host.onAdvance).toHaveBeenCalledOnce();
    expect(host.onNativeToggle).not.toHaveBeenCalled();
  });

  it("a PAUSED from a video that never played is not the user's", () => {
    // A refused autoplay must not freeze the countdown — a local track's
    // `blocked` does not — and a late PAUSED from a video being replaced
    // belongs to that video, not to the one now opening.
    const p = started();
    events?.onStateChange(UNSTARTED);
    events?.onStateChange(YT_PAUSED);
    vi.advanceTimersByTime(NATIVE_SETTLE_MS * 2);

    events?.onStateChange(BUFFERING);
    events?.onStateChange(YT_PLAYING);
    p.load(track({ id: 'track-2', videoId: 'ddddddddddd' }));
    events?.onStateChange(YT_PAUSED);
    vi.advanceTimersByTime(NATIVE_SETTLE_MS * 2);

    expect(host.onNativeToggle).not.toHaveBeenCalled();
  });

  it('a repeated state is one report, not two', () => {
    playing();
    events?.onStateChange(YT_PAUSED);
    events?.onStateChange(YT_PAUSED);
    vi.advanceTimersByTime(NATIVE_SETTLE_MS * 2);

    expect(host.onNativeToggle).toHaveBeenCalledOnce();
  });

  it('nothing counts while an error card is counting down', () => {
    // The card's skip advances through the shell, which advances only a run
    // that is still playing.
    playing();
    events?.onError(150);
    events?.onStateChange(YT_PAUSED);
    vi.advanceTimersByTime(NATIVE_SETTLE_MS * 2);

    expect(host.onNativeToggle).not.toHaveBeenCalled();
  });

  const commands: [string, (p: TtYtPlayer) => void][] = [
    ['play()', (p) => p.play()],
    ['pause()', (p) => p.pause()],
    ['load()', (p) => p.load(track({ id: 'track-2', videoId: 'ddddddddddd' }))],
    ['cue()', (p) => p.cue(track({ id: 'track-2', videoId: 'ddddddddddd' }))],
    ['skipNow()', (p) => p.skipNow()],
    ['dispose()', (p) => p.dispose()],
    ['an error', () => events?.onError(150)],
  ];
  it.each(commands)('%s cancels a report that has not settled', (_name, act) => {
    const p = playing();
    events?.onStateChange(YT_PAUSED);
    act(p);
    vi.advanceTimersByTime(NATIVE_SETTLE_MS * 2);

    expect(host.onNativeToggle).not.toHaveBeenCalled();
  });

  it('is optional on the host', () => {
    const bare: Partial<typeof host> = { ...host };
    delete bare.onNativeToggle;
    const p = new TtYtPlayer(ports, bare as unknown as TtYtPlayerHost);
    p.load(track());
    events?.onReady();
    events?.onStateChange(YT_PLAYING);
    events?.onStateChange(YT_PAUSED);

    expect(() => vi.advanceTimersByTime(NATIVE_SETTLE_MS)).not.toThrow();
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

  it('counts the card down every second — docs/06 §4', () => {
    // §4 lists five parts and the countdown was the one nobody built, so the
    // card sat still and then vanished: an automatic advance that looked like
    // the app losing its place.
    started();
    events?.onError(150);

    expect(host.onSkipIn).toHaveBeenLastCalledWith(OVERLAY_SKIP_MS);
    vi.advanceTimersByTime(1_000);
    expect(host.onSkipIn).toHaveBeenLastCalledWith(OVERLAY_SKIP_MS - 1_000);
    vi.advanceTimersByTime(2_000);
    expect(host.onSkipIn).toHaveBeenLastCalledWith(OVERLAY_SKIP_MS - 3_000);
  });

  it('stops counting the moment the user skips', () => {
    const p = started();
    events?.onError(150);
    vi.advanceTimersByTime(1_000);

    p.skipNow();
    expect(host.onSkipIn).toHaveBeenLastCalledWith(null);

    // A stray tick afterwards would redraw a counter over a card that is gone.
    const calls = host.onSkipIn.mock.calls.length;
    vi.advanceTimersByTime(OVERLAY_SKIP_MS * 2);
    expect(host.onSkipIn.mock.calls).toHaveLength(calls);
  });

  it('drives the counter from the SAME injected timer as the skip', () => {
    // Two clocks would let the card read "1s" for a second after it had gone.
    started();
    events?.onError(150);
    vi.advanceTimersByTime(OVERLAY_SKIP_MS);

    expect(host.onAdvance).toHaveBeenCalledTimes(1);
    expect(host.onSkipIn).toHaveBeenLastCalledWith(null);
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

describe('before the player is ready — the real API attaches its methods at onReady (v2.0)', () => {
  /*
   * `create()` returns at once; the methods arrive with `onReady`. Until v2.0
   * the wrapper read through in between — the tick threw on every YouTube
   * start — and sent the first video's volume to a player that could not hear
   * it, so that video played at YouTube's own level.
   */
  const bare = () => {
    const missing = (name: string) => () => {
      throw new TypeError(`${name} is not a function`);
    };
    api.getCurrentTime.mockImplementation(missing('getCurrentTime'));
    api.getDuration.mockImplementation(missing('getDuration'));
    api.getVideoData.mockImplementation(missing('getVideoData'));
  };

  it('reads nothing between create and ready', () => {
    const p = new TtYtPlayer(ports, host as unknown as TtYtPlayerHost);
    p.load(track());
    bare();

    expect(p.ready).toBe(false);
    expect(p.positionMs).toBeNull();
    expect(p.durationMs).toBeNull();
    expect(p.videoData).toEqual({ title: null, author: null });

    events?.onReady();
    api.getCurrentTime.mockReturnValue(12.5);
    api.getDuration.mockReturnValue(200);
    expect(p.ready).toBe(true);
    expect(p.positionMs).toBe(12_500);
    expect(p.durationMs).toBe(200_000);
  });

  it('keeps a volume set before ready, and applies it when ready — before the video plays', () => {
    const p = new TtYtPlayer(ports, host as unknown as TtYtPlayerHost);
    p.load(track());
    p.applyVolume(0.3, true);
    // Sent now, it would reach a player that cannot hear it.
    expect(api.setVolume).not.toHaveBeenCalled();

    events?.onReady();
    expect(api.setVolume).toHaveBeenCalledWith(30);
    expect(api.mute).toHaveBeenCalled();
    const first = (fn: ReturnType<typeof vi.fn>) => fn.mock.invocationCallOrder[0] ?? Infinity;
    expect(first(api.setVolume)).toBeLessThan(first(api.loadVideoById));
  });

  it('a track opened between create and ready is the one that opens on ready', () => {
    // ⏭ or ENDED inside the first second: the load went to a player with no
    // methods and was lost, and ready then opened the FIRST video again.
    const p = new TtYtPlayer(ports, host as unknown as TtYtPlayerHost);
    p.load(track({ videoId: 'aaaaaaaaaaa' }));
    p.load(track({ videoId: 'bbbbbbbbbbb' }));
    expect(api.loadVideoById).not.toHaveBeenCalled();

    events?.onReady();
    expect(api.loadVideoById).toHaveBeenCalledTimes(1);
    expect(api.loadVideoById).toHaveBeenCalledWith('bbbbbbbbbbb');
  });

  it('is not ready again after dispose, and reads nothing', () => {
    const p = started();
    p.dispose();
    bare();
    expect(p.ready).toBe(false);
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
