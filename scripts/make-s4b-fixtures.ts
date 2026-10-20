/**
 * Fixtures for spike S4b — docs/15 §S4.
 *
 *   pnpm s4b:fixtures              synthetic pairs → test/generated/s4b/
 *   pnpm s4b:fixtures --corpus     + the local corpus's Xing-VBR MP3s, as shipped
 *                                  and remuxed WITHOUT their Xing header
 *
 * Everything lands under test/, which is git-ignored and guarded
 * (scripts/guard-no-corpus.mjs): the corpus is never committed and never
 * referenced from shipped code. manifest.json lists every file with its TRUE
 * duration (a full ffmpeg decode) and its own leading/trailing silence, which
 * the 0 s gap is measured net of.
 *
 * Why the remux: a scan of test/test_playlist found 103 MP3s — 16 VBR with a
 * Xing header, 65 CBR with an Info header, 22 header-less CBR — and NO
 * header-less VBR, which is exactly the case where `element.duration` is an
 * estimate and docs/15 says S4b must measure. Stream-copying the 16 Xing files
 * without the header makes that case out of real music.
 *
 * Synthetic tones carry 10 ms fades at both ends so a file boundary is never a
 * click of its own; the click CONTROL is the one file that ends abruptly.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { ensureFfmpeg } from './ensure-ffmpeg.ts';
import type { TtS4bFixture } from '../src/spike/s4/tt-s4b-sweep-plan.ts';

const OUT = 'test/generated/s4b';
const CORPUS = 'test/test_playlist';
const NOXING = 'test/generated/s4b-corpus-noxing';
const FFMPEG = ensureFfmpeg();
const withCorpus = process.argv.includes('--corpus');

mkdirSync(OUT, { recursive: true });

function ff(args: string[]): void {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

/** Decoded duration and silence edges, from one full decode. */
function probe(path: string): { exactS: number; leadSilenceS: number; trailSilenceS: number } {
  const r = spawnSync(
    FFMPEG,
    [
      '-hide_banner',
      '-nostats',
      '-i',
      path,
      '-map',
      '0:a',
      '-af',
      'silencedetect=noise=-60dB:d=0.02',
      '-f',
      'null',
      '-',
      '-progress',
      'pipe:1',
    ],
    { encoding: 'utf8' },
  );
  const us = [...r.stdout.matchAll(/out_time_us=(\d+)/g)].map((m) => Number(m[1]));
  const exactS = (us.at(-1) ?? 0) / 1e6;
  const starts = [...r.stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...r.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const leadSilenceS = starts.length && (starts[0] ?? 1) <= 0.001 ? (ends[0] ?? 0) : 0;
  const lastStart = starts.at(-1);
  const trailSilenceS =
    lastStart !== undefined && (ends.length < starts.length || (ends.at(-1) ?? 0) >= exactS - 0.01)
      ? Math.max(0, exactS - lastStart)
      : 0;
  return { exactS, leadSilenceS, trailSilenceS };
}

const SECONDS = 20;
const tone = (hz: number) =>
  `aevalsrc=0.5*sin(2*PI*${hz}*t)|0.5*sin(2*PI*${hz}*t):s=48000:d=${SECONDS}`;
const edges = `afade=t=in:d=0.01,afade=t=out:st=${SECONDS - 0.01}:d=0.01`;

const ENCODINGS: Record<string, { ext: string; args: string[] }> = {
  wav: { ext: 'wav', args: ['-c:a', 'pcm_s16le'] },
  cbr: { ext: 'mp3', args: ['-c:a', 'libmp3lame', '-b:a', '192k'] },
  'cbr-noinfo': { ext: 'mp3', args: ['-c:a', 'libmp3lame', '-b:a', '192k', '-write_xing', '0'] },
  'vbr-xing': { ext: 'mp3', args: ['-c:a', 'libmp3lame', '-q:a', '2'] },
  adts: { ext: 'aac', args: ['-c:a', 'aac', '-b:a', '160k', '-f', 'adts'] },
  m4a: { ext: 'm4a', args: ['-c:a', 'aac', '-b:a', '160k'] },
  flac: { ext: 'flac', args: ['-c:a', 'flac'] },
  opus: { ext: 'opus', args: ['-c:a', 'libopus', '-b:a', '128k'] },
};

const files: Array<TtS4bFixture & { path: string }> = [];
const add = (
  path: string,
  f: Omit<TtS4bFixture, 'name' | 'exactS' | 'leadSilenceS' | 'trailSilenceS'>,
) => {
  files.push({ name: basename(path), path, ...probe(path), ...f });
};

for (const [family, enc] of Object.entries(ENCODINGS)) {
  for (const [role, hz] of [
    ['a', 440],
    ['b', 660],
  ] as const) {
    const path = join(OUT, `s4b-${family}-${role}.${enc.ext}`);
    ff(['-f', 'lavfi', '-i', tone(hz), '-af', edges, ...enc.args, path]);
    // Raw ADTS carries no index: like a header-less MP3, its duration is an estimate.
    add(path, { family, role, kind: 'test', fromStart: family === 'adts' });
  }
}

// Header-less VBR whose bitrate changes mid-file, so the duration ESTIMATE from
// the first frames is wrong in a known direction: quiet→busy starts too long
// (the trigger fires late or never), busy→quiet starts too short (it fires
// early — the dangerous case).
const quiet = `aevalsrc=0.25*sin(2*PI*440*t)|0.25*sin(2*PI*440*t):s=48000:d=10`;
const busy = `anoisesrc=d=10:c=pink:a=0.25:r=48000,aformat=channel_layouts=stereo`;
for (const [family, first, second] of [
  ['vbr-noxing-up', quiet, busy],
  ['vbr-noxing-down', busy, quiet],
] as const) {
  const path = join(OUT, `s4b-${family}.mp3`);
  ff([
    '-f',
    'lavfi',
    '-i',
    first,
    '-f',
    'lavfi',
    '-i',
    second,
    '-filter_complex',
    `[0:a][1:a]concat=n=2:v=0:a=1,${edges}`,
    '-c:a',
    'libmp3lame',
    '-q:a',
    '2',
    '-write_xing',
    '0',
    path,
  ]);
  add(path, { family, kind: 'test', fromStart: true });
}

// Controls. The click control ENDS on a peak with no fade: an abrupt stop the
// detector must flag. The corrupt control never decodes.
{
  const d = 10 + 1 / (4 * 440);
  const path = join(OUT, 's4b-control-click.wav');
  ff([
    '-f',
    'lavfi',
    '-i',
    `aevalsrc=0.5*sin(2*PI*440*t)|0.5*sin(2*PI*440*t):s=48000:d=${d}`,
    '-c:a',
    'pcm_s16le',
    path,
  ]);
  add(path, { family: 'control-click', kind: 'control', fromStart: false });
  const corrupt = join(OUT, 's4b-control-corrupt.mp3');
  copyFileSync('tests/e2e/fixtures/corrupt.mp3', corrupt);
  files.push({
    name: basename(corrupt),
    path: corrupt,
    family: 'control-corrupt',
    kind: 'control',
    fromStart: false,
    exactS: 0,
    leadSilenceS: 0,
    trailSilenceS: 0,
  });
}

/** A Xing (VBR) or Info (CBR) tag in the first frame, after any ID3v2 tag. */
function xingKind(path: string): 'xing' | 'info' | 'none' {
  const buf = readFileSync(path);
  let off = 0;
  if (buf.subarray(0, 3).toString('latin1') === 'ID3') {
    const size =
      ((buf[6]! & 0x7f) << 21) |
      ((buf[7]! & 0x7f) << 14) |
      ((buf[8]! & 0x7f) << 7) |
      (buf[9]! & 0x7f);
    off = 10 + size;
  }
  const head = buf.subarray(off, off + 4096).toString('latin1');
  if (head.includes('Xing')) return 'xing';
  if (head.includes('Info')) return 'info';
  return 'none';
}

if (withCorpus) {
  if (!existsSync(CORPUS)) {
    console.error(`✖ --corpus: ${CORPUS} is absent (it is local-only, never in CI)`);
    process.exit(1);
  }
  mkdirSync(NOXING, { recursive: true });
  for (const entry of readdirSync(CORPUS)) {
    if (!entry.toLowerCase().endsWith('.mp3')) continue;
    const src = join(CORPUS, entry);
    if (xingKind(src) !== 'xing') continue;
    add(src, { family: 'corpus-xing', kind: 'music', fromStart: false });
    const dst = join(NOXING, `nx-${entry}`);
    ff(['-i', src, '-map', '0:a', '-c:a', 'copy', '-write_xing', '0', dst]);
    add(dst, { family: 'corpus-noxing', kind: 'music', fromStart: true });
  }
}

writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), files }, null, 2),
);
console.log(`✓ ${files.length} files → ${OUT}/manifest.json`);
for (const f of files) {
  console.log(`  ${f.family.padEnd(16)} ${f.exactS.toFixed(3).padStart(8)} s  ${f.kind}`);
}
