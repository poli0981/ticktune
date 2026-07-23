import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TtTrack } from '../../src/app/engine/importer/types';
import type {
  TtYtPlayerApi,
  TtYtPlayerEvents,
  TtYtPlayerPorts,
} from '../../src/app/engine/youtube/tt-yt-player';
// Type-only, so this does NOT pin a module instance: each test re-imports the
// store after `vi.resetModules()` to get its own copy of the singleton.
import type * as YtMod from '../../src/app/state/yt.svelte';

/**
 * The YouTube store's PLAYER LIFECYCLE — docs/06 §2.
 *
 * **This tier exists because neither engine can fail these.** `TtYtPlayer` has
 * always cued and advanced correctly and is unit-tested doing so; the driver has
 * always targeted the right host. Every defect below sat between them, in the
 * store, and all three shipped to `main` inside a phase with 451 green tests:
 *
 * 1. `onStart` is synchronous (the gesture chain, `docs/05 §1`) but the rail
 *    only renders once the state IS `playing` and hands its element over from an
 *    `$effect`. So the first Start called `load()` while the player was still
 *    null and it went nowhere. Measured on `astro dev` 2026-07-23: no iframe,
 *    and `iframe_api` never even requested — the app never contacted YouTube.
 * 2. `attach` guarded on `#player !== null`, which is the store's lifetime and
 *    not the element. Leaving `playing`/`paused` destroys the rail, so after a
 *    Stop the player survived bound to a detached node and the replacement was
 *    refused.
 * 3. `dispose` left `#pending` set, so a run abandoned before the rail mounted
 *    would have its track replayed by the next run.
 *
 * The ports are faked and `TtYtPlayer` is real: what is under test is the store's
 * ordering, not the state machine's decisions.
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

/** One fake `YT.Player` per `create` call, so a rebuild is observable. */
interface Made {
  api: { [K in keyof TtYtPlayerApi]: ReturnType<typeof vi.fn> };
  events: TtYtPlayerEvents;
}

let made: Made[];
let yt: typeof YtMod.yt;

function makeApi(): Made['api'] {
  return {
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
}

vi.mock('../../src/app/engine/youtube/tt-yt-player-driver', () => ({
  YT_WIDTH: 384,
  YT_HEIGHT: 216,
  browserPlayerPorts: (): TtYtPlayerPorts => ({
    create: (events: TtYtPlayerEvents): TtYtPlayerApi => {
      const api = makeApi();
      made.push({ api, events });
      return api as unknown as TtYtPlayerApi;
    },
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (h) => {
      clearTimeout(h);
    },
  }),
}));

/** The `<div>` the rail binds and hands over — a new one per remount. */
const el = (): HTMLElement => document.createElement('div');

beforeEach(async () => {
  vi.resetModules();
  made = [];
  ({ yt } = await import('../../src/app/state/yt.svelte'));
});

describe('a load issued before the rail mounts still plays — docs/06 §2', () => {
  it('cues and plays the track once the element arrives', () => {
    const t = track();

    // Exactly what `onStart` does, in the same order and in the same task.
    yt.load(t);
    yt.play();

    // Nothing can have happened yet: there is no element to host an iframe.
    expect(made).toHaveLength(0);

    // …one microtask later, Svelte flushes the rail's effect.
    yt.attach(el());

    expect(made).toHaveLength(1);
    // The player is constructed but the video only arrives on ready, which is
    // the state machine's own contract (`#pendingId`).
    made[0]?.events.onReady();
    expect(made[0]?.api.loadVideoById).toHaveBeenCalledWith('dQw4w9WgXcQ');
    expect(made[0]?.api.playVideo).toHaveBeenCalled();
  });

  it('does not play a track the user only staged — load without play', () => {
    // `playTrack` calls load+play together, but `attach` must not invent a play
    // that was never requested, or a paused run would resume itself on remount.
    yt.load(track());
    yt.attach(el());

    made[0]?.events.onReady();
    // onReady plays by itself (docs/06 §2 first cue); what must NOT happen is a
    // second, store-issued play before it.
    expect(made[0]?.api.playVideo).toHaveBeenCalledTimes(1);
  });

  it('applies the stored volume to the replayed track', () => {
    yt.load(track());
    yt.attach(el());
    // The scale conversion is the player's, but the store has to ask — a
    // replayed track that skipped this would ignore the user's level.
    expect(made[0]?.api.setVolume).toHaveBeenCalled();
  });
});

describe('attach is idempotent per ELEMENT, not per lifetime', () => {
  it('does not rebuild the player when Svelte re-runs the effect', () => {
    const node = el();
    yt.load(track());
    yt.attach(node);
    yt.attach(node);
    yt.attach(node);

    // Rebuilding here would reload the iframe mid-video.
    expect(made).toHaveLength(1);
    expect(made[0]?.api.destroy).not.toHaveBeenCalled();
  });

  it('adopts a new element and destroys the player bound to the old one', () => {
    // The Stop → Start path: the rail is destroyed and rebuilt, so the element
    // handed over the second time is a different node.
    yt.load(track({ videoId: 'jNQXAC9IVRw' }));
    yt.attach(el());
    made[0]?.events.onReady();

    yt.attach(el());
    expect(made[0]?.api.destroy).toHaveBeenCalled();

    // …and the second run reaches the NEW player, not the detached one.
    yt.load(track({ id: 'track-2', videoId: '9bZkp7q19f0' }));
    expect(made).toHaveLength(2);
    made[1]?.events.onReady();
    expect(made[1]?.api.loadVideoById).toHaveBeenCalledWith('9bZkp7q19f0');
    expect(made[0]?.api.loadVideoById).not.toHaveBeenCalledWith('9bZkp7q19f0');
  });
});

describe('dispose', () => {
  it('drops a pending track, so the next run does not inherit it', () => {
    // Start then Stop before the rail ever mounted. Replaying that track when a
    // later run attaches would play something the user did not ask for.
    yt.load(track());
    yt.play();
    yt.dispose();

    yt.attach(el());
    expect(made).toHaveLength(0);
  });

  it('clears the position and duration readouts', () => {
    yt.load(track());
    yt.attach(el());
    yt.dispose();
    expect(yt.positionMs).toBeNull();
    expect(yt.durationMs).toBeNull();
  });
});
