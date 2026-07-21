<script lang="ts">
  import { formatRemaining } from '../engine/timer/tt-format';

  interface Props {
    remainingMs: number;
    /** docs/02 §3.1 — scales the three glow alphas. */
    glowIntensity?: number;
  }

  const { remainingMs, glowIntensity = 0.8 }: Props = $props();

  const f = $derived(formatRemaining(remainingMs));
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
  aria-hidden="true"
>
  <span class="tt-ghost" aria-hidden="true">{f.ghost}</span>
  <span class="tt-live">{f.text}</span>
</div>

<style>
  .tt-countdown {
    font-size: clamp(96px, 18vw, 280px);
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
