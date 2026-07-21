/**
 * Generates the audio fixtures for docs/13 §3 and spike S3 (docs/15).
 *
 * Everything here is synthesised from scratch — sine tones and silence — so the
 * committed fixtures carry no third-party rights, which is what
 * legal/THIRD-PARTY-NOTICES.md ("TickTune ships no third-party audio") requires
 * and what keeps them distinct from the local `test/` corpus.
 *
 * Two destinations, deliberately:
 *
 *   tests/e2e/fixtures/   COMMITTED. Small, used by the E2E suite. The corpus
 *                         guard allows audio only here (scripts/guard-no-corpus.mjs).
 *   test/generated/       IGNORED. Anything too large to commit — currently the
 *                         ~5 MB embedded-cover case S3 asks for, which would
 *                         otherwise trip the guard's 2 MB blob limit.
 *
 * Why this exists at all: the local corpus cannot satisfy S3. A check of all 103
 * filenames found ZERO Vietnamese characters, and .m4a/.oga/.webm are absent —
 * so S3's core acceptance ("v2/vorbis/mp4 tags render Vietnamese correctly;
 * ID3v1-only mojibake triggers the filename fallback") would pass vacuously.
 *
 *   pnpm fixtures
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const COMMITTED = 'tests/e2e/fixtures';
const GENERATED = 'test/generated';

const FFMPEG = ffmpegPath as unknown as string;

function ff(args: string[]): void {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

/** A short sine tone. Deterministic, tiny, and unmistakably not music. */
function tone(out: string, seconds: number, hz: number, extra: string[] = []): void {
  ff(['-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${seconds}`, ...extra, out]);
}

function silence(out: string, seconds: number, extra: string[] = []): void {
  ff([
    '-f',
    'lavfi',
    '-i',
    `anullsrc=channel_layout=mono:sample_rate=22050`,
    '-t',
    String(seconds),
    ...extra,
    out,
  ]);
}

// ── ID3 writing ─────────────────────────────────────────────────────────────
// Done by hand rather than through ffmpeg, because the POINT of these fixtures
// is the exact encoding of the tag frames, and ffmpeg normalises that away.

function syncsafe(n: number): Buffer {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

/**
 * ID3v2 frame. `encoding` picks the byte that decides how the text is read:
 *   0x00 ISO-8859-1  0x01 UTF-16 with BOM  0x03 UTF-8 (v2.4 only)
 */
function textFrame(id: string, value: string, encoding: 0x00 | 0x01 | 0x03): Buffer {
  let body: Buffer;
  if (encoding === 0x01) {
    body = Buffer.concat([Buffer.from([0x01, 0xff, 0xfe]), Buffer.from(value, 'utf16le')]);
  } else if (encoding === 0x03) {
    body = Buffer.concat([Buffer.from([0x03]), Buffer.from(value, 'utf8')]);
  } else {
    body = Buffer.concat([Buffer.from([0x00]), Buffer.from(value, 'latin1')]);
  }
  const header = Buffer.alloc(10);
  header.write(id, 0, 'latin1');
  header.writeUInt32BE(body.length, 4); // v2.3 size; v2.4 wants syncsafe, see below
  return Buffer.concat([header, body]);
}

function prependId3v2(file: string, version: 3 | 4, frames: Buffer[]): void {
  const payload = Buffer.concat(frames);
  if (version === 4) {
    // v2.4 frame sizes are syncsafe. Rewrite each frame's size field in place.
    let off = 0;
    while (off + 10 <= payload.length) {
      const size = payload.readUInt32BE(off + 4);
      syncsafe(size).copy(payload, off + 4);
      off += 10 + size;
    }
  }
  const header = Buffer.concat([
    Buffer.from('ID3', 'latin1'),
    Buffer.from([version, 0x00, 0x00]),
    syncsafe(payload.length),
  ]);
  writeFileSync(file, Buffer.concat([header, payload, readFileSync(file)]));
}

/**
 * ID3v1: 128 fixed bytes at EOF, with NO charset field at all. Vietnamese text
 * written here is unrecoverable by design — which is exactly the condition
 * docs/05 §5 wants detected, and TT-IMP-007's filename fallback to handle.
 */
function appendId3v1(file: string, title: string, artist: string): void {
  const tag = Buffer.alloc(128, 0);
  tag.write('TAG', 0, 'latin1');
  tag.write(title.slice(0, 30), 3, 'latin1'); // lossy on purpose
  tag.write(artist.slice(0, 30), 33, 'latin1');
  writeFileSync(file, Buffer.concat([readFileSync(file), tag]));
}

// Full diacritic coverage, including the tone marks that break naive encoders.
const VI_TITLE = 'Nắng ấm xa dần — Đường về nhà';
const VI_ARTIST = 'Nguyễn Thị Ánh Tuyết';

mkdirSync(COMMITTED, { recursive: true });
mkdirSync(GENERATED, { recursive: true });

const made: Array<[string, string]> = [];
const track = (p: string, note: string) => made.push([p, note]);

// ── docs/13 §3: the three playable tones + the over-limit file ───────────────
tone(join(COMMITTED, 'tone-5s.mp3'), 5, 440, ['-codec:a', 'libmp3lame', '-b:a', '96k']);
track('tone-5s.mp3', 'baseline playable');
tone(join(COMMITTED, 'tone-5s.flac'), 5, 523, ['-codec:a', 'flac']);
track('tone-5s.flac', 'baseline playable');
tone(join(COMMITTED, 'tone-5s.opus'), 5, 659, ['-codec:a', 'libopus', '-b:a', '48k']);
track('tone-5s.opus', 'baseline playable');

// 11 minutes > the 10:02 cap, so the importer must reject it with TT-IMP-002.
silence(join(COMMITTED, 'over-limit-11min.mp3'), 660, ['-codec:a', 'libmp3lame', '-b:a', '8k']);
track('over-limit-11min.mp3', 'TT-IMP-002: 11:00 exceeds the 10:02 cap');

// ── docs/02 §4 allow-list containers the local corpus lacks ──────────────────
tone(join(COMMITTED, 'tone-5s.m4a'), 5, 440, ['-codec:a', 'aac', '-b:a', '64k']);
track('tone-5s.m4a', 'allow-list container, absent from the corpus');
tone(join(COMMITTED, 'tone-5s.oga'), 5, 440, ['-codec:a', 'libvorbis', '-q:a', '2']);
track('tone-5s.oga', 'allow-list container, absent from the corpus');
tone(join(COMMITTED, 'tone-5s.webm'), 5, 440, ['-codec:a', 'libopus', '-b:a', '48k']);
track('tone-5s.webm', 'allow-list container, absent from the corpus');
tone(join(COMMITTED, 'tone-5s.wav'), 5, 440, ['-codec:a', 'pcm_s16le']);
track('tone-5s.wav', 'allow-list container');

// A container OUTSIDE the allow-list, so TT-IMP-001 has something to reject
// that is genuinely audio rather than a renamed text file.
tone(join(COMMITTED, 'rejected.aiff'), 2, 440, ['-codec:a', 'pcm_s16be']);
track('rejected.aiff', 'TT-IMP-001: outside the docs/02 §4 allow-list');

// ── spike S3: the Vietnamese tag matrix ─────────────────────────────────────
// Vorbis and MP4 carry UTF-8 by specification, so ffmpeg's own metadata is the
// honest representation for those two.
tone(join(COMMITTED, 'vi-vorbis.oga'), 3, 440, [
  '-codec:a',
  'libvorbis',
  '-q:a',
  '2',
  '-metadata',
  `title=${VI_TITLE}`,
  '-metadata',
  `artist=${VI_ARTIST}`,
]);
track('vi-vorbis.oga', 'S3: Vorbis comment, UTF-8 by spec');

tone(join(COMMITTED, 'vi-mp4.m4a'), 3, 440, [
  '-codec:a',
  'aac',
  '-b:a',
  '64k',
  '-metadata',
  `title=${VI_TITLE}`,
  '-metadata',
  `artist=${VI_ARTIST}`,
]);
track('vi-mp4.m4a', 'S3: MP4 metadata atom, UTF-8 by spec');

// ID3 variants are written by hand so each encoding byte is exactly what the
// filename claims — that is the whole experiment.
const v23 = join(COMMITTED, 'vi-id3v23-utf16.mp3');
tone(v23, 3, 440, ['-codec:a', 'libmp3lame', '-b:a', '64k']);
prependId3v2(v23, 3, [textFrame('TIT2', VI_TITLE, 0x01), textFrame('TPE1', VI_ARTIST, 0x01)]);
track('vi-id3v23-utf16.mp3', 'S3: ID3v2.3, encoding byte 0x01 (UTF-16 + BOM)');

const v24 = join(COMMITTED, 'vi-id3v24-utf8.mp3');
tone(v24, 3, 440, ['-codec:a', 'libmp3lame', '-b:a', '64k']);
prependId3v2(v24, 4, [textFrame('TIT2', VI_TITLE, 0x03), textFrame('TPE1', VI_ARTIST, 0x03)]);
track('vi-id3v24-utf8.mp3', 'S3: ID3v2.4, encoding byte 0x03 (UTF-8), syncsafe sizes');

const v1 = join(COMMITTED, 'vi-id3v1-only.mp3');
// `-id3v2_version 0` matters, and it is the mp3 muxer's actual option name
// (`-write_id3v2` is silently ignored here). Without it ffmpeg emits an empty
// ID3v2 tag, the file reports tagTypes ['ID3v2.4','ID3v1'], and a fixture named
// "id3v1-only" is not ID3v1-only — so any detection rule keyed on that would
// never fire. The S3 harness caught this by printing tagTypes.
tone(v1, 3, 440, ['-codec:a', 'libmp3lame', '-b:a', '64k', '-id3v2_version', '0']);
appendId3v1(v1, VI_TITLE, VI_ARTIST);
track('vi-id3v1-only.mp3', 'S3: ID3v1 has no charset — must trigger TT-IMP-007 fallback');

// ── large embedded cover art → the ignored directory ────────────────────────
// docs/15 S3 asks for ~5 MB of cover art. That exceeds the corpus guard's 2 MB
// blob limit, and rightly so, so it is generated into the ignored tree instead
// of being committed.
// High-entropy noise, not testsrc: a test pattern is mostly flat colour and
// PNG-compresses down to ~100 KB, which would quietly make this a small-cover
// fixture wearing a large-cover name. Random pixels do not compress.
const coverPng = join(GENERATED, 'cover-large.png');
ff([
  '-f',
  'lavfi',
  '-i',
  'nullsrc=s=1800x1800,geq=random(1)*255:random(2)*255:random(3)*255',
  '-frames:v',
  '1',
  coverPng,
]);
const bigCover = join(GENERATED, 'vi-big-cover.mp3');
tone(bigCover, 5, 440, ['-codec:a', 'libmp3lame', '-b:a', '64k']);
ff([
  '-i',
  bigCover,
  '-i',
  coverPng,
  '-map',
  '0:a',
  '-map',
  '1:v',
  '-codec',
  'copy',
  '-id3v2_version',
  '3',
  '-metadata:s:v',
  'title=Album cover',
  '-metadata',
  `title=${VI_TITLE}`,
  join(GENERATED, 'vi-big-cover-final.mp3'),
]);
track(
  '../../test/generated/vi-big-cover-final.mp3',
  'S3: large embedded cover (ignored, >2 MB guard)',
);

// ── report ──────────────────────────────────────────────────────────────────
console.log('\nGenerated fixtures:\n');
let over = 0;
for (const [name, note] of made) {
  const path = name.startsWith('..')
    ? join(GENERATED, name.split('/').pop()!)
    : join(COMMITTED, name);
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    /* the big-cover intermediate is renamed; reported below */
  }
  const kb = (size / 1024).toFixed(0).padStart(6);
  if (!name.startsWith('..') && size > 2 * 1024 * 1024) over++;
  console.log(`  ${kb} KB  ${name.padEnd(26)} ${note}`);
}
if (over) {
  console.error(`\n✖ ${over} committed fixture(s) exceed the 2 MB corpus-guard limit.`);
  process.exit(1);
}
console.log('\n✓ all committed fixtures are under the 2 MB guard limit\n');
