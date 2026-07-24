import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The generated attribution artifact — P7 slice A, closing the
 * `docs/AUDIT-BACKLOG.md` release blocker.
 *
 * ## What this can and cannot assert
 *
 * `scripts/make-notices.ts` already **fails the build** when a shipped package
 * has no licence text, which is the real guard. What it cannot check about
 * itself is whether its *input* is right — a plugin that silently collected
 * nothing would emit a small, tidy, useless file and exit 0.
 *
 * So this asserts the artifact's **content against packages we know ship**,
 * including the transitive ones nobody would list by hand. That is the failure
 * the hand-written table had: not that a row was wrong, but that six rows were
 * never going to exist.
 *
 * ⚠️ Skips when `dist/` is absent rather than passing vacuously — the same rule
 * `tt-csp-assets.test.ts` follows. CI builds before the E2E job, so it is a real
 * gate there.
 */

const NOTICES = join(process.cwd(), 'dist', 'THIRD-PARTY-NOTICES.txt');
const built = existsSync(NOTICES);

describe.skipIf(!built)('generated third-party notices', () => {
  const text = built ? readFileSync(NOTICES, 'utf8') : '';

  it('names the direct runtime dependencies', () => {
    for (const pkg of ['svelte', 'dexie', 'i18next', 'music-metadata']) {
      expect(text, `${pkg} ships but is not attributed`).toContain(pkg);
    }
  });

  it('names the TRANSITIVE packages a hand-written table would miss', () => {
    /*
     * The whole argument for generating this file. `music-metadata` pulls all
     * of these into the bundle, and `legal/THIRD-PARTY-NOTICES.md`'s curated
     * table lists none of them — correctly, because it is a human overview.
     */
    for (const pkg of ['strtok3', 'token-types', '@tokenizer/inflate', 'uint8array-extras']) {
      expect(text, `${pkg} is bundled transitively and must be attributed`).toContain(pkg);
    }
  });

  it('carries the OFL text for both webfont families', () => {
    // P6 made these dependencies, which activated a dormant obligation: OFL §2
    // requires the licence to accompany the font. They arrive via CSS `@import`,
    // so the module graph cannot see them — make-notices adds them by name, and
    // this is what catches that list being dropped.
    for (const pkg of ['@fontsource/be-vietnam-pro', '@fontsource/jetbrains-mono']) {
      expect(text).toContain(pkg);
    }
    expect(text.match(/SIL OPEN FONT LICENSE/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('reproduces actual licence text, not just a table of names', () => {
    // The blocker was "reproduces no license texts or copyright holders".
    expect(text).toContain('Permission is hereby granted');
    expect(text).toMatch(/Copyright/i);
    expect(text.length).toBeGreaterThan(20_000);
  });

  it('does NOT attribute build-only packages', () => {
    /*
     * `pnpm licenses --prod` reports 233 packages including the Astro compiler.
     * Attribution attaches to what is distributed, and `docs/11 §5` says dev
     * tooling gets no row — so a notices file naming the compiler would mean
     * the plugin collected the SERVER build too, which was the first version's
     * bug.
     */
    for (const pkg of ['@astrojs/compiler-binding', 'wrangler', 'vitest', 'playwright']) {
      expect(text, `${pkg} never reaches a browser and must not be attributed`).not.toContain(pkg);
    }
  });

  it('does not ship the build intermediate', () => {
    // tt-bundled-packages.json is plumbing between the plugin and the script.
    expect(existsSync(join(process.cwd(), 'dist', 'tt-bundled-packages.json'))).toBe(false);
  });
});
