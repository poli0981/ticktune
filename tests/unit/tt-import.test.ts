import { describe, expect, it, vi } from 'vitest';
import { TT_MAX_TRACK_MS, dedupeKey, importFiles } from '../../src/app/engine/importer/tt-import';
import { TT_MAX_PLAYLIST_TOTAL_MS } from '../../src/app/engine/importer/tt-queue-rules';
import type { TtImportPorts, TtRawTags, TtTrack } from '../../src/app/engine/importer/types';

/** docs/02 §4 — every rejection boundary, at its exact value. */

function file(name: string, size = 1_000): File {
  return new File([new Uint8Array(size)], name, { type: '' });
}

/**
 * Ports with counters, so the ORDERING regression is observable: the whole
 * point of docs/02 §4's step 0 is that these are not called for files the
 * capacity check has already excluded.
 */
function makePorts(durations: Record<string, number | null> = {}) {
  let id = 0;
  const parseTags = vi.fn(async (f: File): Promise<TtRawTags | null> => {
    // `in`, not `??`: a mapped `null` means "the parse found no duration", and
    // `null ?? 60_000` would quietly turn every such case into a known one.
    const durationMs = f.name in durations ? durations[f.name]! : 60_000;
    return { tagTypes: ['ID3v2.3'], title: `tag:${f.name}`, artist: 'A', durationMs };
  });
  const probeDuration = vi.fn(async (): Promise<number | null> => null);

  const makeCoverUrl = vi.fn((trackId: string) => `blob:cover-${trackId}`);

  const ports: TtImportPorts = {
    newId: () => `id-${++id}`,
    now: () => 1_700_000_000_000,
    canPlay: () => 'probably',
    parseTags,
    probeDuration,
    makeCoverUrl,
  };
  return { ports, parseTags, probeDuration, makeCoverUrl };
}

const base = { queue: [] as TtTrack[], allowDuplicates: false };

describe('dedupeKey', () => {
  it('is name + size + duration, with no content hashing', () => {
    expect(dedupeKey('a.mp3', 100, 5_000)).toBe('a.mp3::100::5000');
    // Unknown duration must not collapse two different files into one key.
    expect(dedupeKey('a.mp3', 100, null)).toBe('a.mp3::100::?');
    expect(dedupeKey('a.mp3', 100, null)).not.toBe(dedupeKey('a.mp3', 100, 5_000));
  });
});

describe('step 0 — capacity, hoisted ahead of all per-file work', () => {
  it('parses AT MOST ONCE for a 40-file drop in Single mode', async () => {
    // The ordering regression. Before the docs/02 §4 fix, the duration decode
    // ran for every dropped file and only then met the count cap — 40 sequential
    // probes to add one track.
    const { ports, parseTags, probeDuration } = makePorts();
    const files = Array.from({ length: 40 }, (_, i) => file(`t${i}.mp3`));

    const r = await importFiles({ ...base, files, mode: 'single' }, ports);

    expect(r.added).toHaveLength(1);
    expect(parseTags).toHaveBeenCalledTimes(1);
    expect(probeDuration).not.toHaveBeenCalled();
    // The other 39 are reported, not silently dropped (docs/01 §2 principle 5).
    expect(r.skipped).toHaveLength(39);
    expect(r.skipped.every((s) => s.code === 'TT-IMP-004')).toBe(true);
  });

  it('counts the EXISTING queue against the cap', async () => {
    const { ports, parseTags } = makePorts();
    const held = [{ status: 'ok' } as TtTrack];

    const r = await importFiles(
      { ...base, files: [file('a.mp3')], mode: 'single', queue: held },
      ports,
    );

    expect(r.added).toHaveLength(0);
    expect(parseTags).not.toHaveBeenCalled();
    expect(r.skipped[0]?.code).toBe('TT-IMP-004');
  });

  it('does not count error tracks against the cap', async () => {
    // docs/02 §1: `error` is excluded from validity, so it must not consume
    // capacity either — otherwise a broken track blocks its own replacement.
    const { ports } = makePorts();
    const broken = [{ status: 'error' } as TtTrack];

    const r = await importFiles(
      { ...base, files: [file('a.mp3')], mode: 'single', queue: broken },
      ports,
    );
    expect(r.added).toHaveLength(1);
  });

  it('stops a playlist at the 95th file', async () => {
    // 1 s each, so the 91:00 TOTAL cap cannot fire first and steal the
    // assertion — this test is about the COUNT cap alone.
    const files = Array.from({ length: 96 }, (_, i) => file(`t${i}.mp3`));
    const { ports } = makePorts(Object.fromEntries(files.map((f) => [f.name, 1_000])));

    const r = await importFiles({ ...base, files, mode: 'playlist' }, ports);

    expect(r.added).toHaveLength(95);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]?.code).toBe('TT-IMP-004');
  });
});

describe('step 1 — the allow-list (TT-IMP-001)', () => {
  it('rejects a container outside the list', async () => {
    const { ports, parseTags } = makePorts();
    const r = await importFiles({ ...base, files: [file('x.aiff')], mode: 'single' }, ports);

    expect(r.added).toHaveLength(0);
    expect(r.skipped[0]?.code).toBe('TT-IMP-001');
    // Rejected before any parsing — the cheap check comes first.
    expect(parseTags).not.toHaveBeenCalled();
  });

  it('rejects an allowed extension the browser refuses', async () => {
    const { ports } = makePorts();
    const safari: TtImportPorts = { ...ports, canPlay: () => '' };
    const r = await importFiles({ ...base, files: [file('x.opus')], mode: 'single' }, safari);
    expect(r.skipped[0]?.code).toBe('TT-IMP-001');
  });
});

describe('step 3 — the 10:02 cap (TT-IMP-002)', () => {
  it('accepts exactly 602 000 ms and rejects 602 001', async () => {
    const { ports } = makePorts({ 'ok.mp3': TT_MAX_TRACK_MS, 'no.mp3': TT_MAX_TRACK_MS + 1 });

    const ok = await importFiles({ ...base, files: [file('ok.mp3')], mode: 'single' }, ports);
    expect(ok.added).toHaveLength(1);

    const no = await importFiles({ ...base, files: [file('no.mp3')], mode: 'single' }, ports);
    expect(no.added).toHaveLength(0);
    expect(no.skipped[0]?.code).toBe('TT-IMP-002');
  });

  it('imports a file of unknown duration rather than guessing', async () => {
    // Neither the parse nor the probe knows. Rejecting on "unknown > cap" would
    // discard perfectly good files; docs/02 §2 renders the duration as `–`.
    const { ports } = makePorts({ 'x.mp3': null });
    const noProbe: TtImportPorts = { ...ports, probeDuration: async () => null };

    const r = await importFiles({ ...base, files: [file('x.mp3')], mode: 'single' }, noProbe);
    expect(r.added).toHaveLength(1);
    expect(r.added[0]?.durationMs).toBeNull();
  });

  it('uses the element probe only when the parse has no duration', async () => {
    const { ports, probeDuration } = makePorts({ 'a.mp3': 30_000, 'b.mp3': null });
    probeDuration.mockResolvedValue(45_000);

    const r = await importFiles(
      { ...base, files: [file('a.mp3'), file('b.mp3')], mode: 'playlist' },
      ports,
    );

    // docs/05 §5: parseBlob's duration is authoritative; the probe is a fallback
    // and is the more expensive path.
    expect(probeDuration).toHaveBeenCalledTimes(1);
    expect(r.added[0]?.durationMs).toBe(30_000);
    expect(r.added[1]?.durationMs).toBe(45_000);
  });
});

describe('step 4 — the playlist total (TT-IMP-003)', () => {
  it('rejects the file that would cross 91:00 and keeps the earlier ones', async () => {
    // docs/02 §4: accepted files are kept when a later file trips a limit.
    // 10 minutes each — under the 10:02 per-track cap, so only the TOTAL can
    // fire. 9 fit in 91:00 (54:00... 90:00); the 10th would reach 100:00.
    const each = 600_000;
    const files = Array.from({ length: 10 }, (_, i) => file(`t${i}.mp3`));
    const { ports } = makePorts(Object.fromEntries(files.map((f) => [f.name, each])));

    const r = await importFiles({ ...base, files, mode: 'playlist' }, ports);

    expect(TT_MAX_PLAYLIST_TOTAL_MS).toBe(5_460_000);
    expect(r.added).toHaveLength(9);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]?.code).toBe('TT-IMP-003');
  });

  it('does not apply the total to Single mode', async () => {
    const { ports } = makePorts({ 'a.mp3': 600_000 });
    const r = await importFiles({ ...base, files: [file('a.mp3')], mode: 'single' }, ports);
    expect(r.added).toHaveLength(1);
  });
});

describe('step 5 — dedupe (TT-IMP-005)', () => {
  it('skips a duplicate within one batch', async () => {
    const { ports } = makePorts();
    const r = await importFiles(
      { ...base, files: [file('a.mp3'), file('a.mp3')], mode: 'playlist' },
      ports,
    );

    expect(r.added).toHaveLength(1);
    expect(r.skipped[0]?.code).toBe('TT-IMP-005');
  });

  it('skips a duplicate of something already queued', async () => {
    const { ports } = makePorts();
    const queued = [
      { status: 'ok', fileName: 'a.mp3', fileSizeBytes: 1_000, durationMs: 60_000 } as TtTrack,
    ];

    const r = await importFiles(
      { ...base, files: [file('a.mp3')], mode: 'playlist', queue: queued },
      ports,
    );
    expect(r.skipped[0]?.code).toBe('TT-IMP-005');
  });

  it('allowDuplicates bypasses the check', async () => {
    const { ports } = makePorts();
    const r = await importFiles(
      { ...base, files: [file('a.mp3'), file('a.mp3')], mode: 'playlist', allowDuplicates: true },
      ports,
    );
    expect(r.added).toHaveLength(2);
  });

  it('does not treat same-named files of different size as duplicates', async () => {
    const { ports } = makePorts();
    const r = await importFiles(
      { ...base, files: [file('a.mp3', 1_000), file('a.mp3', 2_000)], mode: 'playlist' },
      ports,
    );
    expect(r.added).toHaveLength(2);
  });
});

describe('the produced track', () => {
  it('carries the file, its facts and an injected id', async () => {
    const { ports } = makePorts({ 'song.mp3': 200_000 });
    const f = file('song.mp3', 4_096);

    const r = await importFiles({ ...base, files: [f], mode: 'single' }, ports);
    const t = r.added[0]!;

    expect(t.id).toBe('id-1');
    expect(t.source).toBe('local');
    expect(t.status).toBe('ok');
    expect(t.file).toBe(f);
    expect(t.fileName).toBe('song.mp3');
    expect(t.fileSizeBytes).toBe(4_096);
    expect(t.durationMs).toBe(200_000);
    expect(t.addedAt).toBe(1_700_000_000_000);
    // The media URL is NOT a field on the track: it lives in the ledger under
    // `media:<id>` (docs/05 §3), created lazily at first play. `TtTrack.objectUrl`
    // was declared through P2 and never written by anything, so this assertion
    // used to check that a dead field stayed dead. The field is gone in P3; what
    // is worth asserting is that importing creates no URL at all.
    expect(t).not.toHaveProperty('objectUrl');
  });

  it('registers embedded cover art under the track id (docs/05 §3, §5)', async () => {
    // The gap this test exists to close: `coverArtUrl` was declared on TtTrack
    // and read by the info modal, but nothing ever wrote it — so every track
    // reported "no cover" no matter what the file contained.
    const { ports, makeCoverUrl } = makePorts();
    const bytes = new Uint8Array([1, 2, 3]);
    const withCover: TtImportPorts = {
      ...ports,
      parseTags: async () => ({
        tagTypes: ['ID3v2.3'],
        title: 'T',
        durationMs: 60_000,
        coverArt: { bytes, mime: 'image/png' },
      }),
    };

    const r = await importFiles({ ...base, files: [file('a.mp3')], mode: 'single' }, withCover);

    expect(makeCoverUrl).toHaveBeenCalledWith('id-1', bytes, 'image/png');
    // Keyed by the id the pipeline minted, so removing the track revokes it.
    expect(r.added[0]?.coverArtUrl).toBe('blob:cover-id-1');
  });

  it('leaves coverArtUrl ABSENT when the file has no picture', async () => {
    const { ports, makeCoverUrl } = makePorts();
    const r = await importFiles({ ...base, files: [file('a.mp3')], mode: 'single' }, ports);

    expect(makeCoverUrl).not.toHaveBeenCalled();
    // Absent, not undefined — exactOptionalPropertyTypes, and the display rule
    // keys on absence to render N/A.
    expect('coverArtUrl' in r.added[0]!).toBe(false);
  });

  it('imports the track even when the cover cannot be registered', async () => {
    // A cover is decoration; losing one must not fail an otherwise fine import.
    const { ports } = makePorts();
    const broken: TtImportPorts = {
      ...ports,
      makeCoverUrl: () => null,
      parseTags: async () => ({
        tagTypes: ['ID3v2.3'],
        title: 'T',
        durationMs: 1_000,
        coverArt: { bytes: new Uint8Array([9]), mime: 'image/jpeg' },
      }),
    };

    const r = await importFiles({ ...base, files: [file('a.mp3')], mode: 'single' }, broken);
    expect(r.added).toHaveLength(1);
    expect('coverArtUrl' in r.added[0]!).toBe(false);
  });

  it('reports a non-fatal parse failure as a note and still adds the track', async () => {
    const { ports } = makePorts();
    const failing: TtImportPorts = {
      ...ports,
      parseTags: async () => {
        throw new Error('unparseable');
      },
      probeDuration: async () => 12_000,
    };

    const r = await importFiles(
      { ...base, files: [file('Real Name.mp3')], mode: 'single' },
      failing,
    );

    expect(r.added).toHaveLength(1);
    expect(r.added[0]?.title).toBe('Real Name');
    expect(r.notes[0]?.code).toBe('TT-IMP-006');
    // A note, not a skip — the distinction the toast copy depends on.
    expect(r.skipped).toHaveLength(0);
  });

  it('survives a probe that throws', async () => {
    const { ports } = makePorts({ 'x.mp3': null });
    const failing: TtImportPorts = {
      ...ports,
      probeDuration: async () => {
        throw new Error('decode error');
      },
    };

    const r = await importFiles({ ...base, files: [file('x.mp3')], mode: 'single' }, failing);
    expect(r.added).toHaveLength(1);
    expect(r.added[0]?.durationMs).toBeNull();
  });
});
