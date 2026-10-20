/**
 * Rasterise the brand SVGs into the PNGs that only exist as PNGs.
 *
 * Run by hand (`node scripts/make-brand-assets.mjs`), output committed — the
 * same contract as `scripts/make-fixtures.ts`. It is NOT part of `pnpm build`:
 * these assets change about once a year, and putting a browser launch on the
 * critical path of every deploy to regenerate identical bytes would be a poor
 * trade.
 *
 * ## Why rasterise at all
 *
 * `favicon.svg` covers every browser this desktop-only app supports. Two things
 * still need raster:
 *   - **`og/ticktune.png`** — no social platform renders SVG social cards.
 *   - **`apple-touch-icon.png`** — iOS ignores SVG here.
 * A `favicon.png` is emitted too, as the fallback for anything that skips the
 * SVG icon link.
 *
 * ## Why Playwright rather than a raster library
 *
 * It is already a dev dependency (E2E), so this adds nothing to install and
 * nothing to `legal/THIRD-PARTY-NOTICES.md` (docs/11 §5 — dev tooling, never
 * distributed). A dedicated SVG rasteriser would be a new dependency for four
 * images.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

/*
 * The app's own faces, inlined as data URLs into the page the SVG renders in.
 *
 * The SVGs name DSEG7 Classic, Chakra Petch and Be Vietnam Pro, none of which
 * is a system font — without this the card fell back to whatever the machine
 * running the script had, so the countdown on the card was not the countdown
 * in the app. Inlined rather than linked: `setContent` pages are about:blank,
 * and a data URL needs no file access policy to load.
 */
const FONT_FILES = [
  ['DSEG7 Classic', 400, join(PUBLIC, 'fonts', 'dseg7', 'DSEG7Classic-Regular.woff2')],
  [
    'Chakra Petch',
    600,
    'node_modules/@fontsource/chakra-petch/files/chakra-petch-latin-600-normal.woff2',
  ],
  [
    'Be Vietnam Pro',
    500,
    'node_modules/@fontsource/be-vietnam-pro/files/be-vietnam-pro-latin-500-normal.woff2',
  ],
];
const FONT_CSS = FONT_FILES.map(([family, weight, file]) => {
  const data = readFileSync(file.startsWith('node_modules') ? join(ROOT, file) : file);
  return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2')}`;
}).join('');

/** Render an SVG file to PNG at an exact pixel size. */
async function rasterise(page, svgPath, out, width, height) {
  const svg = readFileSync(svgPath, 'utf8');
  await page.setViewportSize({ width, height });
  /*
   * `setContent`, NOT a `data:text/html,` URL.
   *
   * The data-URL version silently produced blank white PNGs: the inline CSS
   * contains `background:#0E0D0B`, and the `#` starts the URL's fragment, so
   * everything from there on was discarded. The script still exited 0 and
   * still wrote files — caught only by looking at the output.
   */
  await page.setContent(
    `<style>${FONT_CSS}html,body{margin:0;background:#0E0D0B}
     svg{display:block;width:${width}px;height:${height}px}</style>${svg}`,
    { waitUntil: 'load' },
  );
  // `load` does not wait for web fonts — a face is only fetched once used.
  // A string expression: this file is linted as Node, where `document` is not
  // a global, and the promise it evaluates to is awaited by Playwright.
  await page.evaluate('document.fonts.ready.then(() => true)');
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: false });
  const kb = Math.round(statSync(out).size / 1024);
  console.warn(
    `  ${String(kb).padStart(4)} KB  ${out.replace(ROOT + '\\', '').replace(ROOT + '/', '')}`,
  );
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

console.warn('Rasterising brand assets:');
await rasterise(page, join(PUBLIC, 'favicon.svg'), join(PUBLIC, 'favicon.png'), 96, 96);
await rasterise(page, join(PUBLIC, 'favicon.svg'), join(PUBLIC, 'apple-touch-icon.png'), 180, 180);
// 1200×630 is the Open Graph size every platform crops from.
await rasterise(page, join(PUBLIC, 'og-source.svg'), join(PUBLIC, 'og', 'ticktune.png'), 1200, 630);

await browser.close();
console.warn('✓ brand assets written — commit them (docs/11 §5: dev tooling, no notice row)');
