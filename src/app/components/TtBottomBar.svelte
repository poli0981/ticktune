<script lang="ts">
  import TtIcon from './TtIcon.svelte';
  import { i18n } from '../state/i18n.svelte';
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

<!--
  `tt-bar-idle`, not `hidden`: Tailwind scans this file, and a bare `hidden`
  class is its `display: none` utility — which silently replaced the fade with a
  cut. The idle bar also leaves the tab order (`visibility`), as it did then.
-->
<footer
  class="tt-bar"
  class:tt-bar-idle={!visible}
  data-testid="tt-bottom-bar"
  data-visible={visible}
>
  <div class="tt-meta">
    <strong data-testid="tt-bar-title">{text(track?.title)}</strong>
    <span class="tt-sep" aria-hidden="true">—</span>
    <span data-testid="tt-bar-artist">{text(track?.artist)}</span>
  </div>

  <div class="tt-transport">
    <button
      class="tt-key tt-key-icon"
      data-testid="tt-prev"
      disabled={!canPrev}
      aria-label={i18n.t('player.transport.prev')}
      onclick={onprev}><TtIcon name="prev" /></button
    >
    <button
      class="tt-key tt-key-icon tt-key-primary"
      data-testid="tt-playpause"
      aria-label={playing ? i18n.t('player.transport.pause') : i18n.t('player.transport.play')}
      onclick={onplaypause}><TtIcon name={playing ? 'pause' : 'play'} /></button
    >
    <button
      class="tt-key tt-key-icon"
      data-testid="tt-next"
      disabled={!canNext}
      aria-label={i18n.t('player.transport.next')}
      onclick={onnext}><TtIcon name="next" /></button
    >

    <!--
      Stop lives here rather than in a second control row. docs/02 §1 needs the
      playing/paused → setup edge to have a home, and docs/03 §2 puts transport
      in Z7 — a duplicate row would give two controls the same accessible name,
      which is a real ambiguity for a screen reader, not just for a test.
    -->
    <button
      class="tt-key tt-key-icon"
      data-testid="tt-stop"
      aria-label={i18n.t('player.transport.stop')}
      onclick={onstop}><TtIcon name="stop" /></button
    >
  </div>

  <div class="tt-level">
    <!-- A toggle button: the label names the control, aria-pressed carries its
         state. The state used to live only in the emoji, which a screen reader
         announces as "speaker" either way. -->
    <button
      class="tt-key tt-key-icon tt-key-ghost"
      data-testid="tt-mute"
      aria-label={i18n.t('player.transport.mute')}
      aria-pressed={muted}
      onclick={onmute}><TtIcon name={muted ? 'mute' : 'volume'} /></button
    >
    <input
      class="tt-fader tt-vol"
      type="range"
      min="0"
      max="100"
      value={Math.round(volume * 100)}
      aria-label={i18n.t('player.transport.volume')}
      data-testid="tt-volume"
      oninput={(e) => onvolume(Number(e.currentTarget.value) / 100)}
    />
    <!-- The range announces its own value; this is the visible read-out only. -->
    <span class="tt-readout" aria-hidden="true">{Math.round(volume * 100)}</span>
  </div>

  <div class="tt-pos" data-testid="tt-position">
    {positionText(positionMs)} / {positionText(durationMs)}
  </div>

  <div class="tt-progress" aria-hidden="true">
    <div class="tt-progress-fill" style:width="{progress * 100}%"></div>
  </div>
</footer>

<style>
  /*
   * The transport console: a floating rack strip rather than a full-bleed bar.
   *
   * Right-inset by `--tt-yt-reserve` like every other fixed layer (docs/03 §2).
   * The full-width bar never actually reached the player — the stage reserves
   * its height — but it was the one fixed layer exempt from the rule, and a
   * rule with an exemption is a rule the next layout change breaks.
   *
   * `container-type` so the read-out can drop out when the strip is narrow:
   * 1024 px in YouTube mode leaves it about 530 px.
   */
  .tt-bar {
    position: fixed;
    right: calc(var(--tt-yt-reserve, 0px) + var(--tt-space-5));
    bottom: var(--tt-space-3);
    left: var(--tt-space-5);
    z-index: var(--tt-z-bar);
    display: grid;
    grid-template-areas:
      'meta transport level pos'
      'progress progress progress progress';
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    gap: var(--tt-space-2) var(--tt-space-4);
    align-items: center;
    padding: var(--tt-space-2) var(--tt-space-4);
    font-size: var(--tt-text-sm);
    background-color: var(--color-tt-surface);
    border: 1px solid var(--color-tt-line);
    border-radius: var(--tt-radius-md);
    box-shadow: var(--tt-shadow-panel);
    container-type: inline-size;
    transition:
      opacity var(--duration-tt-base) var(--ease-tt),
      visibility 0s linear 0s;
  }
  .tt-bar-idle {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    transition:
      opacity var(--duration-tt-base) var(--ease-tt),
      visibility 0s linear var(--duration-tt-base);
  }
  /* docs/03 §8: the bar still hides, it just stops fading (content, not
     decoration — the state change is instant instead of animated). */
  @media (prefers-reduced-motion: reduce) {
    .tt-bar,
    .tt-bar-idle {
      transition: none;
    }
  }
  .tt-meta {
    display: flex;
    grid-area: meta;
    gap: var(--tt-space-2);
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .tt-meta strong {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
  }
  .tt-sep,
  .tt-meta span {
    color: var(--color-tt-muted);
  }
  .tt-meta span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tt-transport,
  .tt-level {
    display: flex;
    gap: var(--tt-space-1);
    align-items: center;
  }
  .tt-transport {
    grid-area: transport;
  }
  .tt-level {
    grid-area: level;
    gap: var(--tt-space-2);
  }
  .tt-vol {
    width: 5.5rem;
  }
  .tt-pos {
    grid-area: pos;
    font-family: var(--font-mono);
    font-size: var(--tt-text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--color-tt-muted);
    white-space: nowrap;
  }
  @container (width < 40rem) {
    .tt-readout {
      display: none;
    }
    .tt-vol {
      width: 4rem;
    }
  }
  /* The tape: a recessed track with an amber head. */
  .tt-progress {
    grid-area: progress;
    height: 3px;
    background: var(--color-tt-void);
    border-radius: var(--tt-radius-pill);
    box-shadow: inset 0 0 0 1px var(--color-tt-line);
    overflow: hidden;
  }
  .tt-progress-fill {
    height: 100%;
    background: var(--color-tt-signal);
    box-shadow: var(--tt-glow-signal);
  }
</style>
