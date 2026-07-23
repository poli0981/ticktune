<script lang="ts">
  import { formatRemaining } from '../engine/timer/tt-format';

  import type { TtSize } from '../state/tt-settings-schema';

  interface Props {
    remainingMs: number;
    /** docs/02 §3.1 — scales the three glow alphas. */
    glowIntensity?: number;
    /** docs/02 §3.1 — s/m/l map to 14vw / 18vw / 22vw. */
    size?: TtSize;
    /** docs/03 §4 — Focus grows the digits ~20%, subject to the §4 cap. */
    focusMode?: boolean;
  }

  const { remainingMs, glowIntensity = 0.8, size = 'm', focusMode = false }: Props = $props();

  const f = $derived(formatRemaining(remainingMs));

  /** docs/02 §3.1's mapping, and the only place it exists in code. */
  const SIZE_VW: Record<TtSize, number> = { s: 14, m: 18, l: 22 };
</script>

<!--
  docs/03 §1-2 Z3.

  Two layers, same string width: the 6%-opacity all-lit ghost sits behind the
  live digits. Its content is DERIVED from the active format (tt-format.ts), not
  hardcoded — the three formats are 7/5/6 glyphs wide, so a fixed "888:88:88"
  would be the wrong width in two regimes and would cause the very layout shift
  the ghost exists to prevent.

  aria-live is deliberately absent: announcing every tick is screen-reader spam
  (docs/03 §8). Milestone announcements at 10/5/1 min, 10 s and zero come from a
  separate polite region owned by the player, not from here.
-->
<div
  class="tt-countdown font-digit relative tabular-nums select-none"
  class:tt-danger={f.danger}
  style:--tt-glow={glowIntensity}
  style:--tt-size-vw={SIZE_VW[size]}
  style:--tt-focus-scale={focusMode ? 1.2 : 1}
  data-tt-size={size}
  aria-hidden="true"
>
  <span class="tt-ghost" aria-hidden="true">{f.ghost}</span>
  <span class="tt-live">{f.text}</span>
</div>

<style>
  .tt-countdown {
    /*
     * Two rules stacked, and the OUTER one is a ToS floor — docs/03 §4.
     *
     * Inner `clamp`: docs/02 §3.1's s/m/l → 14vw / 18vw / 22vw, times Focus's
     * ~20% (docs/03 §4). Unchanged in spirit from P2's `clamp(96px, 18vw, 280px)`.
     *
     * Outer `min`: the digits may never grow past the column they are in.
     * `.tt-clock` is a size container whose width EXCLUDES the right rail, so
     * `cqw` is "percent of the space the rail does not need" — which is what
     * makes docs/06 §1.2's 384 px player structurally safe rather than a thing
     * to remember. It sits OUTSIDE the clamp deliberately: `clamp`'s 96 px floor
     * would otherwise beat the cap on a window snapped narrow (docs/07 §2 keeps
     * such a session alive on purpose) and push the player off screen again.
     *
     * 22.2 = 100 ÷ 4.49. Measured 2026-07-23 on Chromium with DSEG7 Classic
     * v0.46: the widest of docs/04 §4's three regimes, `8:88:88`, renders at
     * 4.48–4.49 × font-size (`88.888` is 4.08, `88:88` is 3.46). The WIDEST is
     * the right constant even though it is only on screen above one hour —
     * sizing per regime would resize the digits at the 1 h and 60 s boundaries,
     * which is the jitter the ghost layer exists to prevent.
     */
    font-size: min(
      clamp(
        96px,
        calc(var(--tt-size-vw, 18) * 1vw * var(--tt-focus-scale, 1)),
        calc(280px * var(--tt-focus-scale, 1))
      ),
      calc(22.2 * 1cqw)
    );
    line-height: 1;
    color: var(--color-tt-text);
  }

  .tt-ghost {
    position: absolute;
    inset: 0;
    opacity: 0.06;
    pointer-events: none;
  }

  .tt-live {
    position: relative;
    /* The signature: three stacked shadows at decreasing alpha, scaled by the
       user's glow setting (docs/03 §1). currentColor so the danger regime
       recolours the glow along with the digits, for free. */
    text-shadow:
      0 0 8px color-mix(in srgb, currentColor calc(var(--tt-glow) * 70%), transparent),
      0 0 24px color-mix(in srgb, currentColor calc(var(--tt-glow) * 45%), transparent),
      0 0 64px color-mix(in srgb, currentColor calc(var(--tt-glow) * 25%), transparent);
  }

  /* docs/03 §2 / docs/04 §4: below 60 s the digits go red. */
  .tt-danger {
    color: var(--color-tt-danger);
  }

  /* Digits never animate per tick — LED authenticity (docs/03 §8). Nothing to
     disable for reduced motion here; the glow is static. */
</style>
