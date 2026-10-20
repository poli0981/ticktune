<script lang="ts">
  import { ttPalette } from '../../lib/tt-palette';
  import { backdrop } from '../state/backdrop.svelte';
  import { settings } from '../state/settings.svelte';
  import { gradientCss } from '../engine/visuals/tt-gradient';
  import {
    TT_SCRIM_MAX,
    meanLuminance,
    parseHex,
    relativeLuminance,
    scrimFor,
    scrimForLight,
  } from '../engine/visuals/tt-contrast';

  /**
   * Z1 — the background stack, docs/03 §2:
   *
   *     solid / gradient  →  image | slideshow (Ken Burns)
   *     →  cover-art blur + dark scrim (adaptive 35–60%)
   *
   * (The visualizer canvas is the layer above this one and ships in slice 4.)
   *
   * ## Every layer is always present; only its opacity moves
   *
   * The stack is composited rather than switched, which is what makes the
   * 400 ms crossfade between slideshow images possible without two components
   * fighting over one slot — and what makes `background: 'slideshow'` degrade
   * honestly when the pictures are gone after a reload (hard invariant 1 keeps
   * them in RAM only): the gradient underneath is already painted, so nothing
   * flashes and nothing is blank.
   *
   * ## `aria-hidden` throughout
   *
   * Decoration. `03 §8` puts the countdown's own announcements on a separate
   * polite region; a background that announced itself would be noise.
   */

  interface Props {
    /** The playing track's cover art, when there is one (docs/05 §5). */
    coverArtUrl?: string | null;
    /** docs/03 §4 — Focus "dims Z1 further", and Z1 is this component. */
    focusMode?: boolean;
  }

  const { coverArtUrl = null, focusMode = false }: Props = $props();

  const s = $derived(settings.current);

  /*
   * `prefers-reduced-motion` is read here rather than left to a media query,
   * because two of the three things it governs are TIMERS rather than CSS:
   * the slideshow's own rotation and the Ken Burns pan. docs/02 §3.1 is
   * explicit that it "does not rewrite these values" — the stored preference
   * survives, so turning the OS setting off restores the user's choice.
   */
  let reducedMotion = $state(false);
  $effect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => (reducedMotion = mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  });

  const images = $derived(backdrop.images);
  const wantsSlideshow = $derived(s.background === 'slideshow' && images.length > 1);
  const wantsImage = $derived(
    (s.background === 'image' || s.background === 'slideshow') && images.length > 0,
  );
  const wantsCover = $derived(s.background === 'cover' && !!coverArtUrl);

  /**
   * The slideshow's clock.
   *
   * Stopped entirely under reduced motion — a crossfade every ten seconds is
   * exactly the "Ken Burns" class of movement `03 §8` suppresses, and freezing
   * on the first picture is the honest reduced form of a slideshow.
   */
  $effect(() => {
    if (!wantsSlideshow || reducedMotion) return;
    const id = setInterval(() => backdrop.advance(), s.slideshowIntervalMs);
    return () => clearInterval(id);
  });

  /** docs/03 §5 — re-read the hue whenever the artwork changes. */
  $effect(() => {
    if (!s.autoTheme) {
      void backdrop.readHue(null);
      return;
    }
    void backdrop.readHue(coverArtUrl);
  });

  const hue = $derived(s.autoTheme ? backdrop.hue : null);

  /**
   * docs/03 §5 tints "the gradient background and digit glow (never the digit
   * core color; legibility first)".
   *
   * Implemented as a hue-rotate over the base layer rather than by rebuilding
   * the stops: the presets were chosen dark on purpose (`tt-gradient.ts`), and
   * rotating hue leaves luminance where it is, so the contrast guarantee the
   * preset was picked for survives the tint. Replacing the colours outright
   * would not.
   */
  const baseFilter = $derived(hue === null ? 'none' : `hue-rotate(${Math.round(hue)}deg)`);

  const baseStyle = $derived(
    s.background === 'solid'
      ? `background: var(--color-tt-void)`
      : `background-image: ${gradientCss(s.gradientPreset, s.gradientCustom, s.theme)}`,
  );

  /**
   * The adaptive scrim — docs/03 §2, "auto-raises if contrast sampling under
   * digits < 4.5:1".
   *
   * Sampled from the picture actually on screen. With no picture the base layer
   * is a known colour and the arithmetic needs no canvas at all, which is the
   * common case and stays synchronous.
   */
  let sampledLuminance = $state<number | null>(null);

  // The digits are what the scrim protects (`--color-tt-digit`), read from the
  // one palette module rather than a hex copy that could drift from the CSS —
  // and per theme since v2.0: lit warm white on dark, dark LCD segments on light.
  const palette = $derived(ttPalette(s.theme));
  const textLuminance = $derived.by(() => {
    const rgb = parseHex(palette.digit);
    return rgb ? relativeLuminance(...rgb) : 1;
  });

  const baseLuminance = $derived.by(() => {
    if (s.background === 'solid') {
      const rgb = parseHex(palette.void);
      return rgb ? relativeLuminance(...rgb) : 0;
    }
    // The stop the digits have to survive: the brighter one under light digits,
    // the darker one under dark digits.
    const css = gradientCss(s.gradientPreset, s.gradientCustom, s.theme);
    const lums = [...css.matchAll(/#[0-9a-fA-F]{6}/g)]
      .map((m) => parseHex(m[0]))
      .map((rgb) => (rgb ? relativeLuminance(...rgb) : 0));
    return s.theme === 'light' ? Math.min(...lums, 1) : Math.max(...lums, 0);
  });

  /*
   * Black over the picture for lit digits, white under dark ones (v2.0). The
   * light solver works in sRGB, because a white scrim composited on gamma
   * values lifts less than linear arithmetic promises (`tt-contrast.ts`).
   */
  const scrim = $derived(
    (s.theme === 'light' ? scrimForLight : scrimFor)(
      sampledLuminance ?? baseLuminance,
      textLuminance,
      s.scrimAuto ? s.scrimStrength : Math.min(TT_SCRIM_MAX, s.scrimStrength),
    ),
  );

  /*
   * `scrimAuto` off means the user's number is the answer, full stop. The
   * sampler still runs — it costs one 8x8 draw per picture change — but its
   * result is discarded, so switching auto back on is instant rather than
   * waiting for the next image.
   */
  const effectiveScrim = $derived(s.scrimAuto ? scrim : s.scrimStrength);

  /** Sample the visible picture, 8×8, once per picture. */
  $effect(() => {
    const url = wantsCover ? coverArtUrl : wantsImage ? (backdrop.current?.url ?? null) : null;
    if (!url) {
      sampledLuminance = null;
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob(), {
          resizeWidth: 8,
          resizeHeight: 8,
          resizeQuality: 'pixelated',
        });
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        if (!cancelled) sampledLuminance = meanLuminance(ctx.getImageData(0, 0, 8, 8).data);
      } catch {
        // An unreadable picture must not take the scrim with it: falling back
        // to the base layer's known luminance keeps the digits legible.
        if (!cancelled) sampledLuminance = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<div class="tt-z1" aria-hidden="true" data-testid="tt-backdrop" data-tt-background={s.background}>
  <!-- Solid or gradient. Always painted: every layer above composites onto it. -->
  <div
    class="tt-base"
    style="{baseStyle}; filter: {baseFilter}"
    data-testid="tt-backdrop-base"
  ></div>

  {#if wantsImage}
    <!--
      One element per picture, opacity-crossfaded. `{#each}` keyed by id so
      Svelte keeps the outgoing image mounted through the 400 ms docs/03 §2
      asks for, instead of swapping the `src` and cutting.
    -->
    {#each images as image, i (image.id)}
      <div
        class="tt-photo"
        class:tt-on={s.background === 'image' ? i === 0 : i === backdrop.index}
        class:tt-kenburns={s.slideshowTransition === 'kenburns' &&
          s.background === 'slideshow' &&
          !reducedMotion}
        style="background-image: url({image.url})"
        data-testid="tt-backdrop-photo"
      ></div>
    {/each}
  {/if}

  {#if wantsCover}
    <!-- docs/03 §2's "cover-art blur". Local artwork only — see the store. -->
    <div
      class="tt-cover"
      style="background-image: url({coverArtUrl})"
      data-testid="tt-backdrop-cover"
    ></div>
  {/if}

  <!-- The scrim. docs/03 §2 puts it directly under the digits' legibility. -->
  <div
    class="tt-scrim"
    style="opacity: {effectiveScrim}"
    data-testid="tt-backdrop-scrim"
    data-tt-scrim={effectiveScrim.toFixed(3)}
  ></div>

  {#if focusMode}
    <!--
      docs/03 §4's "dims Z1 further". A layer of its own rather than a bigger
      scrim, because the scrim is a solved contrast number (`tt-contrast.ts`)
      and folding a taste decision into it would make that arithmetic
      unverifiable. It also has to live here: since slice 3 `.tt-main` paints
      ABOVE Z1, so a background colour there would hide the backdrop instead of
      dimming it.
    -->
    <div class="tt-focus-dim" data-testid="tt-backdrop-focus-dim"></div>
  {/if}

  {#if s.scanlines && !reducedMotion}
    <!-- docs/03 §1: 3% opacity, disabled by reduced motion and by Settings. -->
    <div class="tt-scanlines" data-testid="tt-backdrop-scanlines"></div>
  {/if}
</div>

<style>
  .tt-z1 {
    position: fixed;
    inset: 0;
    z-index: var(--tt-z-backdrop);
    overflow: hidden;
    pointer-events: none;
  }
  .tt-z1 > * {
    position: absolute;
    inset: 0;
  }

  .tt-base {
    /* Filter transitions so an auto-theme hue change on track advance is a
       drift rather than a jump (docs/03 §8's 400 ms token). */
    transition: filter var(--duration-tt-slow) var(--ease-tt);
  }

  .tt-photo {
    background-size: cover;
    background-position: center;
    opacity: 0;
    /* docs/03 §2: "Crossfades 400 ms between slideshow images". */
    transition: opacity var(--duration-tt-slow) var(--ease-tt);
  }
  .tt-on {
    opacity: 1;
  }

  /* Ken Burns. Slow enough to read as drift rather than movement, and removed
     entirely under reduced motion by the markup rather than by opacity. */
  .tt-kenburns.tt-on {
    animation: tt-kenburns 24s ease-in-out infinite alternate;
  }
  @keyframes tt-kenburns {
    from {
      transform: scale(1.04) translate3d(-1%, -1%, 0);
    }
    to {
      transform: scale(1.12) translate3d(1%, 1%, 0);
    }
  }

  .tt-cover {
    background-size: cover;
    background-position: center;
    /* Blurred hard: this is ambience, and a legible photograph behind a
       countdown competes with it. `scale` hides the blur's soft edges. */
    filter: blur(48px) saturate(1.3);
    transform: scale(1.15);
  }

  .tt-scrim {
    background: #000;
    transition: opacity var(--duration-tt-slow) var(--ease-tt);
  }

  .tt-focus-dim {
    background: #000;
    opacity: 0.4;
    transition: opacity var(--duration-tt-slow) var(--ease-tt);
  }

  /* Light (v2.0): the scrim and Focus's dim wash toward the paper instead. */
  :global(html[data-tt-theme='light']) .tt-scrim,
  :global(html[data-tt-theme='light']) .tt-focus-dim {
    background: #fff;
  }

  /* Warm-white lines, matching the digits rather than a cold CRT blue. */
  .tt-scanlines {
    background: repeating-linear-gradient(
      to bottom,
      rgb(255 244 222 / 3%) 0px,
      rgb(255 244 222 / 3%) 1px,
      transparent 1px,
      transparent 3px
    );
  }
  /* On the light panel the rows are an LCD's, so they darken rather than glow. */
  :global(html[data-tt-theme='light']) .tt-scanlines {
    background: repeating-linear-gradient(
      to bottom,
      rgb(29 31 26 / 4%) 0px,
      rgb(29 31 26 / 4%) 1px,
      transparent 1px,
      transparent 3px
    );
  }

  /*
   * The CSS half of reduced motion, alongside the markup half. Both exist: the
   * markup removes the timers and the animated elements, and this catches a
   * transition on an element that stays mounted (docs/03 §8).
   */
  @media (prefers-reduced-motion: reduce) {
    .tt-base,
    .tt-photo,
    .tt-scrim {
      transition: none;
    }
    .tt-kenburns.tt-on {
      animation: none;
    }
  }
</style>
