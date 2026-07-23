import { describe, expect, it, vi } from 'vitest';
import { importLinks, reachedEdge } from '../../src/app/engine/youtube/tt-yt-import';
import type { TtYtLookup, TtYtPorts } from '../../src/app/engine/youtube/types';
import type { TtImportResult, TtTrack } from '../../src/app/engine/importer/types';

/**
 * The YouTube import pipeline — docs/06 §5.
 *
 * Every branch here is reachable without the network, without Playwright and
 * without YouTube being up, which is the entire reason `lookup` is a port. CI
 * cannot depend on YouTube's servers at all (docs/13 §4), so a pipeline that
 * could only be exercised end-to-end would ship untested.
 */

const OK: TtYtLookup = {
  ok: true,
  meta: {
    title: 'Never Gonna Give You Up',
    author_name: 'Rick Astley',
    thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  },
};

let n = 0;
function makePorts(lookup: TtYtPorts['lookup']): TtYtPorts {
  n = 0;
  return {
    newId: () => `id-${(n += 1)}`,
    now: () => 1_700_000_000_000,
    lookup,
  };
}

const always = (r: TtYtLookup) => makePorts(() => Promise.resolve(r));
const fail = (cause: Extract<TtYtLookup, { ok: false }>['cause']) => always({ ok: false, cause });

const base = { queue: [] as TtTrack[], allowDuplicates: false };
const ID = 'dQw4w9WgXcQ';

describe('the happy path writes the fields nobody was writing', () => {
  it('fills videoId, sourceUrl and thumbnailUrl — asserted as values, not types', async () => {
    // All three have been declared on TtTrack since the first revision with
    // nothing ever assigning them. That is the exact shape of this project's
    // escaped bugs (coverArtUrl, allowDuplicates, objectUrl), so the assertion
    // is on the value.
    const r = await importLinks({ ...base, text: `https://youtu.be/${ID}` }, always(OK));
    const t = r.added[0];

    expect(t?.source).toBe('youtube');
    expect(t?.videoId).toBe(ID);
    expect(t?.sourceUrl).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(t?.thumbnailUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(t?.title).toBe('Never Gonna Give You Up');
    expect(t?.artist).toBe('Rick Astley');
    expect(t?.status).toBe('ok');
  });

  it('leaves durationMs null — the player backfills it (docs/06 §2, §5)', async () => {
    const r = await importLinks({ ...base, text: ID }, always(OK));
    expect(r.added[0]?.durationMs).toBeNull();
  });

  it('leaves a missing title EMPTY rather than baking in "N/A"', async () => {
    // The fallback is a render-time rule (tt-track-display). Baking it in here
    // would make a real title of "N/A" indistinguishable from a missing one.
    const r = await importLinks(
      { ...base, text: ID },
      always({ ok: true, meta: { title: null, author_name: null, thumbnail_url: null } }),
    );
    expect(r.added[0]?.title).toBe('');
    expect(r.added[0]).not.toHaveProperty('thumbnailUrl');
  });
});

describe('cause → code, the S1 mapping', () => {
  it.each([
    ['invalid_id', 'TT-YT-002'],
    ['embed_off', 'TT-YT-101'],
    ['private', 'TT-YT-100'],
    ['not_found', 'TT-YT-100'],
    ['unavailable', 'TT-YT-004'],
  ] as const)('%s rejects with %s', async (cause, code) => {
    const r = await importLinks({ ...base, text: ID }, fail(cause));
    expect(r.added).toHaveLength(0);
    expect(r.skipped).toEqual([{ code, fileName: ID }]);
  });

  it('never labels an unclassified failure as "gone"', async () => {
    // TT-YT-004 exists so an unmeasured status cannot borrow a confident wrong
    // sentence from the not_found row.
    const r = await importLinks({ ...base, text: ID }, fail('unavailable'));
    expect(r.skipped[0]?.code).not.toBe('TT-YT-100');
  });
});

describe('transient failures keep the track — docs/02 §1, docs/06 §5', () => {
  it.each(['upstream_unreachable', 'rate_limited'] as const)(
    '%s becomes a pending track, not a rejection',
    async (cause) => {
      const r = await importLinks({ ...base, text: ID }, fail(cause));

      expect(r.added).toHaveLength(1);
      expect(r.added[0]?.status).toBe('pending');
      // A NOTE, not a skip: the track WAS added, so counting it among the skips
      // would make the summary toast wrong about both numbers.
      expect(r.skipped).toHaveLength(0);
      expect(r.notes).toEqual([{ code: 'TT-YT-001', fileName: ID }]);
    },
  );

  it('a rate limit is not reported as a broken network', async () => {
    // Same code to the user, but they are different states and the diagnostics
    // blob has to be able to tell them apart later.
    const rate = await importLinks({ ...base, text: ID }, fail('rate_limited'));
    expect(rate.added[0]?.status).toBe('pending');
  });
});

describe('dedupe by videoId — docs/06 §5 step 2', () => {
  it('skips a repeat within one paste', async () => {
    const r = await importLinks(
      { ...base, text: [ID, `https://youtu.be/${ID}`].join('\n') },
      always(OK),
    );
    expect(r.added).toHaveLength(1);
    expect(r.skipped).toEqual([{ code: 'TT-IMP-005', fileName: ID }]);
  });

  it('skips one already in the queue', async () => {
    const queue = [{ videoId: ID, status: 'ok' } as unknown as TtTrack];
    const r = await importLinks({ ...base, queue, text: ID }, always(OK));
    expect(r.added).toHaveLength(0);
    expect(r.skipped[0]?.code).toBe('TT-IMP-005');
  });

  it('allowDuplicates lets it through', async () => {
    const r = await importLinks(
      { ...base, allowDuplicates: true, text: [ID, ID].join('\n') },
      always(OK),
    );
    expect(r.added).toHaveLength(2);
  });

  it('does not spend a lookup on a duplicate', async () => {
    const lookup = vi.fn<TtYtPorts['lookup']>().mockResolvedValue(OK);
    await importLinks({ ...base, text: [ID, ID].join('\n') }, makePorts(lookup));
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});

describe('the 50-link cap — TT-YT-003, not TT-IMP-004', () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, i) => `vid${String(i).padStart(8, '0')}`).join('\n');

  it('takes 50 and refuses the 51st', async () => {
    const r = await importLinks({ ...base, text: many(51) }, always(OK));
    expect(r.added).toHaveLength(50);
    expect(r.skipped).toHaveLength(1);
    // docs/06 §5 step 3 gives the link cap its own code. Reusing the local
    // TT-IMP-004 would put "quá số lượng tệp" in front of someone who pasted
    // links.
    expect(r.skipped[0]?.code).toBe('TT-YT-003');
  });

  it('measures capacity against what is already queued', async () => {
    const queue = Array.from({ length: 48 }, (_, i) => ({
      videoId: `have${String(i).padStart(7, '0')}`,
      status: 'ok',
    })) as unknown as TtTrack[];
    const r = await importLinks({ ...base, queue, text: many(5) }, always(OK));
    expect(r.added).toHaveLength(2);
    expect(r.skipped.filter((s) => s.code === 'TT-YT-003')).toHaveLength(3);
  });

  it('checks the cap BEFORE spending any lookups', async () => {
    // The docs/02 §4 step-0 lesson, applied to the network: checking after
    // would spend 51 round-trips to add 50 tracks.
    const lookup = vi.fn<TtYtPorts['lookup']>().mockResolvedValue(OK);
    await importLinks({ ...base, text: many(80) }, makePorts(lookup));
    expect(lookup).toHaveBeenCalledTimes(50);
  });
});

describe('lines that are not links', () => {
  it('rejects each with TT-YT-002 and keeps the good ones', async () => {
    const r = await importLinks(
      { ...base, text: ['not a link', `https://youtu.be/${ID}`, 'https://vimeo.com/1'].join('\n') },
      always(OK),
    );
    expect(r.added).toHaveLength(1);
    expect(r.skipped.map((s) => s.code)).toEqual(['TT-YT-002', 'TT-YT-002']);
    // The offending line is carried for the toast — docs/12 §6 keeps it out of
    // the LOG, not out of the UI.
    expect(r.skipped[0]?.fileName).toBe('not a link');
  });

  it('spends no lookup on them', async () => {
    const lookup = vi.fn<TtYtPorts['lookup']>().mockResolvedValue(OK);
    await importLinks({ ...base, text: 'nonsense\nalso nonsense' }, makePorts(lookup));
    expect(lookup).not.toHaveBeenCalled();
  });

  it('an empty paste is not an error', async () => {
    const r = await importLinks({ ...base, text: '\n  \n' }, always(OK));
    expect(r).toEqual({ added: [], skipped: [], notes: [] });
  });
});

describe('progress — docs/02 §4', () => {
  it('reports per link and finishes at total', async () => {
    const onProgress = vi.fn();
    const ports = { ...always(OK), onProgress };
    await importLinks({ ...base, text: ['a0000000000', 'b0000000000'].join('\n') }, ports);

    expect(onProgress.mock.calls).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });
});

describe('reachedEdge — docs/06 §8, the authority the doc always named', () => {
  /**
   * Found on the live v0.5.0 run. The user turned their network off, every link
   * imported as `N/A` — which only happens when the lookup fails — and the
   * offline banner never appeared, because `navigator.onLine` stayed `true`.
   * Chrome reports it from whether an interface is up, not from whether
   * anything is reachable. `§8` had already said the import result is the
   * authority; nothing implemented that half.
   */
  const res = (over: Partial<TtImportResult> = {}): TtImportResult => ({
    added: [],
    skipped: [],
    notes: [],
    ...over,
  });

  const track = (status: 'ok' | 'pending'): TtTrack => ({
    id: 'a',
    source: 'youtube',
    status,
    title: '',
    artist: '',
    durationMs: null,
    videoId: 'dQw4w9WgXcQ',
    addedAt: 0,
  });

  it('a track that imported proves we got through', () => {
    expect(reachedEdge(res({ added: [track('ok')] }))).toBe(true);
  });

  it.each(['TT-YT-100', 'TT-YT-101', 'TT-YT-004'] as const)(
    'a refusal the edge NAMED (%s) also proves we got through',
    (code) => {
      // A cause is only nameable if our own endpoint produced it, so being told
      // "that video is gone" is proof of reachability even though nothing was
      // added.
      expect(reachedEdge(res({ skipped: [{ code, fileName: 'x' }] }))).toBe(true);
    },
  );

  it('a transient note means we did NOT get through', () => {
    expect(reachedEdge(res({ notes: [{ code: 'TT-YT-001', fileName: 'x' }] }))).toBe(false);
  });

  it('one success outweighs any number of transient failures', () => {
    // A partly-failed batch still proves the connection exists; raising the
    // banner there would contradict what the user just saw work.
    expect(
      reachedEdge(
        res({
          added: [track('ok'), track('pending')],
          notes: [{ code: 'TT-YT-001', fileName: 'x' }],
        }),
      ),
    ).toBe(true);
  });

  it('proves NOTHING when the batch never touched the network', () => {
    // The trap this returns null for: a paste of nothing but malformed links is
    // rejected by the regex before any fetch, and calling that "offline" would
    // raise the banner on a perfectly good connection.
    expect(reachedEdge(res({ skipped: [{ code: 'TT-YT-002', fileName: 'junk' }] }))).toBeNull();
    expect(reachedEdge(res({ skipped: [{ code: 'TT-YT-003', fileName: 'over' }] }))).toBeNull();
    expect(reachedEdge(res({ skipped: [{ code: 'TT-IMP-005', fileName: 'dup' }] }))).toBeNull();
    expect(reachedEdge(res())).toBeNull();
  });
});
