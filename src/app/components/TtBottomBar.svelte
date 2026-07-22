<script lang="ts">
  import { positionText, text } from '../engine/importer/tt-track-display';
  import type { TtTrack } from '../engine/importer/types';

  /**
   * docs/03 §2 Z7 — the bottom bar.
   *
   * Auto-hides after 4 s idle and returns on any pointer or key. ⏮/⏭ are
   * disabled in Single mode: there is nowhere to go, and a control that looks
   * live and does nothing is worse than one that says so.
   *
   * Position is `M:SS` — a media position, NOT a countdown format. docs/04 §4
   * owns those and nothing here restates them.
   */

  interface Props {
    track: TtTrack | null;
    positionMs: number;
    durationMs: number | null;
    playing: boolean;
    volume: number;
    muted: boolean;
    onplaypause: () => void;
    onstop: () => void;
    onvolume: (v: number) => void;
    onmute: () => void;
    onprev: () => void;
    onnext: () => void;
    /** False in Single mode, and at the ends of the order (docs/02 §5.1). */
    canPrev: boolean;
    canNext: boolean;
    /** Bumped by the parent on any pointer/key, to un-hide. */
    wakeToken: number;
  }

  const {
    track,
    positionMs,
    durationMs,
    playing,
    volume,
    muted,
    onplaypause,
    onstop,
    onvolume,
    onmute,
    onprev,
    onnext,
    canPrev,
    canNext,
    wakeToken,
  }: Props = $props();

  const IDLE_MS = 4_000;
  let visible = $state(true);

  $effect(() => {
    // Re-runs whenever the parent bumps the token, restarting the idle timer.
    void wakeToken;
    visible = true;
    const id = setTimeout(() => (visible = false), IDLE_MS);
    return () => clearTimeout(id);
  });

  const progress = $derived(
    durationMs && durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0,
  );
</script>

<footer class="tt-bar" class:hidden={!visible} data-testid="tt-bottom-bar" data-visible={visible}>
  <div class="tt-meta">
    <strong data-testid="tt-bar-title">{text(track?.title)}</strong>
    <span class="tt-sep">—</span>
    <span data-testid="tt-bar-artist">{text(track?.artist)}</span>
  </div>

  <div class="tt-transport">
    <button
      class="tt-ctl"
      data-testid="tt-prev"
      disabled={!canPrev}
      aria-label="Bài trước"
      onclick={onprev}>⏮</button
    >
    <button
      class="tt-ctl"
      data-testid="tt-playpause"
      aria-label={playing ? 'Tạm dừng' : 'Phát'}
      onclick={onplaypause}>{playing ? '⏸' : '▶'}</button
    >
    <button
      class="tt-ctl"
      data-testid="tt-next"
      disabled={!canNext}
      aria-label="Bài sau"
      onclick={onnext}>⏭</button
    >

    <!--
      Stop lives here rather than in a second control row. docs/02 §1 needs the
      playing/paused → setup edge to have a home, and docs/03 §2 puts transport
      in Z7 — a duplicate row would give two controls the same accessible name,
      which is a real ambiguity for a screen reader, not just for a test.
    -->
    <button class="tt-ctl" data-testid="tt-stop" aria-label="Dừng hẳn" onclick={onstop}>⏹</button>

    <button class="tt-ctl" data-testid="tt-mute" aria-label="Tắt tiếng" onclick={onmute}>
      {muted ? '🔇' : '🔊'}
    </button>
    <input
      class="tt-vol"
      type="range"
      min="0"
      max="100"
      value={Math.round(volume * 100)}
      aria-label="Âm lượng"
      data-testid="tt-volume"
      oninput={(e) => onvolume(Number(e.currentTarget.value) / 100)}
    />
  </div>

  <div class="tt-pos" data-testid="tt-position">
    {positionText(positionMs)} / {positionText(durationMs)}
  </div>

  <div class="tt-progress" aria-hidden="true">
    <div class="tt-progress-fill" style:width="{progress * 100}%"></div>
  </div>
</footer>

<style>
  .tt-bar {
    position: fixed;
    inset: auto 0 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    padding: 0.6rem 1rem 0.75rem;
    font-size: 0.8rem;
    background: color-mix(in srgb, var(--color-tt-surface) 88%, transparent);
    border-top: 1px solid var(--color-tt-line);
    transition: opacity var(--duration-tt-base) var(--ease-tt);
  }
  .hidden {
    opacity: 0;
    pointer-events: none;
  }
  /* docs/03 §8: the bar still hides, it just stops fading (content, not
     decoration — the state change is instant instead of animated). */
  @media (prefers-reduced-motion: reduce) {
    .tt-bar {
      transition: none;
    }
  }
  .tt-meta {
    display: flex;
    gap: 0.4rem;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .tt-sep,
  .tt-meta span {
    color: var(--color-tt-muted);
  }
  .tt-transport {
    display: flex;
    gap: 0.35rem;
    align-items: center;
    margin-left: auto;
  }
  .tt-ctl {
    min-width: 2rem;
    padding: 0.2rem 0.4rem;
    color: var(--color-tt-text);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0.25rem;
  }
  .tt-ctl:hover:not(:disabled) {
    border-color: var(--color-tt-line);
  }
  .tt-ctl:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .tt-vol {
    width: 5rem;
  }
  .tt-pos {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--color-tt-muted);
  }
  .tt-progress {
    flex-basis: 100%;
    height: 2px;
    background: var(--color-tt-line);
  }
  .tt-progress-fill {
    height: 100%;
    background: var(--color-tt-signal);
  }
</style>
