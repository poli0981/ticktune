<script lang="ts">
  /**
   * Spike S4b harness — docs/15 §S4.
   *
   * Measures crossfades on the SHIPPING graph (`buildTtGraph`), from the audio:
   * an AudioWorklet probe per deck reads the signal before and after its gain,
   * and a third reads the master around `fadeGain`. The old harness read back
   * the `gain.value` it had scheduled, so it could not fail; this one runs four
   * deliberately broken controls first and calls itself INVALID unless every
   * one of them fails.
   *
   * Load the files from `pnpm s4b:fixtures` (test/generated/s4b/, including
   * manifest.json), press Unlock, then a sweep. `pnpm s4b` drives the same page
   * through Playwright; these buttons are for Firefox and Safari by hand.
   */
  import { onMount } from 'svelte';
  import {
    contextState,
    loadFiles,
    loadedFileCount,
    loadedFixtures,
    run,
    unlock,
    type TtS4bRunResult,
  } from './tt-s4b-runner';
  import { fullPlan, quickPlan, type TtS4bRunConfig } from './tt-s4b-sweep-plan';
  import { judgeRun, verdict, type TtJudgedRun, type TtVerdict } from './tt-s4b-verdict';

  let ctxState = $state('none');
  let fileCount = $state(0);
  let fixtureCount = $state(0);
  let busy = $state(false);
  let progress = $state('');
  let judged = $state<TtJudgedRun[]>([]);
  let raw = $state<TtS4bRunResult[]>([]);
  let result = $state<TtVerdict | null>(null);

  async function sweep(plan: TtS4bRunConfig[]): Promise<TtVerdict> {
    busy = true;
    judged = [];
    raw = [];
    try {
      for (const [i, cfg] of plan.entries()) {
        progress = `${i + 1}/${plan.length} · ${cfg.label}`;
        const results = await run(cfg).catch((e: unknown) => {
          progress = `${cfg.label}: ${String(e)}`;
          return [] as TtS4bRunResult[];
        });
        raw = [...raw, ...results];
        judged = [...judged, ...results.map(judgeRun)];
      }
      result = verdict(judged);
      return result;
    } finally {
      busy = false;
      progress = '';
    }
  }

  const report = () =>
    JSON.stringify({ verdict: result, runs: judged, raw, at: new Date().toISOString() }, null, 2);

  onMount(() => {
    // The automation seam scripts/s4b-sweep.ts drives — the same code as the buttons.
    (window as unknown as { __ttS4b: unknown }).__ttS4b = {
      unlock: async () => (ctxState = await unlock()),
      fixtures: () => loadedFixtures(),
      run,
      judge: judgeRun,
      verdict,
      plans: { quick: quickPlan, full: fullPlan },
    };
  });
</script>

<section class="mx-auto max-w-5xl p-8 font-mono text-sm">
  <h1 class="mb-1 text-xl font-semibold">S4b — crossfade trigger, measured from the audio</h1>
  <p class="mb-6 text-xs text-tt-muted">
    docs/15 §S4. Load everything in <code>test/generated/s4b/</code> (with
    <code>manifest.json</code>), press Unlock, then run a sweep. Corpus runs need
    <code>pnpm s4b:fixtures --corpus</code>.
  </p>

  <div class="flex flex-wrap items-center gap-4">
    <input
      type="file"
      multiple
      accept="audio/*,.json"
      data-testid="s4b-files"
      onchange={async (e) => {
        await loadFiles(Array.from((e.currentTarget as HTMLInputElement).files ?? []));
        fileCount = loadedFileCount();
        fixtureCount = loadedFixtures().length;
      }}
    />
    <button
      class="tt-b"
      data-testid="s4b-unlock"
      onclick={async () => {
        ctxState = await unlock();
      }}>unlock (gesture)</button
    >
    <button
      class="tt-b"
      disabled={busy || ctxState !== 'running' || !fixtureCount}
      onclick={() => void sweep(quickPlan(loadedFixtures()))}>quick sweep</button
    >
    <button
      class="tt-b"
      disabled={busy || ctxState !== 'running' || !fixtureCount}
      onclick={() => void sweep(fullPlan(loadedFixtures()))}>full sweep</button
    >
    <button
      class="tt-b"
      disabled={!judged.length}
      onclick={() => void navigator.clipboard.writeText(report())}>copy JSON</button
    >
  </div>

  <div class="mt-5 flex flex-wrap gap-6 border-y border-tt-line py-3">
    <span>ctx <strong data-testid="s4b-ctx">{ctxState || contextState()}</strong></span>
    <span>files <strong>{fileCount}</strong></span>
    <span>manifest <strong>{fixtureCount}</strong></span>
    {#if progress}<span class="text-tt-warn">{progress}</span>{/if}
    {#if result}
      <span class:bad={result.outcome !== 'PASS'} data-testid="s4b-outcome">
        verdict <strong>{result.outcome}</strong>
      </span>
    {/if}
  </div>

  {#if result}
    <ul class="mt-4 space-y-1 text-xs">
      {#each result.criteria as c (c.name)}
        <li class:bad={!c.pass}>{c.pass ? '✓' : '✗'} {c.name} — {c.detail}</li>
      {/each}
    </ul>
  {/if}

  {#if judged.length}
    <table class="mt-5 w-full text-xs">
      <thead>
        <tr class="text-left text-tt-muted">
          <th>run</th>
          <th>ok</th>
          <th>overlap err</th>
          <th>end guard</th>
          <th>head loss</th>
          <th>gap</th>
          <th>clicks</th>
        </tr>
      </thead>
      <tbody>
        {#each judged as r, i (i)}
          <tr class:bad={!r.ok}>
            <td>{r.label}</td>
            <td>{r.ok ? '✓' : '✗'}</td>
            <td>{r.metrics.overlapErrMs ?? '–'}</td>
            <td>{r.metrics.endGuardSignalMs ?? r.metrics.endGuardEndedMs ?? '–'}</td>
            <td>{r.metrics.headLossMs ?? '–'}</td>
            <td>{r.metrics.gapMs ?? '–'}</td>
            <td>{r.metrics.clicks.length}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .tt-b {
    border: 1px solid var(--color-tt-line);
    background: var(--color-tt-surface);
    color: var(--color-tt-signal);
    border-radius: 0.25rem;
    padding: 0.3rem 0.9rem;
  }
  .tt-b:disabled {
    opacity: 0.4;
  }
  .bad {
    color: var(--color-tt-danger);
  }
</style>
