import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TtImportPorts, TtImportResult, TtTrack } from '../../src/app/engine/importer/types';
import { nextInOrder } from '../../src/app/engine/queue/tt-play-order';
// Type-only, so these do NOT pin a module instance: each test re-imports the
// stores after `vi.resetModules()` to get its own copy of the singletons.
import type * as PlaybackMod from '../../src/app/state/playback.svelte';
import type * as SessionMod from '../../src/app/state/session.svelte';
import type * as SettingsMod from '../../src/app/state/settings.svelte';

/**
 * Session store — the queue, the mode and the docs/02 §5.1 cursor.
 *
 * **This tier exists because the engines cannot fail these.** `importFiles` has
 * always honoured `allowDuplicates` correctly and is unit-tested doing so; the
 * defect was that the call site passed a literal. `tt-play-order` has always
 * produced correct permutations; the defect would be a store that regenerates
 * one on every import. Both are wiring, both are invisible from either side, and
 * both are exactly the shape of the two bugs that reached the live site through
 * 233 passing tests.
 *
 * The importer is mocked rather than driven: what is under test here is the
 * INPUT the store builds and what it does with the result, not the pipeline.
 */

const importFiles = vi.fn<() => Promise<TtImportResult>>();

vi.mock('../../src/app/engine/importer/tt-import', () => ({
  importFiles: (input: unknown, ports: unknown) => {
    lastInput = input as ImportInput;
    // Captured so a test can drive the progress port the way the real pipeline
    // would, without running the pipeline.
    lastPorts = ports as TtImportPorts;
    return importFiles();
  },
}));

const importLinks = vi.fn<() => Promise<TtImportResult>>();

vi.mock('../../src/app/engine/youtube/tt-yt-import', () => ({
  importLinks: () => importLinks(),
}));
vi.mock('../../src/app/engine/youtube/tt-yt-driver', () => ({ browserYtPorts: () => ({}) }));

// The driver reaches for `document.createElement('audio')` and lazily imports
// music-metadata; neither is the subject here.
vi.mock('../../src/app/engine/importer/tt-import-driver', () => ({
  browserImportPorts: () => ({}),
  filesFromDataTransfer: () => Promise.resolve({ files: [], dropped: 0 }),
}));

interface ImportInput {
  files: File[];
  mode: string;
  queue: TtTrack[];
  allowDuplicates: boolean;
}

let lastInput: ImportInput | null = null;
let lastPorts: TtImportPorts | null = null;

let session: typeof SessionMod.session;
let settings: typeof SettingsMod.settings;
let playback: typeof PlaybackMod.playback;

const track = (id: string, over: Partial<TtTrack> = {}): TtTrack => ({
  id,
  source: 'local',
  status: 'ok',
  title: id,
  artist: 'a',
  durationMs: 5_000,
  addedAt: 0,
  ...over,
});

const result = (added: TtTrack[]): TtImportResult => ({ added, skipped: [], notes: [] });

/** Files whose contents never matter — the importer is mocked. */
const files = (n: number): File[] =>
  Array.from({ length: n }, (_, i) => new File([new Uint8Array(1)], `f${i}.mp3`));

beforeEach(async () => {
  // The stores are module singletons, so each test needs its own module graph.
  vi.resetModules();
  // resetAllMocks, not clearAllMocks: `clear` wipes recorded calls but LEAVES a
  // queued mockResolvedValueOnce, so one test whose import never fired would
  // hand its result to the next one. That happened.
  vi.resetAllMocks();
  lastInput = null;
  lastPorts = null;
  ({ session } = await import('../../src/app/state/session.svelte'));
  ({ settings } = await import('../../src/app/state/settings.svelte'));
  ({ playback } = await import('../../src/app/state/playback.svelte'));
});

/** Put N tracks in the queue through the real import path. */
async function stage(mode: 'single' | 'playlist', tracks: TtTrack[]): Promise<void> {
  session.setMode(mode);
  importFiles.mockResolvedValueOnce(result(tracks));
  await session.importPicked(files(tracks.length) as unknown as FileList);
}

describe('allowDuplicates reaches the importer', () => {
  it('passes the stored setting, not a literal', async () => {
    // Through all of P2 this call site passed `false` while the setting was
    // declared, defaulted, clamped, persisted and honoured by the engine. Every
    // engine test passed; the toggle would have shipped doing nothing.
    await settings.patch({ allowDuplicates: true });
    await stage('playlist', [track('a')]);
    expect(lastInput?.allowDuplicates).toBe(true);
  });

  it('and passes false when the setting is off', async () => {
    await settings.patch({ allowDuplicates: false });
    await stage('playlist', [track('a')]);
    expect(lastInput?.allowDuplicates).toBe(false);
  });
});

describe('import by mode — the branch that can wipe a queue', () => {
  it('APPENDS in playlist mode and releases nothing', async () => {
    const release = vi.spyOn(playback, 'releaseTrack');
    await stage('playlist', [track('a'), track('b')]);
    await stage('playlist', [track('c')]);

    expect(session.queue.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    // The single-mode branch revokes every URL in the queue. Reaching it with a
    // playlist staged would silently destroy up to 95 imported tracks.
    expect(release).not.toHaveBeenCalled();
    // And the second import measured capacity against the queue it is adding to.
    expect(lastInput?.queue.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('REPLACES in single mode and releases the outgoing track', async () => {
    await stage('single', [track('a')]);
    const release = vi.spyOn(playback, 'releaseTrack');
    await stage('single', [track('b')]);

    expect(session.queue.map((t) => t.id)).toEqual(['b']);
    expect(release).toHaveBeenCalledWith('a');
    // docs/02 §4: capacity is measured against an EMPTY queue when replacing,
    // or the second import would be rejected by its own cap.
    expect(lastInput?.queue).toEqual([]);
  });
});

describe('mode switching — docs/03 §3', () => {
  it('keeps the queue when switching Playlist → Single, and says why Start is off', async () => {
    await stage('playlist', [track('a'), track('b'), track('c')]);
    session.setMode('single');

    // Truncating would discard the user's work silently; blocking the tab would
    // strand them. docs/02 §1 makes readiness a predicate, so Start just stops.
    expect(session.queue).toHaveLength(3);
    expect(session.canStart).toBe(false);
  });

  it.each(['single', 'playlist', 'youtube'] as const)('adopts %s at boot', (mode) => {
    session.adoptMode(mode);
    expect(session.mode).toBe(mode);
  });

  it('does NOT rewrite a remembered youtube back to playlist', async () => {
    // P3 fell back here because YouTube was not built. Leaving that in place
    // once P4 shipped the tab produced a specific, silent bug: `setMode`
    // persists `lastMode`, so a user who picked YouTube had it saved correctly
    // and then rewritten on every single reload — a preference that stored
    // perfectly and never came back.
    session.setMode('youtube');
    expect(settings.current.lastMode).toBe('youtube');

    vi.resetModules();
    const fresh = (await import('../../src/app/state/session.svelte')).session;
    fresh.adoptMode('youtube');
    expect(fresh.mode).toBe('youtube');
  });
});

describe('offline — docs/06 §8', () => {
  it('blocks Start in YouTube mode, rather than letting every track fail', async () => {
    // Allowing Start would mean onError 150 on each track, five seconds apart,
    // with the countdown already running — the worst version of this.
    session.setMode('youtube');
    session.countdownMs = 60_000;
    importLinks.mockResolvedValueOnce(result([track('a', { source: 'youtube' })]));
    await session.importLinks('dQw4w9WgXcQ');
    // The queue is valid, so a false `canStart` below can only be the network.
    expect(session.canStart).toBe(true);

    session.setOnline(false);
    expect(session.canStart).toBe(false);
    session.setOnline(true);
    expect(session.online).toBe(true);
  });

  it('does NOT block a local queue — files are in RAM and never touch the network', async () => {
    await settings.patch({ shuffle: false });
    await stage('playlist', [track('a')]);
    session.countdownMs = 60_000;

    session.setOnline(false);
    expect(session.canStart).toBe(true);
  });
});

describe('advance — docs/02 §5 and §5.1 rule 6', () => {
  beforeEach(async () => {
    await settings.patch({ shuffle: false, repeatPlaylist: true });
  });

  it('walks the queue in order from Start', async () => {
    await stage('playlist', [track('a'), track('b'), track('c')]);
    session.start();

    expect(session.currentId).toBe('a');
    expect(session.advance()).toBe('advanced');
    expect(session.currentId).toBe('b');
    expect(session.advance()).toBe('advanced');
    expect(session.currentId).toBe('c');
  });

  it('wraps to the head when Repeat is on', async () => {
    await stage('playlist', [track('a'), track('b')]);
    session.start();
    session.advance();

    expect(session.advance()).toBe('wrapped');
    expect(session.currentId).toBe('a');
    expect(session.exhausted).toBe(false);
  });

  it('falls silent with Repeat off — and the countdown is not touched', async () => {
    await settings.patch({ repeatPlaylist: false });
    await stage('playlist', [track('a'), track('b')]);
    session.start();
    session.advance();

    expect(session.advance()).toBe('exhausted');
    expect(session.exhausted).toBe(true);
    // docs/02 §5.1 rule 6 / docs/04 §5: media stops, the RUN does not. A
    // countdown that quietly died because a playlist ran out would be worse.
    expect(session.state).toBe('playing');
  });

  it('never advances in Single mode, even with one track and Repeat on', async () => {
    // docs/02 §6's carve-out. Without the mode guard, a one-track queue would
    // "wrap" onto the track that just failed and retry it forever.
    await stage('single', [track('a')]);
    session.start();
    expect(session.advance()).toBe('exhausted');
  });

  it('skips a track that errored out', async () => {
    await stage('playlist', [track('a'), track('b'), track('c')]);
    session.start();
    session.markTrackError('b');
    expect(session.order).toEqual(['a', 'c']);
    expect(session.advance()).toBe('advanced');
    expect(session.currentId).toBe('c');
  });
});

describe('queue mutation while playing — docs/02 §5.1', () => {
  beforeEach(async () => {
    await settings.patch({ shuffle: false, repeatPlaylist: true });
  });

  it('removing the CURRENT track advances to the one after it, not back to the top', async () => {
    await stage('playlist', [track('a'), track('b'), track('c')]);
    session.start();
    session.advance(); // on 'b'

    session.removeTrack('b');

    // Marking or filtering first would strand the cursor, after which
    // nextInOrder can only restart — landing on 'a', a track already played.
    expect(session.currentId).toBe('c');
    expect(session.queue.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('removing a track that is not playing leaves the cursor alone', async () => {
    await stage('playlist', [track('a'), track('b'), track('c')]);
    session.start();
    session.removeTrack('c');
    expect(session.currentId).toBe('a');
  });

  it('removing the last remaining track clears the cursor rather than looping on a hole', async () => {
    await stage('playlist', [track('a')]);
    session.start();
    session.removeTrack('a');
    expect(session.currentId).toBeNull();
    expect(session.queue).toEqual([]);
  });

  it('importing during a shuffled run appends and does not reshuffle the remainder', async () => {
    await settings.patch({ shuffle: true });
    await stage('playlist', [track('a'), track('b'), track('c')]);
    session.start();
    const before = [...session.order];

    await stage('playlist', [track('d')]);

    // Reconcile, never regenerate (rule 5): the part the user has not heard yet
    // must not be silently rewritten mid-run.
    expect(session.order.slice(0, 3)).toEqual(before);
    expect(session.order).toHaveLength(4);
  });
});

describe('import progress — docs/02 §4', () => {
  /**
   * The requirement is not "show a bar while importing", it is "do not flash a
   * bar at someone importing one file". P2 deferred the indicator for exactly
   * that reason, so a version without a threshold would be the thing the
   * deferral was avoiding — and would pass any test that only checked the bar
   * eventually appears.
   */
  it('stays hidden for an import that finishes quickly', async () => {
    let release: (r: TtImportResult) => void = () => undefined;
    importFiles.mockReturnValueOnce(
      new Promise<TtImportResult>((resolve) => {
        release = resolve;
      }),
    );
    session.setMode('playlist');
    const run = session.importPicked(files(1) as unknown as FileList);

    // Mid-flight, before the threshold.
    expect(session.progress).toBeNull();
    release(result([track('a')]));
    await run;
    expect(session.progress).toBeNull();
  });

  it('appears once the batch outlasts the threshold, and reports live counts', async () => {
    vi.useFakeTimers();
    try {
      let release: (r: TtImportResult) => void = () => undefined;
      importFiles.mockReturnValueOnce(
        new Promise<TtImportResult>((resolve) => {
          release = resolve;
        }),
      );
      session.setMode('playlist');
      const run = session.importPicked(files(95) as unknown as FileList);

      expect(session.progress).toBeNull();
      vi.advanceTimersByTime(400);
      expect(session.progress).toEqual({ done: 0, total: 95 });

      // The pipeline reports through the injected port.
      lastPorts?.onProgress?.(42, 95);
      expect(session.progress).toEqual({ done: 42, total: 95 });

      release(result([]));
      await run;
      // Cleared when the batch ends, so a finished import leaves no bar behind.
      expect(session.progress).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('moveTrack — docs/02 §5.1 rule 1', () => {
  beforeEach(async () => {
    await settings.patch({ shuffle: false, repeatPlaylist: true });
  });

  it('moves a row and reports where it landed', async () => {
    await stage('playlist', [track('a'), track('b'), track('c')]);
    expect(session.moveTrack('c', -1)).toBe(1);
    expect(session.queue.map((t) => t.id)).toEqual(['a', 'c', 'b']);
  });

  it('clamps at the ends instead of wrapping', async () => {
    // A held Alt+↑ should stop at the top, not cycle the queue forever.
    await stage('playlist', [track('a'), track('b')]);
    expect(session.moveTrack('a', -1)).toBeNull();
    expect(session.moveTrack('b', 1)).toBeNull();
    expect(session.queue.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('ignores an id that is not in the queue', async () => {
    await stage('playlist', [track('a')]);
    expect(session.moveTrack('gone', 1)).toBeNull();
  });

  it('with Shuffle OFF the playback order follows immediately', async () => {
    await stage('playlist', [track('a'), track('b'), track('c')]);
    session.start();
    expect(session.order).toEqual(['a', 'b', 'c']);

    session.moveTrack('c', -1);

    // Derived, not synced: there is no stored permutation to keep in step.
    expect(session.order).toEqual(['a', 'c', 'b']);
    expect(nextInOrder(session.order, 'a')).toBe('c');
  });

  it('with Shuffle ON the stored permutation is NOT touched', async () => {
    await settings.patch({ shuffle: true });
    await stage('playlist', [track('a'), track('b'), track('c'), track('d')]);
    session.start();
    const before = [...session.order];

    session.moveTrack(session.queue[3]?.id ?? '', -3);

    // Rule 1: a drag reorders what the user SEES, never what they are about to
    // hear. Remapping a permutation nobody can see would be invisible cause.
    expect(session.order).toEqual(before);
    expect(session.queue[0]?.id).toBe('d');
  });

  it('never moves the cursor, even when the playing row is the one dragged', async () => {
    await stage('playlist', [track('a'), track('b'), track('c')]);
    session.start();
    session.advance(); // on 'b'

    session.moveTrack('b', 1);

    // Free, because the cursor names a track rather than a position — which is
    // the entire reason docs/02 §5.1 chose an id.
    expect(session.currentId).toBe('b');
    expect(session.queue.map((t) => t.id)).toEqual(['a', 'c', 'b']);
    // And it is genuinely last now, so there is nothing after it.
    expect(nextInOrder(session.order, 'b')).toBeNull();
  });
});

describe('shuffle — docs/02 §5.1 rule 2', () => {
  it('toggling mid-run keeps the current track current', async () => {
    await settings.patch({ shuffle: false, repeatPlaylist: true });
    await stage('playlist', [track('a'), track('b'), track('c'), track('d')]);
    session.start();
    session.advance(); // on 'b'

    session.setShuffle(true);

    // "Immediate" must mean "reorder the future", never "cut off the present".
    expect(session.currentId).toBe('b');
    expect(session.order[0]).toBe('b');
    expect([...session.order].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('turning it off returns to queue order with the cursor intact', async () => {
    await settings.patch({ shuffle: true, repeatPlaylist: true });
    await stage('playlist', [track('a'), track('b'), track('c')]);
    session.start();

    const seated = session.currentId;
    session.setShuffle(false);

    expect(session.order).toEqual(['a', 'b', 'c']);
    expect(session.currentId).toBe(seated);
  });

  it('persists the flag, so the Playback settings group and the rail agree', async () => {
    session.setShuffle(true);
    expect(settings.current.shuffle).toBe(true);
  });
});

describe('transport predicates — docs/03 §2 Z7', () => {
  it('disables both in Single mode, where there is nowhere to go', async () => {
    await stage('single', [track('a')]);
    session.start();
    expect(session.canPrev).toBe(false);
    expect(session.canNext).toBe(false);
  });

  it('⏮ is inert at the first track — it does not wrap to the end', async () => {
    await settings.patch({ shuffle: false });
    await stage('playlist', [track('a'), track('b')]);
    session.start();
    expect(session.canPrev).toBe(false);
    expect(session.prev()).toBe(false);

    session.advance();
    expect(session.canPrev).toBe(true);
    expect(session.prev()).toBe(true);
    expect(session.currentId).toBe('a');
  });
});
