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
  class="tt-countdown relative font-digit tabular-nums select-none"
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
     * ~20% (docs/03 §4), times the shell's `--tt-stage-scale` (0.66 while the
     * countdown is only Setup's preview). Unchanged in spirit from P2's
     * `clamp(96px, 18vw, 280px)`.
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
        calc(var(--tt-size-vw, 18) * 1vw * var(--tt-focus-scale, 1) * var(--tt-stage-scale, 1)),
        calc(280px * var(--tt-focus-scale, 1) * var(--tt-stage-scale, 1))
      ),
      calc(22.2 * 1cqw)
    );
    line-height: 1;
    /* The lit segments — warm white, the "Rack Unit" display (docs/03 §1). */
    color: var(--color-tt-digit);
  }

  /*
   * The display window — smoked glass behind the segments (docs/03 §1).
   *
   * ⚠️ Geometry-bearing, like the cap above. It is a pseudo-element so it adds
   * NOTHING to the box the 22.2cqw cap measures; it only paints past it, by
   * 0.08em a side. At the largest size that can exist — 280 px × Focus's 1.2 =
   * 336 px — that is 26.9 px, inside both the stage's 2.5rem (40 px) gap to the
   * rail and `.tt-main`'s 2rem (32 px) padding. So the glass can never reach the
   * YouTube player rect (docs/03 §2). Grow the bleed or shrink either gap and
   * that sum has to be redone.
   *
   * Painted first and unpositioned in z, so the ghost and the live digits —
   * both positioned, later in the tree — always draw over it.
   *
   * axe reports the digits as "needs review" because of this pseudo-element.
   * They were unmeasurable in v1.0 as well — they sit on Z1, the user's own
   * picture or gradient — and their contrast is guaranteed by arithmetic
   * instead: `scrimFor()` solves the scrim for 4.5:1 (docs/02 §3.1), and
   * tests/unit/tt-visuals.test.ts holds every preset to it. This is the one
   * surface in the app where that trade is made.
   *
   * Vertically it frames the GLYPHS, not the line box: DSEG7's ascent and
   * descent overflow `line-height: 1`, so the digits are drawn from 0.15em
   * above the box to 0.15em short of its bottom (measured on the rendered
   * page). Hence the uneven top and bottom insets — 0.06em of glass each way.
   */
  .tt-countdown::before {
    position: absolute;
    inset: -0.21em -0.08em 0.09em;
    content: '';
    background:
      linear-gradient(180deg, rgb(255 255 255 / 4%), transparent 38%),
      color-mix(in srgb, var(--color-tt-void) 72%, transparent);
    border: 1px solid rgb(255 255 255 / 6%);
    border-radius: 0.05em;
    box-shadow:
      inset 0 0.02em 0.06em rgb(0 0 0 / 60%),
      0 0.04em 0.12em rgb(0 0 0 / 35%);
    pointer-events: none;
  }
  .tt-danger::before {
    border-color: color-mix(in srgb, var(--color-tt-danger) 28%, transparent);
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
