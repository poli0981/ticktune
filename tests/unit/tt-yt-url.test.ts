import { describe, expect, it } from 'vitest';
import {
  TT_MAX_PLAYLISTS,
  parsePlaylistIds,
  parsePlaylistLine,
  parseVideoId,
  parseVideoIds,
} from '../../src/app/engine/youtube/tt-yt-url';

/** docs/06 §5 step 1 — the six accepted shapes, and everything that is not one. */

const ID = 'dQw4w9WgXcQ';
/** The Worker's own regex, copied here on purpose — see the property test. */
const WORKER_ID = /^[A-Za-z0-9_-]{11}$/;

describe('the six shapes docs/06 §5 names', () => {
  it.each([
    ['watch?v=', `https://www.youtube.com/watch?v=${ID}`],
    ['youtu.be/', `https://youtu.be/${ID}`],
    ['shorts/', `https://www.youtube.com/shorts/${ID}`],
    ['live/', `https://www.youtube.com/live/${ID}`],
    ['embed/', `https://www.youtube.com/embed/${ID}`],
    ['music.youtube.com', `https://music.youtube.com/watch?v=${ID}`],
  ])('accepts %s', (_shape, url) => {
    expect(parseVideoId(url)).toBe(ID);
  });

  it('accepts a bare id — what the S1 harness and the manual matrix use', () => {
    expect(parseVideoId(ID)).toBe(ID);
  });
});

describe('extra params are ignored — docs/06 §5', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}&list=PLabc&index=3`,
    `https://youtu.be/${ID}?si=aBcDeF&t=42`,
    `https://www.youtube.com/watch?app=desktop&v=${ID}`,
    `https://www.youtube.com/embed/${ID}?start=30&rel=0`,
  ])('%s', (url) => {
    expect(parseVideoId(url)).toBe(ID);
  });

  it('ignores a trailing slash and anything after the id segment', () => {
    expect(parseVideoId(`https://youtu.be/${ID}/`)).toBe(ID);
    expect(parseVideoId(`https://www.youtube.com/shorts/${ID}/whatever`)).toBe(ID);
  });

  it('takes a scheme-less paste, which is how links arrive from chat', () => {
    expect(parseVideoId(`youtu.be/${ID}`)).toBe(ID);
    expect(parseVideoId(`www.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseVideoId(`   https://youtu.be/${ID}  `)).toBe(ID);
  });
});

describe('what is not a video link — all of these are TT-YT-002', () => {
  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['prose', 'check out this song'],
    ['not YouTube', `https://vimeo.com/watch?v=${ID}`],
    ['a lookalike host', `https://notyoutube.com/watch?v=${ID}`],
    ['a channel page', 'https://www.youtube.com/@RickAstleyYT'],
    ['a playlist with no video', 'https://www.youtube.com/playlist?list=PLabc'],
    // v2.1 review: "videoseries" is 11 URL-safe characters, so it passed the id
    // regex and went to oEmbed as a video. It is the PLAYLIST embed.
    ['a playlist embed', 'https://www.youtube.com/embed/videoseries?list=PL0123456789ABCDEF'],
    [
      'a playlist embed on our own player host',
      'https://www.youtube-nocookie.com/embed/videoseries?list=PL0123456789ABCDEF',
    ],
    ['the bare domain', 'https://www.youtube.com/'],
    ['id one char short', 'https://youtu.be/dQw4w9WgXc'],
    ['id one char long', 'https://youtu.be/dQw4w9WgXcQQ'],
    ['id with an illegal character', 'https://youtu.be/dQw4w9WgX!Q'],
    ['not a URL at all', 'http://['],
  ])('rejects %s', (_label, line) => {
    expect(parseVideoId(line)).toBeNull();
  });

  it('rejects a `v` param that is not an id, rather than passing it upstream', () => {
    // The Worker would answer 400 invalid_id, but the user would have watched a
    // network round-trip to be told what we already knew.
    expect(parseVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
  });
});

describe('every accepted id satisfies the WORKER regex', () => {
  it('holds across all six shapes and a spread of ids', () => {
    // The contradiction this prevents: the parser accepting a line the edge
    // then rejects as `invalid_id`, so the app tells the user their own
    // accepted link is malformed.
    const ids = [ID, '-_AZaz09_-x', 'jNQXAC9IVRw', '9bZkp7q19f0', '___________'];
    const shapes = (id: string) => [
      id,
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://music.youtube.com/watch?v=${id}`,
    ];

    for (const id of ids) {
      for (const line of shapes(id)) {
        const parsed = parseVideoId(line);
        expect(parsed).toBe(id);
        expect(WORKER_ID.test(parsed ?? '')).toBe(true);
      }
    }
  });

  it('does NOT try to judge whether the id is structurally possible', () => {
    // `aaaaaaaaaaa` ends in a character that cannot terminate a base64url id,
    // so YouTube answers 400 — but that is the endpoint's finding to report
    // (src/lib/tt-yt-cause.ts), not a rule to duplicate here. Spike S1 measured
    // the rule; encoding it in two places is two places to be wrong.
    expect(parseVideoId('aaaaaaaaaaa')).toBe('aaaaaaaaaaa');
  });
});

describe('parseVideoIds — a whole textarea', () => {
  it('keeps both halves, because the rejects are what the toast counts', () => {
    const { ids, rejected } = parseVideoIds(
      [`https://youtu.be/${ID}`, '', 'not a link', `  ${'jNQXAC9IVRw'}  `].join('\n'),
    );
    expect(ids).toEqual([ID, 'jNQXAC9IVRw']);
    expect(rejected).toEqual(['not a link']);
  });

  it('skips blank lines silently — a trailing newline is not a rejection', () => {
    const { ids, rejected } = parseVideoIds(`${ID}\n\n\n`);
    expect(ids).toEqual([ID]);
    expect(rejected).toEqual([]);
  });

  it('preserves order and keeps duplicates for the dedupe step to handle', () => {
    // docs/06 §5 dedupes at step 2, by videoId, with its own toast code. Doing
    // it here would swallow a count the summary is supposed to report.
    const { ids } = parseVideoIds([ID, `https://youtu.be/${ID}`].join('\n'));
    expect(ids).toEqual([ID, ID]);
  });

  it('handles CRLF, which is what a Windows paste actually contains', () => {
    const { ids } = parseVideoIds(`${ID}\r\njNQXAC9IVRw`);
    expect(ids).toEqual([ID, 'jNQXAC9IVRw']);
  });
});

describe('the Playlist kind — docs/06 §9 (v2.1)', () => {
  const LIST = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';

  it.each([
    ['/playlist', `https://www.youtube.com/playlist?list=${LIST}`],
    [
      'a watch URL from inside the playlist',
      `https://www.youtube.com/watch?v=${ID}&list=${LIST}&index=3`,
    ],
    ['youtu.be with a list', `https://youtu.be/${ID}?list=${LIST}`],
    ['the playlist embed', `https://www.youtube.com/embed/videoseries?list=${LIST}`],
    ['YouTube Music', `https://music.youtube.com/playlist?list=${LIST}`],
    ['scheme-less', `www.youtube.com/playlist?list=${LIST}`],
    ['a bare list id', LIST],
  ])('reads %s', (_label, line) => {
    expect(parsePlaylistLine(line)).toEqual({ id: LIST });
  });

  it('refuses a Mix and the personal lists before any request', () => {
    expect(parsePlaylistLine(`https://www.youtube.com/watch?v=${ID}&list=RD${ID}`)).toEqual({
      refused: 'mix',
      id: `RD${ID}`,
    });
    expect(parsePlaylistLine('https://www.youtube.com/playlist?list=WL')).toEqual({
      refused: 'personal',
      id: 'WL',
    });
    expect(parsePlaylistLine('LL')).toEqual({ refused: 'personal', id: 'LL' });
  });

  it.each([
    ['a video link with no list', `https://www.youtube.com/watch?v=${ID}`],
    ['a bare video id', ID],
    ['another site', `https://vimeo.com/playlist?list=${LIST}`],
    ['a list param too short to be one', 'https://www.youtube.com/playlist?list=PLabc'],
    ['prose', 'my favourite playlist'],
  ])('names no playlist in %s', (_label, line) => {
    expect(parsePlaylistLine(line)).toBeNull();
  });

  it('sorts a paste into the ten looked up and everything the toast counts', () => {
    const lists = Array.from({ length: 12 }, (_, i) => `PL${String(i).padStart(16, '0')}`);
    const text = [
      ...lists.slice(0, 3),
      lists[0], // a repeat
      'no list here',
      `https://www.youtube.com/watch?v=${ID}&list=RD${ID}`,
      ...lists.slice(3),
    ].join('\r\n');

    const out = parsePlaylistIds(text);
    expect(out.ids).toEqual(lists.slice(0, TT_MAX_PLAYLISTS));
    expect(out.overflow).toEqual(lists.slice(TT_MAX_PLAYLISTS));
    expect(out.duplicates).toEqual([lists[0]]);
    expect(out.rejected).toEqual(['no list here']);
    expect(out.refused).toEqual([`RD${ID}`]);
  });

  it('counts a repeat of a list past the tenth as a repeat, not as overflow twice', () => {
    const lists = Array.from({ length: 11 }, (_, i) => `PL${String(i).padStart(16, '0')}`);
    const out = parsePlaylistIds([...lists, lists[10]].join('\n'));
    expect(out.overflow).toEqual([lists[10]]);
    expect(out.duplicates).toEqual([lists[10]]);
  });
});
