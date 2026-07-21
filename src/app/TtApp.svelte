<script lang="ts">
  import { onDestroy } from 'svelte';
  import TtCountdown from './components/TtCountdown.svelte';
  import TtDebugPanel from './components/TtDebugPanel.svelte';
  import { TtTimerDriver } from './engine/timer/tt-timer-driver';
  import { TT_MAX_COUNTDOWN_MS, TT_MIN_COUNTDOWN_MS } from './engine/timer/tt-format';
  import type { TtTickSample } from './engine/timer/types';

  /**
   * P1 shell. The legal gate, setup, queue and player land in later phases
   * (docs/16); this is the countdown plus the minimum needed to drive it — and
   * it doubles as the spike S2 harness under ?ttdebug=1 (docs/15 §S2).
   */

  let hours = $state(0);
  let minutes = $state(1);
  let seconds = $state(30);

  let remainingMs = $state(90_000);
  let phase = $state<'idle' | 'running' | 'paused' | 'done'>('idle');
  let notice = $state('');

  const durationMs = $derived((hours * 3600 + minutes * 60 + seconds) * 1000);
  const valid = $derived(durationMs >= TT_MIN_COUNTDOWN_MS && durationMs <= TT_MAX_COUNTDOWN_MS);

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
          if (document.hidden) maxRenderGapHiddenMs = Math.max(maxRenderGapHiddenMs, gap);
          else maxRenderGapVisibleMs = Math.max(maxRenderGapVisibleMs, gap);
        }
        lastRenderAt = t;
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
      phase = 'done';
      remainingMs = 0;
      doneInfo = info;
      notice = info.late ? "Time's up (recovered after suspend)" : "Time's up";
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
    notice = '';
    samples = [];
    doneInfo = null;
    logLines = [];
    maxRenderGapVisibleMs = 0;
    maxRenderGapHiddenMs = 0;
    lastRenderAt = 0;
    hiddenMs = 0;
    lastHiddenAt = 0;
    runStartedAt = performance.now();
    nowMs = runStartedAt;
    driver.start(durationMs);
  }
</script>

<main class="grid min-h-dvh place-items-center gap-10 p-8">
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

  <div class="flex flex-col items-center gap-4">
    {#if phase === 'idle' || phase === 'done'}
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

    <div class="flex gap-3">
      {#if phase === 'running'}
        <button class="tt-btn" onclick={() => driver.pause()}>Tạm dừng</button>
      {:else if phase === 'paused'}
        <button class="tt-btn" onclick={() => driver.resume()}>Tiếp tục</button>
      {:else}
        <!-- docs/04 §4: 1 s – 24 h. Disabled rather than clamped, so the user
             sees that the value is out of range instead of it silently changing. -->
        <button class="tt-btn" disabled={!valid} onclick={onStart}>Bắt đầu</button>
      {/if}

      {#if phase !== 'idle'}
        <button
          class="tt-btn"
          onclick={() => {
            notice = '';
            driver.reset();
          }}>Đặt lại</button
        >
      {/if}
    </div>

    <p class="text-tt-muted h-5 font-mono text-xs" data-testid="tt-notice">{notice}</p>
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
