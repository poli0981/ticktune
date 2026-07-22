import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TtImportResult, TtTrack } from '../../src/app/engine/importer/types';
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
  importFiles: (input: unknown) => {
    lastInput = input as ImportInput;
    return importFiles();
  },
}));

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
  vi.clearAllMocks();
  lastInput = null;
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

  it('adopts the remembered mode at boot, but never a mode this build lacks', () => {
    session.adoptMode('playlist');
    expect(session.mode).toBe('playlist');
    // YouTube is P4. Falling back beats writing over a real preference — which
    // is the same reasoning that let P3 unlock a tab rather than repair a value.
    session.adoptMode('youtube');
    expect(session.mode).toBe('playlist');
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
