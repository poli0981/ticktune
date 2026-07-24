<script lang="ts">
  import { playback } from '../state/playback.svelte';
  import { settings } from '../state/settings.svelte';
  import {
    TT_BAR_COUNT,
    barHeights,
    beatEnergy,
    nextDegrade,
    wavePoints,
    type TtDegradeState,
  } from '../engine/visuals/tt-visualizer';

  /**
   * Z2 — the visualizer canvas, docs/03 §2 and docs/05 §6.
   *
   * ## It decides nothing
   *
   * Every number drawn here comes from `tt-visualizer.ts`, which is pure and
   * unit-tested. This file owns the canvas, the rAF loop and the device-pixel
   * ratio — the three things that cannot be tested in Node and are therefore
   * kept as thin as they can be (docs/13 §1's driver carve-out reasoning,
   * applied to a component).
   *
   * ## Not rendered at all in YouTube mode
   *
   * `05 §6`: cross-origin media gives no Analyser access. That is a hard
   * platform limit rather than a decision, and the substitute is the generated
   * gradient Z1 already paints — **not** anything derived from the video's
   * thumbnail, which is `03 §5`'s ruling.
   *
   * ## The pulse outlives the picture
   *
   * `beatEnergy` is published on every frame even when the style is `off`, and
   * the shell drives the Z5 tally light from it. That is `05 §6`'s "even
   * Visualizer: off keeps one live beat element", and it is why this component
   * still mounts (invisible) when the canvas would draw nothing.
   */

  interface Props {
    /** False in YouTube mode — no Analyser, so nothing to draw (docs/05 §6). */
    available: boolean;
    /** True while a track is actually playing; a paused frame is silent anyway. */
    playing: boolean;
    /** Low-band energy per frame, 0–1. The tally light's beat (docs/03 §1). */
    onbeat: (energy: number) => void;
  }

  const { available, playing, onbeat }: Props = $props();

  const s = $derived(settings.current);

  let canvas = $state<HTMLCanvasElement | null>(null);

  let reducedMotion = $state(false);
  $effect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => (reducedMotion = mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  });

  /**
   * `03 §8` disables the visualizer under reduced motion outright — it is
   * decoration, and a moving graphic is exactly what the preference is about.
   * The tally pulse goes with it for the same reason.
   */
  const active = $derived(available && playing && !reducedMotion);
  const drawing = $derived(active && s.visualizer !== 'off');

  /**
   * The frame loop.
   *
   * One effect for both jobs — drawing and publishing the beat — because they
   * read the SAME analyser frame. Two loops would sample the analyser twice per
   * frame and could disagree about the beat by one frame, which is visible when
   * the tally and the bars are next to each other.
   */
  $effect(() => {
    if (!active) {
      onbeat(0);
      return;
    }

    const bins = playback.binCount;
    if (bins === 0) return;

    // Allocated once per mount, not per frame. Sixty 1 KB allocations a second
    // is the kind of pressure that later reads as the jank the degrade path is
    // trying to explain.
    const freq = new Uint8Array(new ArrayBuffer(bins));
    const time = new Uint8Array(new ArrayBuffer(bins * 2));

    let raf = 0;
    let degrade: TtDegradeState = { strikes: 0, skip: false };
    /** How long the LAST drawn frame's own work took, in ms. */
    let lastWorkMs = 0;

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const start = performance.now();

      /*
       * docs/05 §6's adaptive degrade, decided by the pure module.
       *
       * Measured on **this component's own work**, not on the gap between
       * frames. The gap is the wrong number: a page running at 30 fps for
       * reasons that have nothing to do with us reports 33 ms every frame, and
       * the visualizer would degrade itself forever in response to someone
       * else's cost. What the budget is about is whether WE are the problem.
       */
      degrade = nextDegrade(lastWorkMs, degrade);
      if (degrade.skip) return;

      playback.readFrequencyData(freq);
      // The beat is published every drawn frame regardless of style, because
      // the tally light is driven by it even when the canvas is off.
      onbeat(beatEnergy(freq, s.visualizerSensitivity));

      const ctx = canvas?.getContext('2d');
      if (!ctx || !canvas || s.visualizer === 'off') {
        lastWorkMs = performance.now() - start;
        return;
      }

      // CSS px × min(dpr, 2) — docs/05 §6. Capped because a 3× phone-class
      // ratio triples the fill cost for a difference nobody can see on a
      // background element.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const accent =
        getComputedStyle(canvas).getPropertyValue('--tt-viz-color').trim() || '#4FD1FF';

      if (s.visualizer === 'bars') drawBars(ctx, w, h, freq, accent);
      else if (s.visualizer === 'wave') drawWave(ctx, w, h, time, accent);
      else drawRing(ctx, w, h, freq, accent);

      lastWorkMs = performance.now() - start;
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      onbeat(0);
    };
  });

  /** docs/05 §6: "64 log-spaced bins, mirrored". */
  function drawBars(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    freq: Uint8Array,
    accent: string,
  ) {
    const bars = barHeights(freq, TT_BAR_COUNT, s.visualizerSensitivity);
    // Mirrored: the low bins meet in the middle and climb outwards, so the
    // busiest part of the spectrum sits under the countdown rather than at one
    // edge of the screen.
    const half = w / 2;
    const bw = half / bars.length;
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.55;
    for (const [i, v] of bars.entries()) {
      const bh = Math.max(1, v * h * 0.4);
      ctx.fillRect(half + i * bw, h - bh, Math.max(1, bw - 1), bh);
      ctx.fillRect(half - (i + 1) * bw, h - bh, Math.max(1, bw - 1), bh);
    }
    ctx.globalAlpha = 1;
  }

  /** docs/05 §6: "time-domain polyline". */
  function drawWave(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    time: Uint8Array<ArrayBuffer>,
    accent: string,
  ) {
    playback.readTimeDomainData(time);
    const pts = wavePoints(time, Math.max(2, Math.floor(w / 4)), s.visualizerSensitivity);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [i, v] of pts.entries()) {
      const x = (i / (pts.length - 1)) * w;
      const y = v * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** docs/05 §6's signature look: "radial bars orbiting the countdown". */
  function drawRing(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    freq: Uint8Array,
    accent: string,
  ) {
    const bars = barHeights(freq, TT_BAR_COUNT, s.visualizerSensitivity);
    const cx = w / 2;
    const cy = h / 2;
    // Sized off the SHORTER axis so the ring stays a circle on any window, and
    // wide enough to orbit the digits rather than cross them.
    const radius = Math.min(w, h) * 0.32;
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(2, (radius * 2 * Math.PI) / bars.length / 2);
    for (const [i, v] of bars.entries()) {
      // Start at 12 o'clock and go clockwise; two passes mirrored around the
      // vertical, so the low end sits at the top on both sides.
      const a = (i / bars.length) * Math.PI - Math.PI / 2;
      const len = radius * 0.35 * v;
      for (const angle of [a, -a - Math.PI]) {
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
        ctx.lineTo(cx + Math.cos(angle) * (radius + len), cy + Math.sin(angle) * (radius + len));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
</script>

{#if drawing}
  <!--
    docs/03 §2 Z2 — above Z1, below the countdown. `aria-hidden` because it is
    decoration; docs/03 §8's countdown milestones are a separate polite region.
  -->
  <canvas
    bind:this={canvas}
    class="tt-viz"
    aria-hidden="true"
    data-testid="tt-visualizer"
    data-tt-style={s.visualizer}
  ></canvas>
{/if}

<style>
  .tt-viz {
    position: fixed;
    inset: 0 var(--tt-yt-reserve, 0px) 0 0;
    z-index: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    /* Named so the ring and bars pick up an auto-theme tint for free; the
       countdown's own colour is never touched (docs/03 §5). */
    --tt-viz-color: var(--color-tt-signal);
  }
</style>
