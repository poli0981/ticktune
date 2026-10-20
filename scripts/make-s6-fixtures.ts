/**
 * Fixtures and references for spike S6 — docs/15 §S6.
 *
 *   pnpm s6:fixtures              test signals + 10:02 long files → test/generated/s6/
 *   pnpm s6:fixtures --corpus     + every audio file in the local corpus
 *
 * Each file's reference loudness and sample peak come from ffmpeg's `ebur128`
 * at the file's native rate, with mono weighted as dual mono like the meter
 * under test. Everything lands under the git-ignored test/; corpus files are
 * referenced in place, never copied or committed.
 *
 * The 10:02 files exist for time and memory: the longest track the app accepts
 * (docs/02 §4), as MP3 320k, FLAC and WAV — the last two the worst case for
 * the size of what `decodeAudioData` must hold.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { ensureFfmpeg } from './ensure-ffmpeg.ts';

const OUT = 'test/generated/s6';
const CORPUS = 'test/test_playlist';
const FFMPEG = ensureFfmpeg();
const withCorpus = process.argv.includes('--corpus');
mkdirSync(OUT, { recursive: true });

function ff(args: string[]): void {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

/** ffmpeg's integrated loudness and sample peak, from its summary block. */
function reference(path: string): { refLufs: number; refPeakDb: number; durationS: number } {
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
      'ebur128=peak=sample:dualmono=true',
      '-f',
      'null',
      '-',
      '-progress',
      'pipe:1',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const summary = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const lufs = /I:\s+(-?[\d.]+|-inf) LUFS/.exec(summary)?.[1];
  const peak = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1];
  const us = [...r.stdout.matchAll(/out_time_us=(\d+)/g)].map((m) => Number(m[1]));
  return {
    refLufs: lufs === undefined || lufs === '-inf' ? Number.NEGATIVE_INFINITY : Number(lufs),
    refPeakDb: peak === undefined || peak === '-inf' ? Number.NEGATIVE_INFINITY : Number(peak),
    durationS: (us.at(-1) ?? 0) / 1e6,
  };
}

interface Fixture {
  name: string;
  path: string;
  kind: 'signal' | 'long' | 'music';
  refLufs: number;
  refPeakDb: number;
  durationS: number;
}
const files: Fixture[] = [];
const add = (path: string, kind: Fixture['kind']) =>
  files.push({ name: basename(path), path, kind, ...reference(path) });

const stereoSine = (hz: number, db: number, d: number) => {
  const a = 10 ** (db / 20);
  return `aevalsrc=${a}*sin(2*PI*${hz}*t)|${a}*sin(2*PI*${hz}*t):s=48000:d=${d}`;
};

// EBU Tech 3341-style signals: the meter must read these to ±0.1 LU at 48 kHz.
const signals: Array<[string, string[]]> = [
  ['s6-1k-23.wav', ['-f', 'lavfi', '-i', stereoSine(1000, -23, 20)]],
  ['s6-1k-33.wav', ['-f', 'lavfi', '-i', stereoSine(1000, -33, 20)]],
  ['s6-1k-23-mono.wav', ['-f', 'lavfi', '-i', 'aevalsrc=0.0708*sin(2*PI*1000*t):s=48000:d=20']],
  [
    's6-pink-20.wav',
    ['-f', 'lavfi', '-i', 'anoisesrc=d=20:c=pink:a=0.1:r=48000,aformat=channel_layouts=stereo'],
  ],
  ['s6-100hz-23.wav', ['-f', 'lavfi', '-i', stereoSine(100, -23, 20)]],
  ['s6-8k-23.wav', ['-f', 'lavfi', '-i', stereoSine(8000, -23, 20)]],
];
for (const [name, input] of signals) {
  const path = join(OUT, name);
  ff([...input, '-c:a', 'pcm_s16le', path]);
  add(path, 'signal');
}

// 10:02 of music-like content: pink noise whose level wanders, as a mix does.
const LONG = 602;
const music = `anoisesrc=d=${LONG}:c=pink:a=0.3:r=44100,aformat=channel_layouts=stereo,volume='0.5+0.4*sin(2*PI*t/23)':eval=frame`;
for (const [ext, codec] of [
  ['mp3', ['-c:a', 'libmp3lame', '-b:a', '320k']],
  ['flac', ['-c:a', 'flac']],
  ['wav', ['-c:a', 'pcm_s16le']],
] as const) {
  const path = join(OUT, `s6-long-10m02.${ext}`);
  ff(['-f', 'lavfi', '-i', music, ...codec, path]);
  add(path, 'long');
}

if (withCorpus) {
  if (!existsSync(CORPUS)) {
    console.error(`✖ --corpus: ${CORPUS} is absent (local-only, never in CI)`);
    process.exit(1);
  }
  for (const entry of readdirSync(CORPUS)) {
    if (
      !['.mp3', '.m4a', '.flac', '.ogg', '.oga', '.opus', '.wav', '.aac'].includes(
        extname(entry).toLowerCase(),
      )
    )
      continue;
    add(join(CORPUS, entry), 'music');
  }
}

writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), files }, null, 2),
);
console.log(`✓ ${files.length} files → ${OUT}/manifest.json`);
for (const f of files.filter((x) => x.kind !== 'music')) {
  console.log(
    `  ${f.name.padEnd(22)} ${f.refLufs.toFixed(1).padStart(6)} LUFS  peak ${f.refPeakDb.toFixed(1)} dBFS  ${f.durationS.toFixed(1)} s`,
  );
}
const m = files.filter((x) => x.kind === 'music');
if (m.length) console.log(`  + ${m.length} corpus files`);
