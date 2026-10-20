/**
 * What the spike sweeps and fixture scripts share — docs/15.
 *
 * Two pieces each of them used to carry a copy of: finding the audio files the
 * app would accept in a folder, and getting a harness server — either by
 * reusing a running `pnpm spikes` or by building one.
 */
import { build, preview } from 'astro';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { TT_ACCEPT_EXT } from '../src/app/engine/importer/tt-accept.ts';

/** Every `--extra <dir>` on the command line, in order. */
export function extraDirs(argv: readonly string[] = process.argv): string[] {
  return argv.flatMap((a, i) => (a === '--extra' && argv[i + 1] ? [argv[i + 1]!] : []));
}

/**
 * The files in `dir` the app would import (docs/02 §4, `TT_ACCEPT_EXT` itself):
 * a file the app cannot take is not evidence about the app. `flag` names the
 * option in the error when the folder is missing.
 */
export function acceptedFiles(dir: string, flag: string): string[] {
  if (!existsSync(dir)) {
    console.error(`✖ ${flag}: ${dir} does not exist`);
    process.exit(1);
  }
  const accepted: readonly string[] = TT_ACCEPT_EXT;
  return readdirSync(dir)
    .filter((entry) => accepted.includes(extname(entry).toLowerCase()))
    .map((entry) => join(dir, entry));
}

/**
 * The harness server. `--reuse <port>` measures against an already-running
 * `pnpm spikes`, so several sweeps share ONE build instead of overwriting
 * dist-spikes/ under each other; otherwise this builds (TT_SPIKES=1) and
 * previews on `port`.
 */
export async function spikeServer(
  port: number,
  argv: readonly string[] = process.argv,
): Promise<{ origin: string; stop: () => Promise<void> }> {
  const k = argv.indexOf('--reuse');
  if (k >= 0) return { origin: `http://localhost:${Number(argv[k + 1])}`, stop: async () => {} };
  process.env['TT_SPIKES'] = '1';
  await build({ root: process.cwd(), logLevel: 'warn' });
  const server = await preview({ root: process.cwd(), logLevel: 'warn', server: { port } });
  return { origin: `http://localhost:${port}`, stop: () => server.stop() };
}
