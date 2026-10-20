<script lang="ts">
  import { i18n } from '../state/i18n.svelte';
  import { positionText, text } from '../engine/importer/tt-track-display';
  import type { TtTrack } from '../engine/importer/types';
  import type { TtLoopStyle } from '../../lib/tt-domain-types';

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
    /** The stored preference (docs/02 §3.1) — since v2.0 also what plays. */
    loopStyle: TtLoopStyle;
    onloopstyle: (style: TtLoopStyle) => void;
    oninfo: () => void;
  }

  const { track, loops, loopStyle, onloopstyle, oninfo }: Props = $props();

  /*
   * Until P5 slice 2 this pair had `aria-pressed` hardcoded and no `onclick`
   * at all — an inert control shipped to production. Until v2.0 the crossfade
   * half was disabled while spike S4b was open, and a stored `'crossfade'`
   * played as a hard cut with a notice (TT-SYS-205). S4b passed: both styles
   * are real (docs/05 §2), so the pressed state is simply the stored one.
   */
</script>

<aside class="tt-rail" data-testid="tt-rail">
  <h2 class="tt-label tt-badge">{i18n.t('player.badge.single')}</h2>

  <div class="tt-loop" data-testid="tt-loop-count">
    {i18n.t('player.loop.count', { count: loops })}
  </div>

  <div class="tt-loop-style" role="group" aria-label={i18n.t('player.loop.label')}>
    <button
      class="tt-key tt-key-sm tt-style"
      aria-pressed={loopStyle === 'hard'}
      data-testid="tt-hard-toggle"
      onclick={() => onloopstyle('hard')}
      ><span class="tt-led" aria-hidden="true"></span>{i18n.t('player.loop.hard')}</button
    >
    <button
      class="tt-key tt-key-sm tt-style"
      aria-pressed={loopStyle === 'crossfade'}
      data-testid="tt-crossfade-toggle"
      onclick={() => onloopstyle('crossfade')}
      ><span class="tt-led" aria-hidden="true"></span>{i18n.t('player.loop.crossfade')}</button
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
    gap: var(--tt-space-3);
    align-content: start;
    /* Fixed column, like the other two rails — docs/03 §4. The countdown's cap
       is computed from what is left after this, so a rail that could shrink
       would make that figure a guess. */
    flex: none;
    width: 15rem;
    padding: var(--tt-space-4);
    background-color: var(--color-tt-surface);
    border: 1px solid var(--color-tt-line);
    border-radius: var(--tt-radius-md);
    box-shadow: var(--tt-shadow-panel);
  }
  /* The module legend, with the engraved rule every rack module carries. */
  .tt-badge {
    display: flex;
    gap: var(--tt-space-2);
    align-items: center;
    margin: 0;
  }
  .tt-badge::after {
    flex: 1;
    height: 1px;
    content: '';
    background: var(--color-tt-line);
  }
  /* The loop counter reads like a tape counter: amber digits in a recessed
     window. */
  .tt-loop {
    padding: var(--tt-space-2) var(--tt-space-3);
    font-family: var(--font-mono);
    font-size: var(--tt-text-lg);
    color: var(--color-tt-signal);
    font-variant-numeric: tabular-nums;
    background: var(--color-tt-void);
    border: 1px solid var(--color-tt-line);
    border-radius: var(--tt-radius-sm);
    box-shadow: var(--tt-shadow-pressed);
  }
  /* Stacked, not side by side: in a 15rem rail two keycaps get ~100 px each,
     and "CẮT THẲNG" wrapped onto two lines inside its key. */
  .tt-loop-style {
    display: grid;
    gap: var(--tt-space-2);
  }
  .tt-style {
    justify-content: flex-start;
    width: 100%;
  }
  .tt-card {
    display: grid;
    gap: 2px;
    padding: var(--tt-space-3);
    text-align: left;
    color: inherit;
    cursor: pointer;
    background: var(--color-tt-void);
    border: 1px solid var(--color-tt-outline);
    border-radius: var(--tt-radius-sm);
    transition: border-color var(--duration-tt-fast) var(--ease-tt);
  }
  .tt-card:hover {
    border-color: var(--color-tt-signal);
  }
  .tt-card strong {
    overflow: hidden;
    font-size: var(--tt-text-sm);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tt-card span {
    overflow: hidden;
    font-size: var(--tt-text-xs);
    color: var(--color-tt-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tt-dur {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .tt-hint {
    margin: 0;
    font-size: var(--tt-text-xs);
    line-height: 1.45;
    color: var(--color-tt-muted);
  }
</style>
