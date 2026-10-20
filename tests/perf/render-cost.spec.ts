import { appendFileSync, mkdirSync } from 'node:fs';
import { test, expect, type Page } from '../e2e/_fixtures';
import { dismissUnloadDialogs, gotoApp, setDuration, stageSingle } from '../e2e/_helpers';
import { seedSettings } from '../e2e/_helpers-yt';
import { TT_FRAME_BUDGET_MS } from '../../src/app/engine/visuals/tt-visualizer';

/**
 * What the countdown costs to draw — docs/13 §5 (v2.0), the audit's
 * "Countdown rendering cost" item.
 *
 * Under a minute the countdown is `SS.mmm` and changes on every rAF frame
 * (04 §4), so it is the one element re-rastered every frame: the digits with
 * their glow, the ghost segments, the display window and the scanlines — with
 * the visualizer drawing on the same frames. This drives the real app into
 * that regime at 1440p and 4K, at 1× and under Chromium's 6× CPU throttle, and
 * records the frame intervals, the long tasks and the main thread's time per
 * frame. The budget it asserts is docs/13 §5's. `TT_PERF_SOFTWARE=1` runs it
 * without a GPU, the case a strong GPU hides.
 *
 * Run headed on a real machine (playwright.perf.config.ts says why);
 * `test-results/render-cost.jsonl` keeps every row for the docs.
 */

const STYLES = ['off', 'bars', 'ring'] as const;
const RATES = [1, 6] as const;
const WARMUP_MS = 2_000;
const SAMPLE_MS = 8_000;
const OUT = 'test-results/render-cost.jsonl';

interface Sample {
  intervals: number[];
  longTasks: number[];
  digits: string[];
  /** Visualizer frames actually drawn — `clearRect` calls (docs/05 §6's degrade skips some). */
  drawn: number;
}

/** Frame intervals, long tasks and what the digits read, over `ms` of rAF. */
function sample(page: Page, ms: number): Promise<Sample> {
  return page.evaluate(async (span) => {
    const intervals: number[] = [];
    const longTasks: number[] = [];
    const digits: string[] = [];
    const el = document.querySelector('.tt-countdown');
    const drawnAt = () => (window as unknown as { __ttDrawn?: number }).__ttDrawn ?? 0;
    const drawn0 = drawnAt();
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push(e.duration);
    });
    po.observe({ type: 'longtask' });
    await new Promise<void>((done) => {
      const end = performance.now() + span;
      let last = 0;
      const step = (t: number) => {
        if (last) intervals.push(t - last);
        last = t;
        if (intervals.length % 60 === 1) digits.push(el?.textContent?.trim() ?? '');
        if (t < end) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    po.disconnect();
    return { intervals, longTasks, digits, drawn: drawnAt() - drawn0 };
  }, ms);
}

const percentile = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? Number.NaN;
};
const round = (x: number) => Math.round(x * 10) / 10;

for (const rate of RATES) {
  for (const style of STYLES) {
    test(`SS.mmm · visualizer ${style} · CPU ${rate}×`, async ({ page }, info) => {
      dismissUnloadDialogs(page);
      // Count the visualizer's drawn frames: each one starts with a clearRect.
      await page.addInitScript(() => {
        const w = window as unknown as { __ttDrawn: number };
        const clear = CanvasRenderingContext2D.prototype.clearRect;
        w.__ttDrawn = 0;
        CanvasRenderingContext2D.prototype.clearRect = function (...a) {
          w.__ttDrawn += 1;
          return clear.apply(this, a);
        };
      });
      await gotoApp(page);
      await seedSettings(page, { visualizer: style });
      await page.reload();
      await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);
      await stageSingle(page);
      await setDuration(page, 0, 0, 50);
      await page.getByRole('button', { name: 'Bắt đầu' }).click();
      // In the per-frame regime before anything is measured.
      await expect(page.locator('.tt-countdown')).toContainText(/\d\d\.\d\d\d/);

      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      const metrics = async () =>
        Object.fromEntries(
          (await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
        );
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await sample(page, WARMUP_MS);
      const before = await metrics();
      const run = await sample(page, SAMPLE_MS);
      const after = await metrics();
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

      const env = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return {
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
          gpu: ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown',
        };
      });
      const frames = run.intervals.length;
      const median = percentile(run.intervals, 50);
      const delta = (name: string) => ((after[name] ?? 0) - (before[name] ?? 0)) * 1000;
      const row = {
        size: info.project.name,
        rate,
        style,
        ...env,
        frames,
        drawn: run.drawn,
        fps: round((frames / SAMPLE_MS) * 1000),
        p50: round(median),
        p95: round(percentile(run.intervals, 95)),
        p99: round(percentile(run.intervals, 99)),
        max: round(Math.max(...run.intervals)),
        // A frame later than 1.5× the median interval is one the display missed.
        missed: run.intervals.filter((x) => x > 1.5 * median).length,
        longTasks: run.longTasks.length,
        longestTask: round(Math.max(0, ...run.longTasks)),
        // Main-thread milliseconds per frame, from the renderer's own counters.
        taskPerFrame: round(delta('TaskDuration') / frames),
        scriptPerFrame: round(delta('ScriptDuration') / frames),
        stylePerFrame: round(delta('RecalcStyleDuration') / frames),
        layoutPerFrame: round(delta('LayoutDuration') / frames),
        digits: run.digits.slice(0, 3),
      };
      mkdirSync('test-results', { recursive: true });
      appendFileSync(OUT, JSON.stringify(row) + '\n');
      // The probe's output is its result: one line per configuration.
      process.stdout.write(`${JSON.stringify(row)}\n`);

      // The digits moved: every sample was a different SS.mmm.
      expect(new Set(run.digits).size).toBe(run.digits.length);
      expect(env.width).toBe(info.project.use.viewport?.width);
      // docs/13 §5's budget, GPU or not: no long task, and the main thread
      // inside the visualizer's own 20 ms degrade budget every frame. A full
      // 4K canvas without a GPU broke the second (32.9 ms) before the pixel cap.
      expect(row.longTasks).toBe(0);
      expect(row.taskPerFrame).toBeLessThanOrEqual(TT_FRAME_BUDGET_MS);
    });
  }
}
