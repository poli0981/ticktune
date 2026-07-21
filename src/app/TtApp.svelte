<script lang="ts">
  import { onDestroy } from 'svelte';
  import TtCountdown from './components/TtCountdown.svelte';
  import { TtTimerDriver } from './engine/timer/tt-timer-driver';
  import { TT_MAX_COUNTDOWN_MS, TT_MIN_COUNTDOWN_MS } from './engine/timer/tt-format';

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

  const driver = new TtTimerDriver({
    onRemaining: (ms) => {
      remainingMs = ms;
      phase = driver.phase;
    },
    onDone: ({ late }) => {
      phase = 'done';
      remainingMs = 0;
      notice = late ? "Time's up (recovered after suspend)" : "Time's up";
    },
    onLog: (code, detail) => {
      // Until the log engine lands (docs/02 §7), surface coded events where a
      // human can see them. console.warn is allowed by docs/12 §4 precisely
      // because it feeds the diagnostics buffer.
      console.warn(`[${code}]`, detail ?? {});
      if (debug) notice = `${code} ${JSON.stringify(detail ?? {})}`;
    },
  });

  onDestroy(() => driver.dispose());

  function onStart() {
    notice = '';
    driver.start(durationMs);
  }
</script>

<main class="grid min-h-dvh place-items-center gap-10 p-8">
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
