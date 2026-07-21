<script lang="ts">
  /**
   * Spike S4 harness — docs/15 §S4, feeding docs/05 §1-2.
   *
   * Three questions:
   *   1. does the A/B equal-power crossfade sound clean at 0/1/2/5 s?
   *   2. does the gate-click `resume()` reliably unlock autoplay, and does
   *      playback never start before that gesture?
   *   3. does the `timeupdate` trigger schedule accurately — including on real
   *      VBR MP3s, where `element.duration` is least trustworthy?
   *
   * Builds the docs/05 §1 graph exactly:
   *   elementA → MediaElementSource → gainA ─┐
   *                                          ├→ masterGain → Analyser → dest
   *   elementB → MediaElementSource → gainB ─┘
   *
   * NOT the audio engine. The scope rule keeps engine code behind this spike;
   * this is the throwaway that decides what the engine should do.
   */

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  const el: HTMLAudioElement[] = [];
  const gain: (GainNode | null)[] = [null, null];
  const srcNode: (MediaElementAudioSourceNode | null)[] = [null, null];

  let files = $state<File[]>([]);
  let fadeS = $state(2);
  let log = $state<string[]>([]);
  let ctxState = $state('none');
  let rms = $state<number[]>([]);
  let measuring = $state(false);
  let overlapMs = $state<number | null>(null);

  const say = (m: string) => (log = [...log, `${new Date().toISOString().slice(11, 23)}  ${m}`]);

  /** docs/05 §1: created at boot, resumed only on a user gesture. */
  function boot() {
    if (ctx) return;
    ctx = new AudioContext();
    master = ctx.createGain();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(analyser).connect(ctx.destination);
    ctxState = ctx.state;
    say(`AudioContext created, state=${ctx.state} (must be "suspended" before any gesture)`);
  }

  /** Stands in for the legal-gate Accept click — the autoplay-unlock gesture. */
  async function unlock() {
    boot();
    await ctx!.resume();
    ctxState = ctx!.state;
    say(`resume() → state=${ctx!.state}`);
  }

  function attach(i: 0 | 1, f: File) {
    el[i] ??= new Audio();
    const a = el[i]!;
    a.src = URL.createObjectURL(f);
    a.preload = 'auto';
    // createMediaElementSource may be called ONCE per element — reuse it and
    // just swap .src, which is what the engine will have to do too.
    if (!srcNode[i]) {
      srcNode[i] = ctx!.createMediaElementSource(a);
      gain[i] = ctx!.createGain();
      gain[i]!.gain.value = 0;
      srcNode[i]!.connect(gain[i]!).connect(master!);
    }
    say(`element ${'AB'[i]} ← ${f.name}`);
  }

  /** docs/05 §2: gainOut = cos(t·π/2), gainIn = sin(t·π/2). */
  function equalPowerCurves(steps = 64): [Float32Array, Float32Array] {
    const out = new Float32Array(steps);
    const inn = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      out[i] = Math.cos((t * Math.PI) / 2);
      inn[i] = Math.sin((t * Math.PI) / 2);
    }
    return [out, inn];
  }

  async function runCrossfade() {
    if (files.length < 2) return say('need two files');
    await unlock();
    attach(0, files[0]!);
    attach(1, files[1]!);

    const now = ctx!.currentTime;
    gain[0]!.gain.setValueAtTime(1, now);
    gain[1]!.gain.setValueAtTime(0, now);
    await el[0]!.play();
    say('A playing');

    // Let A settle, then fade.
    await new Promise((r) => setTimeout(r, 1200));

    const t = ctx!.currentTime;
    const dur = Math.max(0.001, fadeS);
    await el[1]!.play();
    if (fadeS === 0) {
      gain[0]!.gain.setValueAtTime(0, t);
      gain[1]!.gain.setValueAtTime(1, t);
      say('hard cut (fade = 0)');
    } else {
      const [outC, inC] = equalPowerCurves();
      gain[0]!.gain.setValueCurveAtTime(outC, t, dur);
      gain[1]!.gain.setValueCurveAtTime(inC, t, dur);
      say(`equal-power crossfade over ${dur}s scheduled at ctx.currentTime=${t.toFixed(3)}`);
    }
    void measureOverlap(dur);
  }

  /** Samples Analyser RMS to see the actual overlap window, per docs/15 §S4. */
  async function measureOverlap(durS: number) {
    if (!analyser) return;
    measuring = true;
    rms = [];
    const buf = new Uint8Array(analyser.fftSize);
    const started = performance.now();
    const deadline = started + (durS + 1.5) * 1000;
    let firstBoth: number | null = null;
    let lastBoth: number | null = null;

    while (performance.now() < deadline) {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) {
        const d = (v - 128) / 128;
        sum += d * d;
      }
      const r = Math.sqrt(sum / buf.length);
      rms = [...rms.slice(-240), r];
      const bothAudible = (gain[0]?.gain.value ?? 0) > 0.02 && (gain[1]?.gain.value ?? 0) > 0.02;
      if (bothAudible) {
        firstBoth ??= performance.now();
        lastBoth = performance.now();
      }
      await new Promise((r2) => requestAnimationFrame(() => r2(null)));
    }
    overlapMs = firstBoth && lastBoth ? Math.round(lastBoth - firstBoth) : 0;
    measuring = false;
    say(`measured overlap ≈ ${overlapMs} ms (target ${Math.round(durS * 1000)} ms ±150)`);
  }

  function stop() {
    el.forEach((a) => a?.pause());
    say('stopped');
  }

  const peak = $derived(rms.length ? Math.max(...rms) : 0);
</script>

<section class="mx-auto max-w-4xl p-8 font-mono text-sm">
  <h1 class="mb-1 text-xl font-semibold">S4 — crossfade &amp; AudioContext unlock</h1>
  <p class="text-tt-muted mb-6 text-xs">
    docs/15 §S4 → docs/05 §1–2. Pick <strong>two</strong> files; use real VBR MP3s from
    <code>test/test_playlist/</code>, not only the generated tones — <code>element.duration</code>
    is least reliable on exactly those.
  </p>

  <div class="flex flex-wrap items-center gap-4">
    <input
      type="file"
      multiple
      accept="audio/*"
      onchange={(e) => {
        files = Array.from((e.currentTarget as HTMLInputElement).files ?? []);
        boot();
      }}
    />
    <label
      >fade
      <select bind:value={fadeS} class="bg-tt-surface border-tt-line ml-1 border px-2 py-1">
        {#each [0, 1, 2, 5] as s (s)}<option value={s}>{s}s</option>{/each}
      </select>
    </label>
    <button class="tt-b" onclick={unlock}>unlock (gesture)</button>
    <button class="tt-b" onclick={runCrossfade} disabled={files.length < 2}>run crossfade</button>
    <button class="tt-b" onclick={stop}>stop</button>
  </div>

  <div class="border-tt-line mt-5 flex flex-wrap gap-6 border-y py-3">
    <span>ctx <strong>{ctxState}</strong></span>
    <span>gainA <strong>{(gain[0]?.gain.value ?? 0).toFixed(3)}</strong></span>
    <span>gainB <strong>{(gain[1]?.gain.value ?? 0).toFixed(3)}</strong></span>
    <span>peak RMS <strong>{peak.toFixed(3)}</strong></span>
    {#if overlapMs !== null}
      <span class:bad={Math.abs(overlapMs - fadeS * 1000) > 150}>
        overlap <strong>{overlapMs} ms</strong> (target {fadeS * 1000} ±150)
      </span>
    {/if}
    {#if measuring}<span class="text-tt-warn">measuring…</span>{/if}
  </div>

  {#if rms.length}
    <svg viewBox="0 0 240 60" class="mt-4 h-16 w-full" preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke="var(--color-tt-signal)"
        stroke-width="1"
        points={rms.map((v, i) => `${i},${60 - Math.min(1, v * 3) * 60}`).join(' ')}
      />
    </svg>
    <p class="text-tt-muted text-xs">
      Analyser RMS over the fade — a dip in the middle means the curves are not equal-power.
    </p>
  {/if}

  <ul class="text-tt-muted mt-5 space-y-0.5 text-xs">
    {#each log.slice(-14) as line (line)}<li>{line}</li>{/each}
  </ul>
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
