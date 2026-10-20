import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from './_fixtures';
import {
  dismissUnloadDialogs,
  gotoApp,
  setDuration,
  skipWithoutAudio,
  stageSingle,
} from './_helpers';

/**
 * docs/05 §2 — the crossfade, v2.0.
 *
 * Spike S4b measured the trigger and the curves on the real graph, 347 runs
 * (docs/15 §S4b). What it could not measure is the WIRING: the shell keeping
 * the engine told what comes next, the queue advancing once per fade, a pause
 * or a ⏭ landing in the middle of one, a setting changed mid-run. That is this
 * file, and every spec here was shown red against the mutation its comment
 * names before it was trusted.
 *
 * What it observes, all recorded IN the page on the page's own clock (a round
 * trip to the test per sample would add its own jitter to every interval):
 *
 * - `data-tt-xfade-active` — '1' from the moment the curves are scheduled
 *   until the outgoing deck is stopped (docs/13 §3);
 * - the current queue row and the loop count, as they change (a sampler missed
 *   a row that was current for less than its tick, under load);
 * - `tt-rms-now` — the analyser's RMS this frame, after `fadeGain`: what is
 *   audible NOW, which the peak-hold `tt-peak-rms` cannot say;
 * - `tt-live-urls` — docs/09 §5's canary.
 *
 * Chromium only for real: Firefox CI has no audio device, Windows WebKit no
 * `AudioContext` (`skipWithoutAudio`, docs/13 §3).
 */

const fixture = (name: string): Buffer => readFileSync(join('tests/e2e/fixtures', name));

/**
 * A, B and C at 440, 523 and 440 Hz (scripts/make-fixtures.ts) — neighbours
 * DIFFER on purpose. An equal-power fade between two different pitches keeps
 * the summed level flat, which is what lets "no gap" be measured as a level;
 * two copies of one tone can cancel at the midpoint and read as a gap that is
 * not there. C is A renamed: the dedupe key is `name::size::duration`.
 */
async function stageTones(page: Page): Promise<void> {
  await page.getByTestId('tt-tab-playlist').click();
  await page.getByTestId('tt-file-input').setInputFiles([
    { name: 'a-440.mp3', mimeType: 'audio/mpeg', buffer: fixture('tone-5s.mp3') },
    { name: 'b-523.flac', mimeType: 'audio/flac', buffer: fixture('tone-5s.flac') },
    { name: 'c-440.mp3', mimeType: 'audio/mpeg', buffer: fixture('tone-5s.mp3') },
  ]);
  await expect(page.getByTestId('tt-queue-row')).toHaveCount(3);
}

interface Rec {
  rms: [number, number][];
  urls: [number, number][];
  /** The active deck's media position, ms — the media clock, against the page's. */
  pos: [number, number][];
  /** Every change of `data-tt-xfade-active`. */
  xf: [number, string][];
  /** Every change of the current row's index; -1 when no row is current. */
  rows: [number, number][];
  loop: [number, string][];
}

async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rec: Rec = { rms: [], urls: [], pos: [], xf: [], rows: [], loop: [] };
    (window as unknown as { __ttRec: Rec }).__ttRec = rec;
    const html = document.documentElement;
    new MutationObserver((records) => {
      const t = performance.now();
      // Each record's new value is the next one's old value: two changes in
      // one task are both kept, not collapsed into the last.
      records.forEach((r, k) => {
        const next = records[k + 1];
        rec.xf.push([t, next ? (next.oldValue ?? '') : (html.dataset['ttXfadeActive'] ?? '')]);
      });
    }).observe(html, {
      attributes: true,
      attributeFilter: ['data-tt-xfade-active'],
      attributeOldValue: true,
    });
    const text = (id: string): string =>
      document.querySelector(`[data-testid=${id}]`)?.textContent?.trim() ?? '';
    let row = -2;
    let loop = '';
    /*
     * The row and the loop count are recorded as they CHANGE, not sampled: a
     * fade's commit and a ⏭ can land inside one 50 ms tick, and a sampler then
     * never sees the row between them — the full suite, under load, did that.
     */
    const onChange = (): void => {
      const t = performance.now();
      const rows = [...document.querySelectorAll('[data-testid=tt-queue-row]')];
      const i = rows.findIndex((r) => r.classList.contains('tt-current'));
      if (i !== row) rec.rows.push([t, (row = i)]);
      const l = text('tt-loop-count');
      if (l !== loop) rec.loop.push([t, (loop = l)]);
    };
    onChange();
    new MutationObserver(onChange).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    setInterval(() => {
      const t = performance.now();
      rec.rms.push([t, Number(text('tt-rms-now') || 0)]);
      rec.urls.push([t, Number(text('tt-live-urls') || 0)]);
      rec.pos.push([t, Number(text('tt-media-pos') || 0)]);
    }, 50);
  });
}

const recording = (page: Page): Promise<Rec> =>
  page.evaluate(() => (window as unknown as { __ttRec: Rec }).__ttRec);

/** `performance.now()` in the page — the recording's clock. */
const mark = (page: Page): Promise<number> => page.evaluate(() => performance.now());

/** Each crossfade: when its curves were scheduled, and when the old deck stopped. */
function fades(rec: Rec): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let open: number | null = null;
  for (const [t, v] of rec.xf) {
    if (v === '1' && open === null) open = t;
    else if (v !== '1' && open !== null) {
      out.push({ start: open, end: t });
      open = null;
    }
  }
  if (open !== null) out.push({ start: open, end: Number.POSITIVE_INFINITY });
  return out;
}

/** The rows the cursor visited, in order, each with when it got there. */
function visits(rec: Rec): [number, number][] {
  const out: [number, number][] = [];
  for (const [t, i] of rec.rows) if (i >= 0 && out.at(-1)?.[1] !== i) out.push([t, i]);
  return out;
}

const rmsIn = (rec: Rec, from: number, to: number): number[] =>
  rec.rms.filter(([t]) => t >= from && t <= to).map(([, v]) => v);

const median = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1] ?? 0;

/**
 * How fast the media clock ran against the page's before `until` — the slope
 * of the active deck's position over the first track's solo stretch.
 */
function clockRate(rec: Rec, until: number): number {
  const pts = rec.pos.filter(([t, p]) => t < until - 100 && p > 300);
  expect(pts.length, 'the tt-media-pos seam reports a playing deck').toBeGreaterThan(10);
  const n = pts.length;
  const mt = pts.reduce((s, [t]) => s + t, 0) / n;
  const mp = pts.reduce((s, [, p]) => s + p, 0) / n;
  const cov = pts.reduce((s, [t, p]) => s + (t - mt) * (p - mp), 0);
  const varT = pts.reduce((s, [t]) => s + (t - mt) ** 2, 0);
  return cov / varT;
}

/**
 * Whether this browser's media clock keeps real time — the capability every
 * assertion about how LONG something took depends on. Measured per run, never
 * assumed from a browser name (docs/13 §3): CI's Linux WebKit, with no audio
 * device, played 5 s tracks in ~4.05 s of page time and reported `currentTime`
 * up to ~1.5× ahead of it. Where it does not, the durations are skipped, said
 * so in the report, and everything about wiring is still asserted.
 */
function realTime(rec: Rec, until: number): boolean {
  const rate = clockRate(rec, until);
  const ok = Math.abs(rate - 1) < 0.1;
  test.info().annotations.push({
    type: 'media clock',
    description: `${rate.toFixed(3)}× page time${ok ? '' : ' — duration assertions skipped (docs/13 §3)'}`,
  });
  return ok;
}

async function openSettings(page: Page): Promise<void> {
  await page.keyboard.press('s');
  await expect(page.getByTestId('tt-settings')).toBeVisible();
}

async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tt-settings')).toHaveCount(0);
}

async function setCrossfade(page: Page, seconds: number): Promise<void> {
  await openSettings(page);
  await page.getByTestId('tt-set-crossfade').fill(String(seconds));
  await closeSettings(page);
}

/** The codes the log viewer holds — the same list Copy Diagnostics sends. */
async function logCodes(page: Page): Promise<string[]> {
  await openSettings(page);
  return page.getByTestId('tt-set-log').locator('code').allTextContents();
}

const start = (page: Page) => page.getByRole('button', { name: 'Bắt đầu' }).click();

/**
 * A docs/03 §7 hotkey, from the page itself. The bottom bar hides itself three
 * seconds after the last activity, and a fade starts at ~2.7 s — clicking its
 * buttons would race the bar. The keys reach the same handlers.
 */
async function hotkey(page: Page, key: 'Space' | 'ArrowRight'): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(key);
}
const html = (page: Page) => page.locator('html');
const rows = (page: Page) => page.getByTestId('tt-queue-row');

test.describe('crossfade — docs/05 §2', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test.beforeEach(async ({ page, browserName }) => {
    await skipWithoutAudio(page, browserName);
    dismissUnloadDialogs(page);
  });

  test('fades A into B and B into C — heard throughout, one advance per fade', async ({ page }) => {
    /*
     * Red against: the shell not listening for `onCrossfade` (the queue sat on
     * A while B played, then B's own `ended` replayed it); the `setNext` effect
     * removed (no fade at all); the engine reporting a fade twice (C skipped).
     */
    await gotoApp(page, '/app/?ttdebug=1');
    await stageTones(page);
    await page.getByTestId('tt-repeat').click(); // ON by default (docs/02 §3.1)
    await setDuration(page, 0, 1, 0);
    await record(page);
    await start(page);

    // 2 s fades on 5 s tracks: A→B at ~2.7 s, B→C at ~5.4 s, C ends ~10.4 s.
    await expect(page.getByTestId('tt-playlist-ended')).toBeVisible({ timeout: 20_000 });
    const rec = await recording(page);

    const f = fades(rec);
    expect(f).toHaveLength(2);
    if (realTime(rec, f[0]!.start)) {
      for (const { start: s, end: e } of f) {
        expect(e - s).toBeGreaterThan(1_800);
        expect(e - s).toBeLessThan(2_700);
      }
    }

    // The queue moved ONCE per fade, and when the fade began — not at the
    // outgoing track's end, which is what a missed `onCrossfade` looks like.
    const v = visits(rec);
    expect(v.map(([, i]) => i)).toEqual([0, 1, 2]);
    for (const [k, fade] of f.entries()) {
      const [t] = v[k + 1]!;
      expect(t).toBeGreaterThanOrEqual(fade.start);
      expect(t).toBeLessThan(fade.start + 500);
    }

    // Heard throughout: the summed level of an equal-power fade between two
    // pitches stays where one track alone sits. A gap reads as ~0.
    const solo = median(rmsIn(rec, f[0]!.start - 1_500, f[0]!.start - 200));
    expect(solo).toBeGreaterThan(0.02);
    for (const fade of f) {
      expect(Math.min(...rmsIn(rec, fade.start + 100, fade.end - 100))).toBeGreaterThan(solo / 2);
    }

    // Two decks, one media URL each, and the outgoing one is given back.
    expect(Math.max(...rec.urls.map(([, n]) => n))).toBeLessThanOrEqual(2);

    // The end of the list is still `ended`'s business: reported once.
    const codes = await logCodes(page);
    expect(codes.filter((c) => c === 'TT-PLY-102')).toHaveLength(1);
    expect(codes.filter((c) => /^TT-PLY-10[168]$/.test(c))).toEqual([]);
  });

  test('0 s is a hard cut at `ended`, onto the armed deck — and that deck is heard', async ({
    page,
  }) => {
    /*
     * Red against: `load()` not raising the gain of the deck it was armed on
     * (S4b's Z2) — B started on time and in silence.
     */
    test.setTimeout(60_000);
    await gotoApp(page, '/app/?ttdebug=1');
    await setCrossfade(page, 0);
    await stageTones(page);
    await page.getByTestId('tt-repeat').click();
    await setDuration(page, 0, 1, 0);
    await record(page);
    await start(page);
    await expect(html(page)).toHaveAttribute('data-tt-xfade', '0');

    await expect(page.getByTestId('tt-playlist-ended')).toBeVisible({ timeout: 25_000 });
    const rec = await recording(page);

    expect(fades(rec)).toEqual([]);
    const v = visits(rec);
    expect(v.map(([, i]) => i)).toEqual([0, 1, 2]);
    const solo = median(rmsIn(rec, v[0]![0] + 1_000, v[0]![0] + 3_000));
    expect(solo).toBeGreaterThan(0.02);
    const timed = realTime(rec, v[1]![0]);
    for (const k of [1, 2]) {
      // Each whole track played before the next — the cut is at its end.
      if (timed) expect(v[k]![0] - v[k - 1]![0]).toBeGreaterThan(4_500);
      expect(median(rmsIn(rec, v[k]![0] + 300, v[k]![0] + 1_500))).toBeGreaterThan(solo / 2);
    }

    // Off is not "declined": TT-PLY-106 is for a track that cannot fade.
    const codes = await logCodes(page);
    expect(codes.filter((c) => c === 'TT-PLY-102')).toHaveLength(1);
    expect(codes).not.toContain('TT-PLY-106');
  });

  test('a fade changed mid-run applies from the next transition', async ({ page }) => {
    /*
     * Red against: the `applyCrossfade` effect removed — the engine kept the
     * length it was created with until the next page load.
     */
    await gotoApp(page, '/app/?ttdebug=1');
    await setCrossfade(page, 1);
    await stageTones(page);
    await page.getByTestId('tt-repeat').click();
    await setDuration(page, 0, 1, 0);
    await record(page);
    await start(page);

    // During the first fade, which keeps the length it started with.
    await expect(html(page)).toHaveAttribute('data-tt-xfade-active', '1', { timeout: 10_000 });
    await setCrossfade(page, 3);
    await expect(html(page)).toHaveAttribute('data-tt-xfade', '3000');

    await expect(page.getByTestId('tt-playlist-ended')).toBeVisible({ timeout: 20_000 });
    const rec = await recording(page);
    const f = fades(rec);
    expect(f).toHaveLength(2);
    if (realTime(rec, f[0]!.start)) {
      // 1 s as set; then 3 s, which on a 5 s track is 2.5 s — half its length.
      expect(f[0]!.end - f[0]!.start).toBeGreaterThan(850);
      expect(f[0]!.end - f[0]!.start).toBeLessThan(1_600);
      expect(f[1]!.end - f[1]!.start).toBeGreaterThan(2_300);
      expect(f[1]!.end - f[1]!.start).toBeLessThan(3_200);
    }
  });

  test('a pause mid-fade is silent, and play resumes the rest of the same fade', async ({
    page,
  }) => {
    /*
     * Red against: `pause()` taking the solo path mid-fade (the outgoing deck
     * played on at full level behind ▶), and a resume that restarted the
     * curves instead of continuing them.
     */
    await gotoApp(page, '/app/?ttdebug=1');
    await stageTones(page);
    await setDuration(page, 0, 1, 0);
    await record(page);
    await start(page);

    await expect(html(page)).toHaveAttribute('data-tt-xfade-active', '1', { timeout: 10_000 });
    await page.waitForTimeout(700);
    const pausedAt = await mark(page);
    await hotkey(page, 'Space');
    await expect(page.getByTestId('tt-playpause')).toHaveAttribute('aria-label', 'Phát');
    await page.waitForTimeout(1_200);
    const resumedAt = await mark(page);
    await hotkey(page, 'Space');
    await expect(page.getByTestId('tt-playpause')).toHaveAttribute('aria-label', 'Tạm dừng');
    await expect(html(page)).toHaveAttribute('data-tt-xfade-active', '', { timeout: 5_000 });
    await page.waitForTimeout(500);
    const rec = await recording(page);

    // The first fade, held across the pause rather than ended by it. (B's own
    // fade into C may follow soon after; it is not this test's.)
    const { start: s, end: e } = fades(rec)[0]!;
    expect(s).toBeLessThan(pausedAt);
    expect(e).toBeGreaterThan(resumedAt);

    const solo = median(rmsIn(rec, s - 1_500, s - 200));
    expect(solo).toBeGreaterThan(0.02);
    expect(Math.max(...rmsIn(rec, pausedAt + 250, resumedAt - 50))).toBeLessThan(0.01);
    expect(Math.min(...rmsIn(rec, resumedAt + 300, e - 100))).toBeGreaterThan(solo / 2);

    // The REST of the curve: what was left at the pause, not a fresh 2 s.
    if (realTime(rec, s)) {
      const rest = 2_000 - (pausedAt - s);
      expect(e - resumedAt).toBeGreaterThan(rest - 250);
      expect(e - resumedAt).toBeLessThan(rest + 500);
    }

    // And the queue heard the fade once — at its start, not again on resume.
    expect(
      visits(rec)
        .filter(([t]) => t <= e)
        .map(([, i]) => i),
    ).toEqual([0, 1]);
  });

  test('⏭ mid-fade lands on the track after, once, and it keeps playing', async ({ page }) => {
    /*
     * Red against: `load()` not ending the fade it interrupted — its finish
     * still fired two seconds later and stopped the deck C had just loaded on.
     */
    await gotoApp(page, '/app/?ttdebug=1');
    await stageTones(page);
    await page.getByTestId('tt-repeat').click();
    await setDuration(page, 0, 1, 0);
    await record(page);
    await start(page);

    await expect(html(page)).toHaveAttribute('data-tt-xfade-active', '1', { timeout: 10_000 });
    await expect(rows(page).nth(1)).toHaveClass(/tt-current/);
    const skippedAt = await mark(page);
    await hotkey(page, 'ArrowRight');
    await expect(rows(page).nth(2)).toHaveClass(/tt-current/);
    await page.waitForTimeout(3_000);
    const rec = await recording(page);

    const f = fades(rec);
    expect(f).toHaveLength(1);
    expect(f[0]!.end - skippedAt).toBeLessThan(300);
    expect(visits(rec).map(([, i]) => i)).toEqual([0, 1, 2]);

    // Past the moment the abandoned fade would have finished (≤ 2 s).
    const solo = median(rmsIn(rec, f[0]!.start - 1_500, f[0]!.start - 200));
    expect(Math.min(...rmsIn(rec, skippedAt + 300, skippedAt + 2_900))).toBeGreaterThan(solo / 2);
    expect(Math.max(...rec.urls.map(([, n]) => n))).toBeLessThanOrEqual(2);
  });

  test('a Single loop crossfade fades the track into itself — one file, one URL', async ({
    page,
  }) => {
    /*
     * Red against: the `applyLoopStyle` effect removed — the track already
     * looping kept `element.loop`, and counted its second pass at the 5 s wrap
     * with no fade.
     */
    await gotoApp(page, '/app/?ttdebug=1');
    await stageSingle(page);
    await setDuration(page, 0, 0, 30);
    await record(page);
    const startedAt = await mark(page);
    await start(page);
    // Switched on the rail while the track is already playing — by keyboard:
    // the ?ttdebug=1 panel sits over the rail and takes the pointer.
    await page.getByTestId('tt-crossfade-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tt-crossfade-toggle')).toHaveAttribute('aria-pressed', 'true');

    await expect(page.getByTestId('tt-loop-count')).toHaveText('Loop ×2', { timeout: 10_000 });
    await page.waitForTimeout(2_500);
    const rec = await recording(page);

    const f = fades(rec);
    expect(f.length).toBeGreaterThanOrEqual(1);
    // The fade's own moment, not the 5 s wrap's.
    if (realTime(rec, f[0]!.start)) expect(f[0]!.start - startedAt).toBeLessThan(4_000);
    const [loopAt] = rec.loop.find(([, text]) => text === 'Loop ×2')!;
    expect(loopAt).toBeGreaterThanOrEqual(f[0]!.start);
    expect(loopAt).toBeLessThan(f[0]!.start + 500);

    // The second pass is heard once the first has faded out.
    expect(median(rmsIn(rec, f[0]!.end + 100, f[0]!.end + 1_000))).toBeGreaterThan(0.02);
    expect(Math.max(...rec.urls.map(([, n]) => n))).toBeLessThanOrEqual(1);
  });

  test('zero before the transition: nothing new starts under the end fade', async ({ page }) => {
    /*
     * Red against: the `setNext` effect without its player-screen gate — at
     * ~2.7 s B began fading in under the End Behavior's fade-out, and the
     * engine's track moved while the queue (correctly) did not.
     *
     * 1 s, the shortest countdown, so zero lands well before A's trigger
     * (~2.7 s) and the trigger well inside the 2 s end fade. At 2 s, CI's Linux
     * WebKit — whose media clock runs fast (`realTime`) — reached the trigger
     * first, and the spec measured that browser instead of the gate.
     */
    await gotoApp(page, '/app/?ttdebug=1');
    await stageTones(page);
    await setDuration(page, 0, 0, 1);
    await record(page);
    await start(page);

    await expect(page.getByTestId('tt-finished')).toBeVisible({ timeout: 6_000 });
    // Past where A's trigger lay (~2.7 s) and the end fade (1–3 s).
    await page.waitForTimeout(3_500);
    const rec = await recording(page);

    expect(fades(rec)).toEqual([]);
    expect(visits(rec).map(([, i]) => i)).toEqual([0]);
  });
});
