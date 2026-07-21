import { test, expect } from '@playwright/test';
import { acceptLegalGate } from './_helpers';

/**
 * TEMPORARY DIAGNOSTIC — delete once the Firefox question is settled.
 *
 * Firefox on CI leaves the AudioContext `suspended`; a real Firefox plays fine.
 * Two causes look identical from outside and have opposite remedies:
 *
 *   (a) autoplay policy still blocking → a pref/gesture problem, ours to fix
 *   (b) no audio output device on the runner → Firefox's cubeb backend cannot
 *       start a context with no sink. No app change helps; CI needs a sound
 *       device, or those assertions do not belong on this browser.
 *
 * `currentTime` is the discriminator: a context that reports `running` but
 * whose clock never advances has no sink. `console.warn`, not `.log` — docs/12
 * §4 bans the latter.
 */
test('DIAG: what AudioContext.resume() actually does here', async ({ page, browserName }) => {
  await page.goto('/app/');
  await acceptLegalGate(page);

  const report = await page.evaluate(async () => {
    const out: Record<string, unknown> = {};
    out['appCtxState'] = document.documentElement.dataset['ttAudio'] ?? '(unset)';
    try {
      const ctx = new AudioContext();
      out['freshState'] = ctx.state;
      try {
        await ctx.resume();
        out['resume'] = 'resolved';
      } catch (e) {
        out['resume'] = `rejected ${(e as Error).name}: ${(e as Error).message}`;
      }
      out['afterResume'] = ctx.state;
      out['sampleRate'] = ctx.sampleRate;

      const t0 = ctx.currentTime;
      await new Promise((r) => setTimeout(r, 800));
      // THE discriminator: no sink ⇒ the clock does not move.
      out['clockAdvanced'] = Number((ctx.currentTime - t0).toFixed(4));

      await ctx.close();
    } catch (e) {
      out['constructError'] = `${(e as Error).name}: ${(e as Error).message}`;
    }
    return out;
  });

  console.warn(`[DIAG ${browserName}] ${JSON.stringify(report)}`);
  expect(report).toBeTruthy();
});
