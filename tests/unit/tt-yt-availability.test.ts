import { describe, expect, it } from 'vitest';
import {
  isYtUnplayable,
  ytCountry,
  ytFactsAreProvisional,
  ytFactsFromCache,
  ytFactsFromItem,
  ytUnplayable,
  type TtYtFacts,
} from '../../src/lib/tt-yt-availability';

/**
 * Availability from the YouTube Data API — docs/06 §3 (v2.3).
 *
 * The facts are what the Worker caches for every visitor, so they must hold
 * nothing about one; the verdict is per visitor, so it must use the country
 * and nothing else. Both halves are pure, and both are what a wrong answer
 * would cost: a playable video the user cannot have, or a dead one that fails
 * on play with the countdown running.
 */

/** A `videos.list` item, as `fields=items(id,contentDetails(...),status(...),snippet/...)` returns it. */
function item({
  embeddable = true,
  ytRating,
  allowed,
  blocked,
  live = 'none',
  upload = 'processed',
  privacy = 'public',
}: {
  embeddable?: boolean;
  ytRating?: string;
  allowed?: unknown;
  blocked?: unknown;
  live?: string;
  upload?: string;
  privacy?: string;
} = {}): unknown {
  const regionRestriction: Record<string, unknown> = {};
  if (allowed !== undefined) regionRestriction.allowed = allowed;
  if (blocked !== undefined) regionRestriction.blocked = blocked;
  return {
    id: 'dQw4w9WgXcQ',
    contentDetails: {
      duration: 'PT3M33S',
      ...(allowed === undefined && blocked === undefined ? {} : { regionRestriction }),
      ...(ytRating === undefined ? {} : { contentRating: { ytRating } }),
    },
    status: { uploadStatus: upload, privacyStatus: privacy, embeddable },
    snippet: { liveBroadcastContent: live },
  };
}

describe('ytFactsFromItem — what Google said, and only what argues against playing', () => {
  it('an ordinary public video carries no facts at all', () => {
    expect(ytFactsFromItem(item())).toEqual({});
  });

  it.each([
    ['embedding off', item({ embeddable: false }), { embedOff: true }],
    ['age-restricted', item({ ytRating: 'ytAgeRestricted' }), { age: true }],
    ['an upcoming premiere or stream', item({ live: 'upcoming' }), { notYet: true }],
    ['an upload still processing', item({ upload: 'uploaded' }), { notYet: true }],
    ['private', item({ privacy: 'private' }), { private: true }],
    ['deleted', item({ upload: 'deleted' }), { gone: true }],
    ['failed', item({ upload: 'failed' }), { gone: true }],
    ['rejected', item({ upload: 'rejected' }), { gone: true }],
    ['allowed only in two countries', item({ allowed: ['US', 'CA'] }), { allowed: ['US', 'CA'] }],
    ['blocked in one country', item({ blocked: ['VN'] }), { blocked: ['VN'] }],
  ])('%s', (_, raw, facts) => {
    expect(ytFactsFromItem(raw)).toEqual(facts);
  });

  it('keeps an EMPTY allowed list — Google says that means blocked everywhere', () => {
    expect(ytFactsFromItem(item({ allowed: [] }))).toEqual({ allowed: [] });
  });

  it('drops a region list with a malformed entry rather than filtering it down to empty', () => {
    // Filtered, ['us'] would become [] — "blocked everywhere" — from a typo.
    expect(ytFactsFromItem(item({ allowed: ['us'] }))).toEqual({});
    expect(ytFactsFromItem(item({ blocked: ['VN', 7] }))).toEqual({});
    expect(ytFactsFromItem(item({ allowed: 'US' }))).toEqual({});
  });

  it('a live stream, an unlisted video and a ytRating it does not know argue nothing', () => {
    expect(ytFactsFromItem(item({ live: 'live' }))).toEqual({});
    expect(ytFactsFromItem(item({ privacy: 'unlisted' }))).toEqual({});
    expect(ytFactsFromItem(item({ ytRating: 'ytSomethingNew' }))).toEqual({});
  });

  it('an item of the wrong shape argues nothing — it does not throw', () => {
    for (const raw of [null, undefined, 'item', 42, [], { status: 'oops', contentDetails: [] }]) {
      expect(ytFactsFromItem(raw)).toEqual({});
    }
  });

  it('holds nothing about the visitor — it is the same for every request', () => {
    // The facts have no country in them; only `ytUnplayable` takes one.
    const facts = ytFactsFromItem(item({ allowed: ['US'] }));
    expect(JSON.stringify(facts)).toBe('{"allowed":["US"]}');
  });
});

describe('ytFactsFromCache — the same facts, read back', () => {
  it('round-trips every fact through JSON', () => {
    const facts: TtYtFacts = {
      embedOff: true,
      age: true,
      allowed: ['US'],
      blocked: [],
      notYet: true,
      private: true,
      gone: true,
    };
    expect(ytFactsFromCache(JSON.parse(JSON.stringify(facts)))).toEqual(facts);
  });

  it('believes only true flags and well-formed lists', () => {
    expect(
      ytFactsFromCache({ embedOff: 'yes', age: 1, notYet: false, allowed: ['xx'], extra: true }),
    ).toEqual({});
    for (const raw of [null, undefined, 'facts', []]) expect(ytFactsFromCache(raw)).toEqual({});
  });
});

describe('ytCountry — a country we can compare, or none', () => {
  it.each([
    ['VN', 'VN'],
    ['US', 'US'],
    ['XX', null], // Cloudflare: unknown
    ['T1', null], // Cloudflare: Tor
    ['vn', null],
    ['VNM', null],
    ['', null],
    [undefined, null],
    [42, null],
  ])('%s → %s', (raw, country) => {
    expect(ytCountry(raw)).toBe(country);
  });
});

describe('ytUnplayable — one reason for this visitor, or none', () => {
  it('no facts, no reason', () => {
    expect(ytUnplayable({}, 'VN')).toBeNull();
  });

  it.each([
    [{ gone: true }, 'not_found'],
    [{ private: true }, 'private'],
    [{ embedOff: true }, 'embed_off'],
    [{ age: true }, 'age_restricted'],
    [{ notYet: true }, 'not_yet'],
  ] as const)('%o → %s', (facts, cause) => {
    expect(ytUnplayable(facts, 'VN')).toBe(cause);
    expect(ytUnplayable(facts, null)).toBe(cause);
  });

  it('the most permanent reason wins', () => {
    expect(ytUnplayable({ gone: true, age: true, blocked: ['VN'] }, 'VN')).toBe('not_found');
    expect(ytUnplayable({ embedOff: true, age: true }, 'VN')).toBe('embed_off');
    expect(ytUnplayable({ age: true, blocked: ['VN'] }, 'VN')).toBe('age_restricted');
    expect(ytUnplayable({ blocked: ['VN'], notYet: true }, 'VN')).toBe('region_blocked');
  });

  describe('the region lists, per country', () => {
    it('allowed: blocked everywhere it does not name', () => {
      const facts: TtYtFacts = { allowed: ['US', 'CA'] };
      expect(ytUnplayable(facts, 'US')).toBeNull();
      expect(ytUnplayable(facts, 'VN')).toBe('region_blocked');
    });

    it('an empty allowed list blocks every country', () => {
      expect(ytUnplayable({ allowed: [] }, 'US')).toBe('region_blocked');
    });

    it('blocked: blocked only where it names', () => {
      const facts: TtYtFacts = { blocked: ['VN'] };
      expect(ytUnplayable(facts, 'VN')).toBe('region_blocked');
      expect(ytUnplayable(facts, 'JP')).toBeNull();
    });

    it('an empty blocked list blocks nowhere', () => {
      expect(ytUnplayable({ blocked: [] }, 'VN')).toBeNull();
    });

    it('with no country we can compare, nobody is refused on a region', () => {
      expect(ytUnplayable({ allowed: ['US'] }, null)).toBeNull();
      expect(ytUnplayable({ blocked: ['VN'] }, null)).toBeNull();
    });
  });
});

describe('ytFactsAreProvisional — what may change within the day', () => {
  it('only "not out yet" is re-asked sooner', () => {
    expect(ytFactsAreProvisional({ notYet: true })).toBe(true);
    const settled: TtYtFacts[] = [{}, { age: true }, { embedOff: true }, { allowed: ['US'] }];
    for (const facts of settled) {
      expect(ytFactsAreProvisional(facts)).toBe(false);
    }
  });
});

describe('isYtUnplayable — a reason read back from the Worker', () => {
  it('names exactly the six reasons the answer can carry', () => {
    for (const word of [
      'embed_off',
      'private',
      'not_found',
      'age_restricted',
      'region_blocked',
      'not_yet',
    ]) {
      expect(isYtUnplayable(word)).toBe(true);
    }
  });

  it('refuses the transient causes and anything unregistered', () => {
    for (const word of ['upstream_unreachable', 'rate_limited', 'unavailable', 'invalid_id']) {
      expect(isYtUnplayable(word)).toBe(false);
    }
    for (const word of ['', 'REGION_BLOCKED', null, 7, undefined]) {
      expect(isYtUnplayable(word)).toBe(false);
    }
  });
});
