/**
 * The ffmpeg binary for the two local asset scripts — fetched on demand, never
 * by `pnpm install`.
 *
 *   import { ensureFfmpeg } from './ensure-ffmpeg.ts';
 *   const FFMPEG = ensureFfmpeg();
 *
 * `ffmpeg-static`'s postinstall downloads a prebuilt binary from GitHub releases
 * with no checksum. It used to run on every install — including all four CI
 * workflows, none of which ever executes ffmpeg, and one of which holds the
 * Cloudflare deploy token. `pnpm-workspace.yaml` now denies that build, so the
 * download only happens here: on a developer machine, when a script that
 * actually needs the binary asks for it.
 *
 * Dev-only and never distributed, so the binary's GPL terms impose nothing on
 * the shipped site (docs/11 §5).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

export function ensureFfmpeg(): string {
  // The package exports the platform binary's PATH (or honours its
  // FFMPEG_BIN override); it does not check that the file exists.
  const bin = require('ffmpeg-static') as string | null;
  if (!bin) throw new Error('ffmpeg-static ships no binary for this platform');
  if (existsSync(bin)) return bin;

  const pkgDir = dirname(require.resolve('ffmpeg-static/package.json'));
  console.log('  … ffmpeg binary missing — running ffmpeg-static/install.js once');
  // process.execPath, not `node` from PATH: the interpreter that is already
  // running this script is the one we trust.
  execFileSync(process.execPath, [join(pkgDir, 'install.js')], { cwd: pkgDir, stdio: 'inherit' });

  if (!existsSync(bin)) throw new Error(`ffmpeg-static/install.js did not produce ${bin}`);
  return bin;
}
