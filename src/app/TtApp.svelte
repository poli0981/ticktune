<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import TtCountdown from './components/TtCountdown.svelte';
  import TtDebugPanel from './components/TtDebugPanel.svelte';
  import TtFinished from './components/TtFinished.svelte';
  import TtLegalGate from './components/TtLegalGate.svelte';
  import { TtTimerDriver } from './engine/timer/tt-timer-driver';
  import { TT_MAX_COUNTDOWN_MS, TT_MIN_COUNTDOWN_MS } from './engine/timer/tt-format';
  import type { TtTickSample } from './engine/timer/types';
  import { installGlobalCapture, ttLog } from './engine/log/tt-log';
  import { playback } from './state/playback.svelte';
  import { session } from './state/session.svelte';
  import { settings } from './state/settings.svelte';
  import { TT_LEGAL_VERSION } from '../lib/tt-legal-const';

  /**
   * The app shell. Setup, the queue and the player screens land in P2's later
   * slices (docs/16); today this is the countdown, the legal gate and the
   * Finished screen — and it doubles as the spike S2 harness under ?ttdebug=1
   * (docs/15 §S2).
   */

  /**
   * docs/02 §1 boot → gate → setup. `boot` must always reach one of the next two
   * states, so a settings failure downgrades to defaults rather than hanging
   * here (settings.load() never throws).
   */
  let booted = $state(false);
  const needsGate = $derived(session.state === 'gate');

  onMount(() => {
    const uninstall = installGlobalCapture(window);
    void settings.load(navigator.language).then((s) => {
      const gate = s.legalAccepted?.version !== TT_LEGAL_VERSION;
      session.booted(gate);
      booted = true;
      // Boot is async (settings load), so "is the gate showing?" is unanswerable
      // until it completes. Publish the transition so tests — and anything else
      // that needs to know the app settled — can wait on it instead of racing.
      document.documentElement.dataset['ttBooted'] = gate ? 'gate' : 'ready';
    });
    return uninstall;
  });

  /**
   * docs/02 §1 / docs/05 §1: this click is the autoplay-unlock gesture.
   *
   * `unlock()` is fired FIRST and deliberately not awaited: WebKit only counts
   * a `resume()` reached before the gesture task yields, and the `await` below
   * yields. It is one of three unlock sites — the gate only renders when the
   * stored legal version differs, so a returning user reaches playback without
   * ever passing through here (docs/05 §1).
   */
  async function acceptLegal(version: string) {
    void playback.unlock();
    session.gateAccepted();
    await settings.patch({ legalAccepted: { version, acceptedAt: Date.now() } });
    ttLog.info('TT-USR-100', `legal accepted v${version}`);
  }

  let hours = $state(0);
  let minutes = $state(1);
  let seconds = $state(30);

  let remainingMs = $state(90_000);
  let phase = $state<'idle' | 'running' | 'paused' | 'done'>('idle');

  const durationMs = $derived((hours * 3600 + minutes * 60 + seconds) * 1000);
  const valid = $derived(durationMs >= TT_MIN_COUNTDOWN_MS && durationMs <= TT_MAX_COUNTDOWN_MS);
  // The session store owns the state machine (docs/02 §1); the inputs feed it so
  // `canStart` and the Finished screen agree with what is on screen.
  $effect(() => {
    session.countdownMs = durationMs;
  });

  /**
   * While idle the digits preview whatever the inputs currently say, so the
   * format regime and colour are visible before committing to a run. Once the
   * timer owns the value we show its derived remainder — and `done` holds
   * 0.000 per docs/04 §4 rather than snapping back to the input.
   */
  const displayMs = $derived(phase === 'idle' ? durationMs : remainingMs);

  const debug =
    typeof location !== 'undefined' && new URLSearchParams(location.search).has('ttdebug');

  // Spike S2 state (docs/15 §S2). Only populated under ?ttdebug=1; a 90-minute
  // run at 200 ms would otherwise accumulate ~27k objects for nothing.
  let samples = $state<TtTickSample[]>([]);
  let doneInfo = $state<{ late: boolean; overshootMs: number } | null>(null);
  let logLines = $state<string[]>([]);

  // Display staleness, which is a DIFFERENT quantity from the worker tick
  // cadence: below 60 s the digits repaint every rAF frame, so the number the
  // user sees is far fresher than the 200 ms authoritative tick. S2's "visible
  // tab ≤ ±50 ms" is about this; its "±500 ms at done" is about the tick gap.
  // Split by visibility. A single global max is unreadable: rAF is deliberately
  // stopped while hidden (docs/04 §2), so the hidden figure is just the worker
  // cadence and would drown out the visible one that S2's ±50 ms bound is about.
  let maxRenderGapVisibleMs = $state(0);
  let maxRenderGapHiddenMs = $state(0);
  let lastRenderAt = 0;
  let lastRenderHidden = false;
  let runStartedAt = $state(0);
  let hiddenMs = $state(0);
  let lastHiddenAt = 0;
  let nowMs = $state(0);

  const driver = new TtTimerDriver({
    onRemaining: (ms) => {
      remainingMs = ms;
      phase = driver.phase;
      if (debug && driver.phase === 'running') {
        const t = performance.now();
        if (lastRenderAt) {
          const gap = t - lastRenderAt;
          // Attribute by EITHER endpoint, same as the tick-gap split: a stall
          // that accrued while hidden and was only observed after the tab came
          // back would otherwise be filed under "visible". The 2026-07-21
          // control run showed exactly that — a 30.9 s "visible" render gap
          // that was really the tail of a hidden stall.
          if (document.hidden || lastRenderHidden)
            maxRenderGapHiddenMs = Math.max(maxRenderGapHiddenMs, gap);
          else maxRenderGapVisibleMs = Math.max(maxRenderGapVisibleMs, gap);
        }
        lastRenderAt = t;
        lastRenderHidden = document.hidden;
        nowMs = t;
        // Accumulate time spent hidden — the only figure that says whether a run
        // was long enough to reach Chromium's intensive throttling (~5 min).
        if (document.hidden) {
          if (lastHiddenAt) hiddenMs += t - lastHiddenAt;
          lastHiddenAt = t;
        } else {
          lastHiddenAt = 0;
        }
      }
    },
    onDone: (info) => {
      // FIRST, before anything else in this handler: the Finished screen
      // reconstructs the instant zero was reached from the wall clock read here
      // minus the overshoot (docs/04 §2), and the case it exists for is exactly
      // the one where this thread has been stalled.
      session.finished(info);
      phase = 'done';
      remainingMs = 0;
      doneInfo = info;
    },
    onLog: (code, detail) => {
      // Until the log engine lands (docs/02 §7), surface coded events where a
      // human can see them. console.warn is allowed by docs/12 §4 precisely
      // because it feeds the diagnostics buffer.
      console.warn(`[${code}]`, detail ?? {});
      if (debug) logLines = [...logLines, `${code} ${JSON.stringify(detail ?? {})}`];
    },
    ...(debug ? { onSample: (s: TtTickSample) => samples.push(s) } : {}),
  });

  onDestroy(() => driver.dispose());

  function onStart() {
    session.start();
    samples = [];
    doneInfo = null;
    logLines = [];
    maxRenderGapVisibleMs = 0;
    maxRenderGapHiddenMs = 0;
    lastRenderAt = 0;
    lastRenderHidden = false;
    hiddenMs = 0;
    lastHiddenAt = 0;
    runStartedAt = performance.now();
    nowMs = runStartedAt;
    driver.start(durationMs);
  }
</script>

{#if booted && needsGate}
  <TtLegalGate onaccept={acceptLegal} />
{/if}

<main class="grid min-h-dvh place-items-center gap-10 p-8" inert={booted && needsGate}>
  {#if debug}
    <TtDebugPanel
      {samples}
      done={doneInfo}
      logs={logLines}
      {phase}
      {maxRenderGapVisibleMs}
      {maxRenderGapHiddenMs}
      {hiddenMs}
      elapsedMs={runStartedAt && nowMs ? nowMs - runStartedAt : 0}
    />
  {/if}

  <TtCountdown remainingMs={displayMs} />

  <!--
    docs/03 §3.5. The screen replaces the setup controls rather than sitting
    beside them: "Chạy lại" and "Về thiết lập" are the only two moves from here
    (docs/02 §1), and leaving Bắt đầu visible would offer a third that means the
    same as one of them.
  -->
  {#if session.state === 'finished' && session.finish}
    <TtFinished
      report={session.finish}
      onrestart={() => {
        session.restart();
        onStart();
      }}
      onback={() => {
        session.backToSetup();
        driver.reset();
      }}
    />
  {/if}

  <div class="flex flex-col items-center gap-4">
    {#if session.state !== 'finished' && (phase === 'idle' || phase === 'done')}
      <div class="flex items-end gap-2 font-mono text-sm">
        <label class="flex flex-col gap-1">
          <span class="text-tt-muted text-xs">giờ</span>
          <input
            type="number"
            min="0"
            max="24"
            bind:value={hours}
            class="border-tt-line bg-tt-surface w-16 rounded border px-2 py-1 text-center"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-tt-muted text-xs">phút</span>
          <input
            type="number"
            min="0"
            max="59"
            bind:value={minutes}
            class="border-tt-line bg-tt-surface w-16 rounded border px-2 py-1 text-center"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-tt-muted text-xs">giây</span>
          <input
            type="number"
            min="0"
            max="59"
            bind:value={seconds}
            class="border-tt-line bg-tt-surface w-16 rounded border px-2 py-1 text-center"
          />
        </label>
      </div>
    {/if}

    {#if session.state !== 'finished'}
      <div class="flex gap-3">
        {#if phase === 'running'}
          <button
            class="tt-btn"
            onclick={() => {
              session.pause();
              driver.pause();
            }}>Tạm dừng</button
          >
        {:else if phase === 'paused'}
          <button
            class="tt-btn"
            onclick={() => {
              session.resume();
              driver.resume();
            }}>Tiếp tục</button
          >
        {:else}
          <!-- docs/04 §4: 1 s – 24 h. Disabled rather than clamped, so the user
               sees that the value is out of range instead of it silently changing. -->
          <button class="tt-btn" disabled={!valid} onclick={onStart}>Bắt đầu</button>
        {/if}

        {#if phase !== 'idle'}
          <!-- docs/02 §1's Stop edge: playing/paused → setup. -->
          <button
            class="tt-btn"
            onclick={() => {
              session.stop();
              driver.reset();
            }}>Đặt lại</button
          >
        {/if}
      </div>
    {/if}
  </div>
</main>

<style>
  .tt-btn {
    border: 1px solid var(--color-tt-line);
    background: var(--color-tt-surface);
    color: var(--color-tt-signal);
    border-radius: 0.375rem;
    padding: 0.5rem 1.25rem;
    font-weight: 500;
    transition: border-color var(--duration-tt-fast) var(--ease-tt);
  }
  .tt-btn:hover:not(:disabled) {
    border-color: var(--color-tt-signal);
  }
  .tt-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
