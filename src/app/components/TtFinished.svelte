<script lang="ts">
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
   * Strings are hardcoded Vietnamese for P2; the keys are filed in docs/08 §3.1
   * for the P5 dictionary work, exactly as docs/04 §2 item 5 authorises.
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
    new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(zeroAt),
  );

  // Elapsed since zero, floored at the overshoot we already know about: on the
  // first frame `nowMs` may be a hair behind the handler's own reading.
  const agoMs = $derived(Math.max(report.overshootMs, nowMs - report.zeroAtEpoch));
  const ago = $derived(splitDuration(agoMs));

  const agoText = $derived(
    [
      ago.h > 0 ? `${ago.h} giờ` : '',
      ago.m > 0 ? `${ago.m} phút` : '',
      // Seconds are dropped once we are past an hour — "1 giờ 4 phút 12 giây
      // trước" is false precision on a number this soft.
      ago.h === 0 ? `${ago.s} giây` : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
</script>

<section class="tt-finished" data-testid="tt-finished" data-variant={report.variant}>
  <h1 class="tt-title">HẾT GIỜ</h1>

  {#if report.variant === 'late'}
    <!-- docs/03 §3.5: state WHEN, rather than implying now. -->
    <p class="tt-late" data-testid="tt-finished-late">
      lúc <strong>{clockText}</strong> — {agoText} trước
    </p>
    <p class="tt-why">
      Thẻ chạy nền bị trình duyệt tạm dừng, nên ứng dụng chỉ phản hồi được khi bạn quay lại. Thời
      gian đã đếm vẫn chính xác.
    </p>
  {/if}

  <div class="tt-actions">
    <button class="tt-btn" data-testid="tt-finished-restart" onclick={onrestart}>Chạy lại</button>
    <button class="tt-btn" data-testid="tt-finished-back" onclick={onback}>Về thiết lập</button>
  </div>
</section>

<style>
  .tt-finished {
    display: grid;
    justify-items: center;
    gap: 0.75rem;
    text-align: center;
  }

  /* docs/03 §3.5: DSEG14-style caps rendered in the UI font with glow — DSEG7
     covers digits and separators only, so the wordmark cannot use it. */
  .tt-title {
    font-size: clamp(2.5rem, 7vw, 5rem);
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--color-tt-danger);
    text-shadow:
      0 0 12px color-mix(in srgb, currentColor 55%, transparent),
      0 0 40px color-mix(in srgb, currentColor 30%, transparent);
  }

  .tt-late {
    font-size: 1.05rem;
    color: var(--color-tt-warn);
  }
  .tt-late strong {
    font-variant-numeric: tabular-nums;
  }

  .tt-why {
    max-width: 34rem;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--color-tt-muted);
  }

  .tt-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }

  .tt-btn {
    border: 1px solid var(--color-tt-line);
    background: var(--color-tt-surface);
    color: var(--color-tt-signal);
    border-radius: 0.375rem;
    padding: 0.5rem 1.25rem;
    font-weight: 500;
    transition: border-color var(--duration-tt-fast) var(--ease-tt);
  }
  .tt-btn:hover {
    border-color: var(--color-tt-signal);
  }
</style>
