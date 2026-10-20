<script lang="ts">
  /**
   * Spike S6 harness — docs/15 §S6: is a reduced-rate decode an accurate,
   * affordable loudness meter for opt-in normalisation?
   *
   * Each file is decoded by `OfflineAudioContext(…, rate).decodeAudioData`,
   * which resamples to the context's rate, then measured by the pure
   * BS.1770-4 meter in tt-s6-loudness.ts. The page reports loudness, sample
   * peak and the time each step took; `pnpm s6` drives `window.__ttS6` and
   * samples the browser's memory from outside, which a page cannot see.
   */
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { integratedLoudness } from './tt-s6-loudness';

  interface Result {
    name: string;
    rate: number;
    lufs: number | null;
    peakDb: number | null;
    decodeMs: number;
    computeMs: number;
    channels: number;
    durationS: number;
    startedAt: number;
    endedAt: number;
    error?: string;
  }

  const files = new SvelteMap<string, File>();
  let fileCount = $state(0);
  let results = $state<Result[]>([]);

  async function analyze(name: string, rate: number): Promise<Result> {
    const file = files.get(name);
    const startedAt = Date.now();
    if (!file)
      return {
        name,
        rate,
        lufs: null,
        peakDb: null,
        decodeMs: 0,
        computeMs: 0,
        channels: 0,
        durationS: 0,
        startedAt,
        endedAt: startedAt,
        error: 'not loaded',
      };
    try {
      const t0 = performance.now();
      const bytes = await file.arrayBuffer();
      const ctx = new OfflineAudioContext(2, 1, rate);
      const audio = await ctx.decodeAudioData(bytes);
      const t1 = performance.now();
      const channels = Array.from({ length: audio.numberOfChannels }, (_, i) =>
        audio.getChannelData(i),
      );
      const m = integratedLoudness(channels, audio.sampleRate);
      const t2 = performance.now();
      const r: Result = {
        name,
        rate: audio.sampleRate,
        lufs: Number.isFinite(m.lufs) ? Math.round(m.lufs * 100) / 100 : null,
        peakDb: Number.isFinite(m.peakDb) ? Math.round(m.peakDb * 100) / 100 : null,
        decodeMs: Math.round(t1 - t0),
        computeMs: Math.round(t2 - t1),
        channels: audio.numberOfChannels,
        durationS: Math.round(audio.duration * 100) / 100,
        startedAt,
        endedAt: Date.now(),
      };
      results = [...results, r];
      return r;
    } catch (e) {
      const r: Result = {
        name,
        rate,
        lufs: null,
        peakDb: null,
        decodeMs: 0,
        computeMs: 0,
        channels: 0,
        durationS: 0,
        startedAt,
        endedAt: Date.now(),
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      };
      results = [...results, r];
      return r;
    }
  }

  onMount(() => {
    (window as unknown as { __ttS6: unknown }).__ttS6 = { analyze, count: () => files.size };
  });
</script>

<section class="mx-auto max-w-5xl p-8 font-mono text-sm">
  <h1 class="mb-1 text-xl font-semibold">S6 — loudness from a reduced-rate decode</h1>
  <p class="mb-6 text-xs text-tt-muted">
    docs/15 §S6. Load files from <code>test/generated/s6/</code> (and the corpus); each is analysed at
    16, 24 and 48 kHz.
  </p>
  <div class="flex flex-wrap items-center gap-4">
    <input
      type="file"
      multiple
      accept="audio/*"
      data-testid="s6-files"
      onchange={(e) => {
        for (const f of (e.currentTarget as HTMLInputElement).files ?? []) files.set(f.name, f);
        fileCount = files.size;
      }}
    />
    <button
      class="tt-b"
      disabled={!fileCount}
      onclick={async () => {
        for (const name of files.keys())
          for (const rate of [16_000, 24_000, 48_000]) await analyze(name, rate);
      }}>analyse all</button
    >
    <button
      class="tt-b"
      disabled={!results.length}
      onclick={() =>
        void navigator.clipboard.writeText(
          JSON.stringify({ ua: navigator.userAgent, results }, null, 2),
        )}>copy JSON</button
    >
    <span>files <strong>{fileCount}</strong></span>
  </div>
  <table class="mt-6 w-full text-xs">
    <thead>
      <tr class="text-left text-tt-muted">
        <th>file</th><th>rate</th><th>LUFS</th><th>peak dBFS</th><th>decode ms</th><th
          >compute ms</th
        ><th>error</th>
      </tr>
    </thead>
    <tbody>
      {#each results as r, i (i)}
        <tr>
          <td>{r.name}</td><td>{r.rate}</td><td>{r.lufs ?? '–'}</td><td>{r.peakDb ?? '–'}</td>
          <td>{r.decodeMs}</td><td>{r.computeMs}</td><td>{r.error ?? ''}</td>
        </tr>
      {/each}
    </tbody>
  </table>
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
</style>
