import { test, expect, type Page } from '@playwright/test';
import {
  dismissUnloadDialogs,
  gotoApp,
  setDuration,
  stageSingle,
  storedSettings,
} from './_helpers';
import { gotoYouTubeApp, stageLinks } from './_helpers-yt';

/**
 * docs/03 §2 Z2 and docs/05 §6 — P5 slice 4, the last of the phase.
 *
 * Two fields (`visualizer`, `visualizerSensitivity`) complete the fourteen
 * `16 §P5` measured as persisted-and-unread. But the assertions that matter
 * here are about things a unit test structurally cannot see: that the canvas
 * receives real audio, that the tally light keeps the beat **with the
 * visualizer off**, and that reduced motion stops both.
 *
 * ⚠️ Firefox is skipped on the audio-dependent assertions only. CI's Firefox
 * cannot produce audible output (`AudioContext.resume()` hangs on the Linux
 * runner, `13 §3`), so a beat of exactly 0 there would be an environment fact
 * rather than a product one. Everything that reads no analyser runs on both.
 */

/** Whether the canvas has drawn any non-transparent pixel. */
async function canvasHasInk(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid=tt-visualizer]') as HTMLCanvasElement | null;
    if (!c || c.width === 0) return false;
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) return true;
    return false;
  });
}

/** The tally's beat value, as the shell publishes it. */
async function beat(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid=tt-tally]') as HTMLElement | null;
    return el ? parseFloat(el.style.getPropertyValue('--tt-beat') || '0') : -1;
  });
}

/**
 * Start a local track playing, with the given visualizer style selected.
 *
 * ⚠️ Does NOT register the unload-dialog handler — the caller does, once.
 * `dismissUnloadDialogs` is `page.on('dialog', …)`, so calling it from here
 * would add a listener per invocation and a test that plays twice would fail
 * with "Cannot accept dialog which is already handled".
 */
async function play(page: Page, style: 'off' | 'bars' | 'wave' | 'ring'): Promise<void> {
  await gotoApp(page);
  await page.keyboard.press('s');
  await page.getByTestId(`tt-set-viz-${style}`).click();
  await expect.poll(() => storedSettings(page)).toMatchObject({ visualizer: style });
  await page.keyboard.press('Escape');

  await stageSingle(page);
  await setDuration(page, 0, 5, 0);
  await page.getByRole('button', { name: 'Bắt đầu' }).click();

  /*
   * Wait for the PLAYER SCREEN, not for `ttAudio === 'running'`.
   *
   * On the CI Firefox `AudioContext.resume()` hangs (docs/13 §3), so `ttAudio`
   * stays `suspended` there forever — and two of the tests below need no
   * audible output at all (the canvas being absent at `off`, and reduced
   * motion). Gating `play()` on `running` failed both for an environment
   * reason rather than a product one. The tally goes `tt-live` the instant
   * `session.state` is `playing`, which is synchronous with the click; the
   * tests that DO need real audio poll `canvasHasInk`/`beat` themselves and
   * skip Firefox on their own line.
   */
  await expect(page.getByTestId('tt-tally')).toHaveClass(/tt-live/);
}

test.describe('the visualizer canvas', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');
  test.beforeEach(({ page }) => dismissUnloadDialogs(page));

  test('is absent while the style is off', async ({ page }) => {
    // `off` is the shipped default (docs/02 §3.1, changed in slice 1 precisely
    // so no upgrade imposes a moving graphic).
    await play(page, 'off');
    await expect(page.getByTestId('tt-visualizer')).toHaveCount(0);
  });

  // One test per style rather than a loop in one test: each gets its own page,
  // which keeps a failure attributable to the style that caused it.
  for (const style of ['bars', 'wave', 'ring'] as const) {
    test(`${style} renders and paints real pixels`, async ({ browserName, page }) => {
      test.skip(
        browserName === 'firefox',
        'needs audible output; AudioContext.resume() hangs on the CI Firefox (docs/13 §3)',
      );
      await play(page, style);
      await expect(page.getByTestId('tt-visualizer')).toHaveAttribute('data-tt-style', style);
      // Ink, not merely a mounted element: a canvas that renders nothing looks
      // identical to one that is working on a quiet passage, and only a real
      // analyser frame can put pixels down.
      await expect.poll(() => canvasHasInk(page), { timeout: 8000 }).toBe(true);
    });
  }

  test('sizes its backing store to CSS px x min(dpr, 2) — docs/05 §6', async ({
    browserName,
    page,
  }) => {
    test.skip(browserName === 'firefox', 'needs audible output (docs/13 §3)');
    await play(page, 'bars');
    await expect.poll(() => canvasHasInk(page), { timeout: 8000 }).toBe(true);

    const ok = await page.evaluate(() => {
      const c = document.querySelector('[data-testid=tt-visualizer]') as HTMLCanvasElement;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      return (
        c.width === Math.round(c.clientWidth * dpr) && c.height === Math.round(c.clientHeight * dpr)
      );
    });
    expect(ok).toBe(true);
  });
});

test.describe('the tally light keeps the beat — docs/03 §1, docs/05 §6', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('pulses with the visualizer OFF, which is the whole point of it', async ({
    browserName,
    page,
  }) => {
    /*
     * `05 §6`: "even Visualizer: off keeps one live beat element". If the beat
     * were published by the canvas's draw path, turning the style off would
     * silently kill the tally too — and nothing else in the app would notice.
     * That is why the beat is a separate channel and why this test exists at
     * the `off` setting rather than at a pretty one.
     */
    test.skip(browserName === 'firefox', 'needs audible output (docs/13 §3)');
    await play(page, 'off');
    await expect(page.getByTestId('tt-visualizer')).toHaveCount(0);
    await expect.poll(() => beat(page), { timeout: 8000 }).toBeGreaterThan(0);
  });

  test('is steady at zero in YouTube mode — no Analyser exists there', async ({ page }) => {
    // A hard platform limit rather than a preference (docs/05 §6), and Firefox
    // runs this one: the audio is inside a cross-origin iframe, so no
    // AudioContext is involved and the CI runner's missing device is irrelevant.
    dismissUnloadDialogs(page);
    await gotoYouTubeApp(page);
    await stageLinks(page, ['jNQXAC9IVRw']);
    await setDuration(page, 0, 5, 0);
    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.getByTestId('tt-yt-frame')).toBeVisible();

    await expect(page.getByTestId('tt-visualizer')).toHaveCount(0);
    expect(await beat(page)).toBe(0);
    // The dot is still LIVE, just not pulsing — docs/03 §1's "steady".
    await expect(page.getByTestId('tt-tally')).toHaveClass(/tt-live/);
  });
});

test.describe('reduced motion suppresses both — docs/03 §8', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  // page.emulateMedia(), not test.use({ reducedMotion }) — measured on
  // @playwright/test 1.61.1, the fixture option did not reach matchMedia.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('no canvas, no pulse, and the stored style is left alone', async ({ page }) => {
    /*
     * docs/02 §3.1: reduced motion "does not rewrite these values — it
     * suppresses them at render time". A build that switched `visualizer` to
     * `off` in the store instead would look identical here and would destroy
     * the user's choice the first time they opened the app on a machine with
     * the OS setting on.
     */
    await play(page, 'ring');
    await expect(page.getByTestId('tt-visualizer')).toHaveCount(0);
    expect(await beat(page)).toBe(0);

    await page.keyboard.press('s');
    await expect(page.getByTestId('tt-set-viz-ring')).toHaveAttribute('aria-pressed', 'true');
    expect(await storedSettings(page)).toMatchObject({ visualizer: 'ring' });
  });
});

test.describe('milestone announcements — docs/03 §8', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('the countdown itself still has no aria-live', async ({ page }) => {
    // Announcing every tick is screen-reader spam, which is why the milestones
    // are a separate region rather than an attribute on the digits.
    await gotoApp(page);
    const live = await page.evaluate(() =>
      document.querySelector('.tt-countdown')?.getAttribute('aria-live'),
    );
    expect(live).toBeNull();
  });

  test('the polite region exists and starts empty', async ({ page }) => {
    await gotoApp(page);
    const region = page.getByTestId('tt-milestone');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(region).toHaveText('');
  });

  test('announces ten seconds, then zero, and nothing in between', async ({ page }) => {
    /*
     * A real countdown rather than a fake clock: `page.clock` does not reach
     * the timer worker (`13 §3` records that), and the announcements are driven
     * by the tick, so a fast-forward would prove only that the component has an
     * `if`. Twelve seconds is short enough to run for real and long enough to
     * cross exactly two thresholds.
     */
    dismissUnloadDialogs(page);
    await gotoApp(page);
    await stageSingle(page);
    await setDuration(page, 0, 0, 12);

    const seen: string[] = [];
    await page.exposeFunction('__ttSeen', (text: string) => void seen.push(text));
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid=tt-milestone]')!;
      new MutationObserver(() => {
        const t = el.textContent?.trim();
        if (t) void (window as unknown as { __ttSeen: (s: string) => void }).__ttSeen(t);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    });

    await page.getByRole('button', { name: 'Bắt đầu' }).click();
    await expect(page.getByTestId('tt-finished')).toBeVisible({ timeout: 20_000 });

    // Exactly the two thresholds a 12 s countdown crosses — 10 min, 5 min and
    // 1 min are all above where it started, and must stay silent.
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatch(/mười giây|ten seconds/i);
    expect(seen[1]).toMatch(/hết giờ|time is up/i);
  });
});
