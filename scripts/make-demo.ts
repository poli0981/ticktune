/**
 * Records the landing page's hero demo by driving the real app — P7 slice C.
 *
 * `docs/03 §3` has specified a "looping demo capture" since suite 1.0, with a
 * placeholder standing in until the product was worth showing. This replaces it.
 *
 *   pnpm demo
 *
 * ## Why a recording of the app and not a screenshot or a mock-up
 *
 * A mock-up would be a drawing of a product rather than the product, and
 * `docs/16`'s standing rule already rejected a stale screenshot for the same
 * reason. Driving the shipped build means the hero cannot claim anything the app
 * does not do: if the visualizer breaks, the demo breaks with it.
 *
 * ## The audio is synthesised here, and that is not incidental
 *
 * `legal/THIRD-PARTY-NOTICES.md` states that TickTune ships no third-party
 * audio, and a demo video with music in it would make that false — a licence
 * problem baked into the most-viewed asset on the site. So the capture plays a
 * chord sweep built from `ffmpeg`'s own oscillators, exactly like
 * `make-fixtures.ts`.
 *
 * ⚠️ It is deliberately NOT the flat 440 Hz test tone. A single sine gives the
 * analyser one bin to work with, so the visualizer renders one bar and the demo
 * would show a feature looking broken. Three detuned voices plus a sweep put
 * energy across the spectrum, which is what the bars are for.
 *
 * ## The output has to survive a Lighthouse run
 *
 * `/` scores 100 on Performance and the hero is the LCP element, so a careless
 * video would cost the P6 exit criterion. Hence: no audio track (it is muted, so
 * those bytes are pure waste), the same 960×540 box as the placeholder so
 * nothing reflows, a `poster` frame that can paint before the video arrives, and
 * a hard size assertion at the end of this script.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { chromium } from '@playwright/test';

const FFMPEG = ffmpegPath as unknown as string;
const PORT = 4331;
const ORIGIN = `http://localhost:${PORT}`;
const WORK = 'test/generated/demo';
const OUT = 'public/demo';

/** Seconds of playback kept in the loop. Long enough to see the beat move. */
const CLIP_SECONDS = 8;

/** The hero box, unchanged from the placeholder so the layout cannot shift. */
const W = 960;
const H = 540;

/**
 * The viewport the capture is driven at — **not** the output size.
 *
 * ⚠️ 960 px wide fails: `TT_GATE.minWidth` is 1024, so the mobile gate blocks
 * the app and the island never mounts (`docs/07 §2`). Recording at the hero's
 * own dimensions produced a 30 s timeout waiting for boot and nothing else — the
 * gate working exactly as specified. Capture above the threshold and scale down,
 * which also gives a sharper result than encoding at native size.
 */
const CAP_W = 1280;
const CAP_H = 720;

/** Refuse to ship a hero heavier than this. See the header. */
const MAX_VIDEO_KB = 900;

function ff(args: string[]): void {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

function fail(msg: string): never {
  console.error(`\n✖ make-demo: ${msg}\n`);
  process.exit(1);
}

/**
 * Something with spectral movement, so the bars have something to show.
 *
 * ⚠️ **The first attempt was three sines, and the capture showed why that fails**:
 * they land in a handful of adjacent bins, so most of the 64 bars never moved.
 * A demo of a spectrum analyser has to contain a spectrum.
 *
 * ⚠️ **And the sparse middle is NOT a bug** — `05 §6` specifies "64 log-spaced
 * bins, **mirrored**", so the bars are laid out symmetrically about the centre
 * and a narrow input lights two symmetric clusters. That was checked before
 * changing anything; the alternative was "fixing" a layout that is working.
 *
 * The fix is broadband content: a chord for structure, a sweep for movement, and
 * **filtered noise** to light the bins between them. Noise is the right call
 * precisely because the encoded video has **no audio track at all** — this file
 * exists only to drive the analyser during capture, so it should resemble what
 * *music* puts into a spectrum rather than what is pleasant to listen to. Real
 * music is broadband; three sines are not.
 *
 * Still entirely synthesised, so `legal/THIRD-PARTY-NOTICES.md`'s "TickTune
 * ships no third-party audio" holds — see the header.
 *
 * The tags are set for the same reason the audio is: without them the bottom
 * rail renders `N/A` (`docs/03 §1`'s fallback, working correctly), and a hero
 * showing a missing-data placeholder reads as a bug rather than as a feature.
 */
function demoAudio(out: string): void {
  const dur = CLIP_SECONDS + 6;
  ff([
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=196:duration=${dur}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=294:duration=${dur}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=392:duration=${dur}`,
    // The sweep — 300 Hz to 6 kHz and back, which is what fills the mids.
    '-f',
    'lavfi',
    '-i',
    `aevalsrc='0.6*sin(2*PI*t*(300+2850*(1-cos(0.9*t))))':d=${dur}`,
    // Broadband bed — this is what lights the bins between the chord and the
    // sweep. Band-limited below to the range the analyser actually maps.
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=color=pink:duration=${dur}:amplitude=0.35`,
    '-filter_complex',
    '[0][1][2]amix=inputs=3:duration=longest,tremolo=f=3:d=0.6[chord];' +
      '[chord][3]amix=inputs=2:weights=1 0.9:duration=longest[tonal];' +
      '[4]highpass=f=200,lowpass=f=9000,tremolo=f=2.3:d=0.8[bed];' +
      '[tonal][bed]amix=inputs=2:weights=1 0.85:duration=longest,volume=2.4',
    '-ac',
    '2',
    '-metadata',
    'title=Demo tone',
    '-metadata',
    'artist=TickTune',
    '-metadata',
    'album=Synthesised for the hero capture',
    out,
  ]);
}

mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });
rmSync(join(WORK, 'raw'), { recursive: true, force: true });

const audio = join(WORK, 'demo-audio.mp3');
demoAudio(audio);
console.log('  ✓ synthesised demo audio');

/*
 * Serve the built site. `astro preview` is what the E2E harness uses, so the
 * capture is of the same bytes the suite tests and the deploy ships.
 */
const server = spawn('npx', ['astro', 'preview', '--port', String(PORT)], {
  stdio: 'ignore',
  shell: process.platform === 'win32',
});

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${ORIGIN}/app/`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(`${ORIGIN} never came up — is dist/ built?`);
}

try {
  await waitForServer();

  const browser = await chromium.launch({
    // The visualizer needs a real analyser; the tab must be allowed to sound.
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({
    viewport: { width: CAP_W, height: CAP_H },
    recordVideo: { dir: join(WORK, 'raw'), size: { width: CAP_W, height: CAP_H } },
    deviceScaleFactor: 2,
    /*
     * Pin the locale, exactly as `playwright.config.ts` does and for the same
     * reason. `initialLang` reads `navigator.language` when nothing is stored
     * (`02 §3.1`), so an unpinned context records in whatever language the
     * machine happens to use — this first run produced an English capture on a
     * site whose default is Vietnamese, and the failure was cosmetic enough to
     * have shipped unnoticed.
     */
    locale: 'vi-VN',
  });
  const page = await context.newPage();

  await page.goto(`${ORIGIN}/app/`);
  await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);

  // The gate is a real part of the product, but not of the demo.
  await page.getByTestId('tt-gate-agree').check();
  await page.getByTestId('tt-gate-accept').click();

  await page.getByTestId('tt-tab-single').click();
  await page.getByTestId('tt-file-input').setInputFiles(audio);

  await page.keyboard.press('s');
  // Bars over wave/ring: it reads at a glance and at small sizes, which is what
  // a hero has to survive.
  await page.getByTestId('tt-set-viz-bars').click();
  // A gradient behind it — every preset is dark by design (`03 §2`), so this
  // adds depth without touching the 4.5:1 the scrim arithmetic guarantees.
  await page.getByTestId('tt-set-bg-gradient').click();
  await page.keyboard.press('Escape');

  /*
   * 2 minutes, so the digits render `MM:SS` — the regime a viewer recognises as
   * a timer. `H:MM:SS` is wider and was the geometry that broke the YouTube rail
   * in P5 (`03 §2`); a demo should show the common case.
   */
  await page.getByLabel('giờ').fill('0');
  await page.getByLabel('phút').fill('2');
  await page.getByLabel('giây').fill('0');

  await page.getByRole('button', { name: 'Bắt đầu' }).click();
  await page.waitForSelector('.tt-countdown');

  // Let the analyser settle, then hold for the clip. The trim below keeps the
  // tail, so the settling time never reaches the file.
  await page.waitForTimeout((CLIP_SECONDS + 4) * 1000);

  await context.close();
  await browser.close();
} finally {
  server.kill();
}

const raw = readdirSync(join(WORK, 'raw')).find((f) => f.endsWith('.webm'));
if (!raw) fail('Playwright produced no video — did the run abort?');
const rawPath = join(WORK, 'raw', raw);

/*
 * Keep the TAIL, not the head: everything before it is the gate, the import and
 * the settings panel, which is setup rather than product. `-sseof` makes that
 * independent of how long any of those steps happened to take.
 */
const trimmed = join(WORK, 'trimmed.webm');
ff(['-sseof', `-${CLIP_SECONDS}`, '-i', rawPath, '-an', '-c', 'copy', trimmed]);

/*
 * H.264 only, and the measurement is why.
 *
 * The first version also emitted VP9/WebM on the usual "webm for size, mp4 for
 * reach" reasoning. Both halves turned out to be wrong here: the WebM came out
 * LARGER (140 KB vs 119 KB) at visually equivalent quality, and WebKit stalled
 * on it —  timed out waiting for  on every landing spec, 13 of
 * them, because Safari's VP9 support is inconsistent and it sat on the first
 * <source> rather than moving to the fallback.
 *
 * So a second format cost bytes, cost compatibility, and bought nothing. One
 * H.264 file plays everywhere this app runs.
 */
ff([
  '-i',
  trimmed,
  '-an',
  '-vf',
  `scale=${W}:${H}:flags=lanczos`,
  '-c:v',
  'libx264',
  '-profile:v',
  'main',
  '-pix_fmt',
  'yuv420p',
  '-crf',
  '30',
  '-preset',
  'slow',
  '-movflags',
  '+faststart',
  join(OUT, 'hero.mp4'),
]);

/*
 * The poster is what paints first and is therefore the LCP candidate. Taken a
 * second in, because frame zero can catch a fade still in progress.
 */
ff([
  '-ss',
  '1',
  '-i',
  trimmed,
  '-frames:v',
  '1',
  '-vf',
  `scale=${W}:${H}:flags=lanczos`,
  '-quality',
  '80',
  join(OUT, 'hero-poster.webp'),
]);

const sizes = ['hero.mp4', 'hero-poster.webp'].map((f) => {
  const kb = statSync(join(OUT, f)).size / 1024;
  console.log(`  ${kb.toFixed(0).padStart(5)} KB  ${f}`);
  return { f, kb };
});

const video = sizes.filter((s) => !s.f.endsWith('.webp'));
const worst = Math.max(...video.map((s) => s.kb));
if (worst > MAX_VIDEO_KB) {
  fail(
    `the largest hero video is ${worst.toFixed(0)} KB, over the ${MAX_VIDEO_KB} KB ceiling. ` +
      `The hero is the LCP element on a page that scores 100 — raise the CRF rather than the ceiling.`,
  );
}

renameSync(rawPath, join(WORK, 'source.webm'));
console.log(`✓ make-demo: hero written to ${OUT}/`);
