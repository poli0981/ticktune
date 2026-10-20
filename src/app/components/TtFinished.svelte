<script lang="ts">
  import { i18n } from '../state/i18n.svelte';
  import { splitDuration } from '../engine/timer/tt-late';
  import type { TtFinishReport } from '../engine/timer/types';

  /**
   * docs/03 §3.5 — the Finished screen, and the late variant the S2 decision
   * owes the user (docs/04 §2 option 3).
   *
   * A backgrounded tab can be throttled for minutes. The elapsed time stays
   * exact — time is derived, never accumulated — but the app cannot react until
   * the user returns. A screen that just said "HẾT GIỜ" would be quietly lying
   * about *when*, so past the threshold it states the clock time zero was
   * actually reached and how long ago that was.
   *
   * Every string is a `finished.*` key (docs/08 §3) — the P2 Vietnamese
   * literals moved into the dictionaries in P5.
   */

  interface Props {
    report: TtFinishReport;
    onrestart: () => void;
    onback: () => void;
    /** Injected in tests so the relative phrase is deterministic. */
    now?: () => number;
  }

  const { report, onrestart, onback, now = () => Date.now() }: Props = $props();

  // Recomputed at 1 Hz so "2 phút 57 giây trước" does not rot while the user
  // reads it — DERIVED from zeroAtEpoch each time, never incremented (docs/04
  // §1). Only runs on the late variant, where the phrase exists at all.
  //
  // Until the first sample lands, the instant is RECONSTRUCTED rather than read
  // from the clock: `zeroAtEpoch + overshootMs` is by definition the moment the
  // done handler ran, so the first paint matches what the engine measured, with
  // no second clock read to disagree with it.
  let sampledNowMs = $state(0);
  const nowMs = $derived(sampledNowMs || report.zeroAtEpoch + report.overshootMs);

  $effect(() => {
    if (report.variant !== 'late') return;
    const id = setInterval(() => (sampledNowMs = now()), 1_000);
    return () => clearInterval(id);
  });

  const zeroAt = $derived(new Date(report.zeroAtEpoch));
  const clockText = $derived(
    new Intl.DateTimeFormat(i18n.locale, { hour: '2-digit', minute: '2-digit' }).format(zeroAt),
  );

  // Elapsed since zero, floored at the overshoot we already know about: on the
  // first frame `nowMs` may be a hair behind the handler's own reading.
  const agoMs = $derived(Math.max(report.overshootMs, nowMs - report.zeroAtEpoch));
  const ago = $derived(splitDuration(agoMs));

  const agoText = $derived(
    [
      ago.h > 0 ? i18n.t('finished.unit.hours', { count: ago.h }) : '',
      ago.m > 0 ? i18n.t('finished.unit.minutes', { count: ago.m }) : '',
      // Seconds are dropped once we are past an hour — "1 giờ 4 phút 12 giây
      // trước" is false precision on a number this soft.
      ago.h === 0 ? i18n.t('finished.unit.seconds', { count: ago.s }) : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
</script>

<section class="tt-finished" data-testid="tt-finished" data-variant={report.variant}>
  <!-- The stamp: framed, lit, and the only thing on the stage at zero. -->
  <h1 class="tt-title">{i18n.t('finished.title')}</h1>

  {#if report.variant === 'late'}
    <!-- docs/03 §3.5: state WHEN, rather than implying now. -->
    <p class="tt-late" data-testid="tt-finished-late">
      {i18n.t('finished.late.at', { time: clockText })} — {i18n.t('finished.late.ago', {
        duration: agoText,
      })}
    </p>
    <p class="tt-why">{i18n.t('finished.late.why')}</p>
  {/if}

  <div class="tt-actions">
    <button class="tt-key tt-key-primary" data-testid="tt-finished-restart" onclick={onrestart}
      >{i18n.t('finished.action.restart')}</button
    >
    <button class="tt-key" data-testid="tt-finished-back" onclick={onback}
      >{i18n.t('finished.action.back')}</button
    >
  </div>
</section>

<style>
  .tt-finished {
    display: grid;
    justify-items: center;
    gap: var(--tt-space-4);
    text-align: center;
  }

  /* docs/03 §3.5: DSEG14-style caps rendered in the display font with glow —
     DSEG7 covers digits and separators only, so the wordmark cannot use it. */
  .tt-title {
    margin: 0;
    padding: var(--tt-space-2) var(--tt-space-6);
    font-family: var(--font-display);
    font-size: clamp(2.75rem, 8vw, 6rem);
    font-weight: 600;
    line-height: 1.1;
    letter-spacing: 0.14em;
    color: var(--color-tt-danger);
    text-transform: uppercase;
    text-shadow:
      0 0 14px color-mix(in srgb, currentColor 55%, transparent),
      0 0 44px color-mix(in srgb, currentColor 30%, transparent);
    border: 2px solid color-mix(in srgb, var(--color-tt-danger) 70%, transparent);
    border-radius: var(--tt-radius-sm);
    box-shadow:
      0 0 24px color-mix(in srgb, var(--color-tt-danger) 22%, transparent),
      inset 0 0 24px color-mix(in srgb, var(--color-tt-danger) 14%, transparent);
    animation: tt-stamp var(--duration-tt-slow) var(--ease-tt);
  }
  /* Scale only — a fade would leave the heading at partial opacity, which
     axe measures as a contrast failure if it scans during the 400 ms. */
  @keyframes tt-stamp {
    from {
      transform: scale(1.06);
    }
  }

  .tt-late {
    margin: 0;
    font-size: var(--tt-text-lg);
    color: var(--color-tt-warn);
    /* The clock time and the duration change width digit by digit otherwise. */
    font-variant-numeric: tabular-nums;
  }

  .tt-why {
    max-width: 34rem;
    margin: 0;
    font-size: var(--tt-text-sm);
    line-height: 1.55;
    color: var(--color-tt-muted);
  }

  .tt-actions {
    display: flex;
    gap: var(--tt-space-3);
    margin-top: var(--tt-space-2);
  }
  @media (prefers-reduced-motion: reduce) {
    .tt-title {
      animation: none;
    }
  }
</style>
