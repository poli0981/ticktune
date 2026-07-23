<script lang="ts">
  import { i18n } from '../state/i18n.svelte';
  import { positionText, text } from '../engine/importer/tt-track-display';
  import type { TtTrack } from '../engine/importer/types';

  /**
   * docs/03 §2 Z4, Single-mode rail: mode badge, loop counter, loop-style
   * toggle and the now-playing card.
   *
   * The card is also the `contextmenu` target for the track-info modal
   * (docs/02 §8) — that modal is P2 scope while the Playlist queue rows that
   * would otherwise host it are P3, so without the card it would have no
   * trigger for a whole phase.
   */

  interface Props {
    track: TtTrack | null;
    loops: number;
    /** False while docs/15 §S4b is open — the toggle renders disabled. */
    crossfadeAvailable: boolean;
    oninfo: () => void;
  }

  const { track, loops, crossfadeAvailable, oninfo }: Props = $props();
</script>

<aside class="tt-rail" data-testid="tt-rail">
  <div class="tt-badge">{i18n.t('player.badge.single')}</div>

  <div class="tt-loop" data-testid="tt-loop-count">
    {i18n.t('player.loop.count', { count: loops })}
  </div>

  <div class="tt-loop-style" role="group" aria-label={i18n.t('player.loop.label')}>
    <button class="tt-style tt-style-on" aria-pressed="true">{i18n.t('player.loop.hard')}</button>
    <button
      class="tt-style"
      aria-pressed="false"
      disabled={!crossfadeAvailable}
      aria-disabled={!crossfadeAvailable}
      title={crossfadeAvailable ? '' : i18n.t('player.loop.locked')}
      data-testid="tt-crossfade-toggle">{i18n.t('player.loop.crossfade')}</button
    >
  </div>

  {#if track}
    <!--
      Right-click, Menu and Shift+F10 all open the info modal (docs/03 §8).
      A button, so it is focusable and reachable by keyboard without inventing
      a tabindex on a div.
    -->
    <button
      class="tt-card"
      data-testid="tt-nowplaying"
      oncontextmenu={(e) => {
        e.preventDefault();
        oninfo();
      }}
      onkeydown={(e) => {
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          oninfo();
        }
      }}
      onclick={oninfo}
    >
      <strong>{text(track.title)}</strong>
      <span>{text(track.artist)}</span>
      <span class="tt-dur">{positionText(track.durationMs)}</span>
    </button>
    <p class="tt-hint">{i18n.t('player.loop.hint')}</p>
  {/if}
</aside>

<style>
  .tt-rail {
    display: grid;
    gap: 0.6rem;
    align-content: start;
    width: 15rem;
    padding: 0.9rem;
    background: color-mix(in srgb, var(--color-tt-surface) 80%, transparent);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.5rem;
  }
  .tt-badge {
    font-size: 0.66rem;
    letter-spacing: 0.14em;
    color: var(--color-tt-muted);
  }
  .tt-loop {
    font-family: var(--font-mono);
    font-size: 1.1rem;
    color: var(--color-tt-signal);
    font-variant-numeric: tabular-nums;
  }
  .tt-loop-style {
    display: flex;
    gap: 0.3rem;
  }
  .tt-style {
    flex: 1;
    padding: 0.2rem 0.4rem;
    font-size: 0.7rem;
    color: var(--color-tt-muted);
    background: transparent;
    border: 1px solid var(--color-tt-line);
    border-radius: 0.25rem;
  }
  .tt-style-on {
    color: var(--color-tt-signal);
    border-color: var(--color-tt-signal);
  }
  .tt-style:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .tt-card {
    display: grid;
    gap: 0.15rem;
    padding: 0.5rem;
    text-align: left;
    background: transparent;
    border: 1px solid var(--color-tt-line);
    border-radius: 0.375rem;
  }
  .tt-card:hover {
    border-color: var(--color-tt-signal);
  }
  .tt-card strong {
    font-size: 0.82rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tt-card span {
    font-size: 0.72rem;
    color: var(--color-tt-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tt-dur {
    font-family: var(--font-mono);
  }
  .tt-hint {
    font-size: 0.66rem;
    color: var(--color-tt-muted);
  }
</style>
