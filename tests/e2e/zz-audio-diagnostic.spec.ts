import { test, expect } from '@playwright/test';
import { acceptLegalGate } from './_helpers';

/**
 * TEMPORARY DIAGNOSTIC — delete once the Firefox audio question is settled.
 *
 * Firefox on CI leaves the AudioContext `suspended` even with
 * `media.autoplay.default: 0`. Two very different causes look identical from
 * the outside, and they have opposite remedies:
 *
 *   (a) autoplay policy still blocking  → a pref or gesture problem, ours to fix
 *   (b) no audio output device on the runner → environment; Firefox's cubeb
 *       backend cannot start a context with no sink, and no app change helps
 *
 * This asserts nothing about the product. It prints what `resume()` actually
 * does so the next change is informed rather than another guess.
 */
test('DIAG: what does AudioContext.resume() do here', async ({ page, browserName }) => {
  await page.goto('/app/');
  await acceptLegalGate(page);

  const report = await page.evaluate(async () => {
    const out: Record<string, unknown> = {};
    out['appCtxState'] = document.documentElement.dataset['ttAudio'] ?? '(unset)';

    // A context created inside this evaluate has NO user gesture behind it —
    // the useful comparison against the app's, which does.
    try {
      const ctx = new AudioContext();
      out['freshState'] = ctx.state;
      try {
        await ctx.resume();
        out['resumeResult'] = 'resolved';
      } catch (e) {
        out['resumeResult'] = `rejected: ${(e as Error).name}: ${(e as Error).message}`;
      }
      out['stateAfterResume'] = ctx.state;
      out['sampleRate'] = ctx.sampleRate;
      out['baseLatency'] = ctx.baseLatency;

      // Does the clock actually advance? A context with no sink reports
      // "running" in some builds but never moves currentTime.
      const t0 = ctx.currentTime;
      await new Promise((r) => setTimeout(r, 600));
      out['currentTimeAdvanced'] = ctx.currentTime - t0;

      await ctx.close();
    } catch (e) {
      out['constructError'] = `${(e as Error).name}: ${(e as Error).message}`;
    }
    return out;
  });

  console.log(`[DIAG ${browserName}] ${JSON.stringify(report, null, 2)}`);
  expect(report).toBeTruthy();
});
