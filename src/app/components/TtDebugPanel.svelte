<script lang="ts">
  import type { TtTickSample } from '../engine/timer/types';

  /**
   * Spike S2 instrument — docs/15 §S2. Rendered only under `?ttdebug=1`.
   *
   * S2 asks for the countdown's real accuracy across seven cases, most of which
   * cannot be automated: they need a tab hidden for 30–90 minutes, a minimised
   * window, a machine suspended across zero, and the system clock moved by hand.
   * So this collects the measurements while the operator drives the browser.
   *
   * The keep-alive oscillator is the apparatus for case 3, the one the original
   * acceptance criteria could not fail on: hidden AND silent. Chromium exempts
   * *audible* tabs from intensive throttling, so the difference between a run
   * with it on and one with it off IS the measurement. It is deliberately a raw
   * ~0-gain oscillator and not the audio engine — docs/15's scope rule keeps
   * audio-engine code behind S3/S4, and this is measurement apparatus.
   */

  interface Props {
    samples: TtTickSample[];
    done: { late: boolean; overshootMs: number } | null;
    logs: string[];
    phase: string;
    /** Worst gap between display repaints, split by visibility — see TtApp. */
    maxRenderGapVisibleMs: number;
    maxRenderGapHiddenMs: number;
    /** Cumulative time the tab spent hidden during this run. */
    hiddenMs: number;
    elapsedMs: number;
  }

  const {
    samples,
    done,
    logs,
    phase,
    maxRenderGapVisibleMs,
    maxRenderGapHiddenMs,
    hiddenMs,
    elapsedMs,
  }: Props = $props();

  /**
   * Chromium escalates to *intensive* wake-up throttling roughly five minutes
   * after a page is hidden. A run that ends before then never exercises the
   * behaviour S2 exists to measure, however good its numbers look — so say so,
   * loudly, rather than letting a short green run read as a pass.
   */
  const THROTTLE_ONSET_MS = 5 * 60_000;
  const tooShort = $derived(hiddenMs > 0 && hiddenMs < THROTTLE_ONSET_MS + 60_000);

  let keepAlive = $state(false);
  let audioCtx: AudioContext | null = null;
  let osc: OscillatorNode | null = null;

  function toggleKeepAlive() {
    keepAlive = !keepAlive;
    if (keepAlive) {
      audioCtx ??= new AudioContext();
      const gain = audioCtx.createGain();
      // Inaudible, but enough for the tab to count as playing audio.
      gain.gain.value = 0.0001;
      osc = audioCtx.createOscillator();
      osc.frequency.value = 40;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      void audioCtx.resume();
    } else {
      osc?.stop();
      osc?.disconnect();
      osc = null;
    }
  }

  /**
   * Split by visibility — but attribute a gap to "hidden" if EITHER end of it
   * was hidden. A sample carries the visibility at the moment its tick landed,
   * so a 6-minute stall that accrued while hidden and was only reported after
   * the tab came back would otherwise be filed under "visible" and make the
   * visible column look catastrophic for no reason. Observed exactly that in the
   * 2026-07-21 case-3 run: 395 s labelled visible.
   */
  const spanHidden = $derived(samples.map((s, i) => s.hidden || (i > 0 && samples[i - 1]!.hidden)));
  const visible = $derived(samples.filter((_, i) => !spanHidden[i]));
  const hidden = $derived(samples.filter((_, i) => spanHidden[i]));

  /**
   * Worst gap between AUTHORITATIVE ticks (the 200 ms worker). This is not
   * countdown error — derived time is exact whenever it is read — it is the
   * upper bound on how late `done` can fire, which is what S2's ±500 ms figure
   * actually constrains. Display freshness is a separate metric
   * (maxRenderGapMs) because rAF repaints far more often than the worker ticks.
   */
  function maxGap(list: TtTickSample[]): number {
    return list.reduce((m, s) => Math.max(m, s.dWallMs), 0);
  }

  function maxSkew(list: TtTickSample[]): number {
    return list.reduce((m, s) => Math.max(m, Math.abs(s.skewMs)), 0);
  }

  const report = $derived({
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    startedAt: samples[0]?.wallMs ?? null,
    keepAliveAudio: keepAlive,
    phase,
    counts: { total: samples.length, visible: visible.length, hidden: hidden.length },
    elapsedMs: Math.round(elapsedMs),
    hiddenMs: Math.round(hiddenMs),
    reachedIntensiveThrottling: hiddenMs >= THROTTLE_ONSET_MS,
    maxRenderGapMs: {
      visible: Math.round(maxRenderGapVisibleMs),
      hidden: Math.round(maxRenderGapHiddenMs),
    },
    maxTickGapMs: { visible: maxGap(visible), hidden: maxGap(hidden) },
    maxAbsSkewMs: { visible: maxSkew(visible), hidden: maxSkew(hidden) },
    done,
    logs,
  });

  let copied = $state(false);
  async function copyReport() {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<aside class="tt-debug font-mono">
  <header>
    <strong>S2 harness</strong>
    <span class="muted">docs/15 §S2</span>
  </header>

  <label class="row">
    <input type="checkbox" checked={keepAlive} onchange={toggleKeepAlive} />
    <span>keep-alive audio <span class="muted">(case 3: hidden + silent vs audible)</span></span>
  </label>

  <dl>
    <div>
      <dt>samples</dt>
      <dd>{report.counts.total}</dd>
    </div>
    <div>
      <dt>visible / hidden</dt>
      <dd>{report.counts.visible} / {report.counts.hidden}</dd>
    </div>
    <div>
      <dt title="display repaint staleness while visible — S2's ±50 ms bound">
        render gap visible
      </dt>
      <dd class:bad={report.maxRenderGapMs.visible > 50}>{report.maxRenderGapMs.visible} ms</dd>
    </div>
    <div>
      <dt title="rAF is deliberately stopped while hidden; this is just the worker cadence">
        render gap hidden
      </dt>
      <dd>{report.maxRenderGapMs.hidden} ms</dd>
    </div>
    <div>
      <dt>hidden for</dt>
      <dd class:bad={tooShort}>{(hiddenMs / 60_000).toFixed(1)} min</dd>
    </div>
    <div>
      <dt title="authoritative worker tick, ~200 ms nominal">tick gap visible</dt>
      <dd>{report.maxTickGapMs.visible} ms</dd>
    </div>
    <div>
      <dt title="the number that matters: bounds how late done can fire">tick gap hidden</dt>
      <dd class:bad={report.maxTickGapMs.hidden > 500}>{report.maxTickGapMs.hidden} ms</dd>
    </div>
    <div>
      <dt>max |skew|</dt>
      <dd>{Math.max(report.maxAbsSkewMs.visible, report.maxAbsSkewMs.hidden)} ms</dd>
    </div>
    {#if done}
      <div>
        <dt>overshoot at done</dt>
        <dd class:bad={Math.abs(done.overshootMs) > 500}>
          {Math.round(done.overshootMs)} ms {done.late ? '(late latch)' : ''}
        </dd>
      </div>
    {/if}
  </dl>

  {#if tooShort}
    <p class="warn">
      ⚠ Hidden for only {(hiddenMs / 60_000).toFixed(1)} min. Chromium escalates to
      <em>intensive</em> wake-up throttling at ~5 min hidden, so this run stopped before the behaviour
      S2 is measuring can appear. Good numbers here do not constitute a pass — run 30–90 min (docs/15
      §S2).
    </p>
  {/if}

  {#if logs.length}
    <ul class="logs">
      {#each logs.slice(-6) as line (line)}<li>{line}</li>{/each}
    </ul>
  {/if}

  <button onclick={copyReport}>{copied ? 'copied ✓' : 'copy JSON report'}</button>
</aside>

<style>
  .tt-debug {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 40;
    width: 21rem;
    padding: 0.75rem 0.9rem;
    font-size: 11px;
    line-height: 1.5;
    color: var(--color-tt-text);
    background: color-mix(in srgb, var(--color-tt-surface) 92%, transparent);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.5rem;
  }
  header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .muted {
    color: var(--color-tt-muted);
  }
  .row {
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
    margin-bottom: 0.5rem;
    cursor: pointer;
  }
  dl {
    display: grid;
    gap: 0.15rem;
    margin: 0 0 0.6rem;
  }
  dl > div {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }
  dt {
    color: var(--color-tt-muted);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .bad {
    color: var(--color-tt-danger);
  }
  .warn {
    margin: 0 0 0.6rem;
    padding: 0.4rem 0.5rem;
    color: var(--color-tt-warn);
    border: 1px solid var(--color-tt-warn);
    border-radius: 0.25rem;
    line-height: 1.4;
  }
  .logs {
    margin: 0 0 0.6rem;
    padding-left: 1rem;
    color: var(--color-tt-warn);
  }
  button {
    width: 100%;
    padding: 0.35rem;
    color: var(--color-tt-signal);
    background: transparent;
    border: 1px solid var(--color-tt-line);
    border-radius: 0.25rem;
  }
  button:hover {
    border-color: var(--color-tt-signal);
  }
</style>
