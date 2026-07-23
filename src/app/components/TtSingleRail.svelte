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
    /** False while docs/15 §S4b is open — the toggle renders disabled. */
    crossfadeAvailable: boolean;
    /** The STORED preference (docs/02 §3.1) — not necessarily what plays. */
    loopStyle: TtLoopStyle;
    onloopstyle: (style: TtLoopStyle) => void;
    oninfo: () => void;
  }

  const { track, loops, crossfadeAvailable, loopStyle, onloopstyle, oninfo }: Props = $props();

  /**
   * What is actually playing, which is not always what is stored.
   *
   * Until P5 slice 2 this pair had `aria-pressed` hardcoded to `true`/`false`
   * and **no `onclick` at all** — an inert control shipped to production, and
   * "Cắt thẳng" was not even disabled, so it looked live. The pressed state is
   * now derived, and it reports the EFFECTIVE style rather than the stored one:
   * while docs/15 §S4b is open a stored `'crossfade'` plays as a hard cut
   * (docs/05 §2, TT-SYS-205), and a toggle claiming otherwise would be the
   * silent fallback that doc set out to forbid.
   */
  const effective = $derived<TtLoopStyle>(crossfadeAvailable ? loopStyle : 'hard');
  /** docs/05 §2's "falls back with a notice" — until now the notice was a log line. */
  const fellBack = $derived(loopStyle === 'crossfade' && effective !== 'crossfade');
</script>

<aside class="tt-rail" data-testid="tt-rail">
  <div class="tt-badge">{i18n.t('player.badge.single')}</div>

  <div class="tt-loop" data-testid="tt-loop-count">
    {i18n.t('player.loop.count', { count: loops })}
  </div>

  <div class="tt-loop-style" role="group" aria-label={i18n.t('player.loop.label')}>
    <button
      class="tt-style"
      class:tt-style-on={effective === 'hard'}
      aria-pressed={effective === 'hard'}
      data-testid="tt-hard-toggle"
      onclick={() => onloopstyle('hard')}>{i18n.t('player.loop.hard')}</button
    >
    <button
      class="tt-style"
      class:tt-style-on={effective === 'crossfade'}
      aria-pressed={effective === 'crossfade'}
      disabled={!crossfadeAvailable}
      aria-disabled={!crossfadeAvailable}
      title={crossfadeAvailable ? '' : i18n.t('player.loop.locked')}
      data-testid="tt-crossfade-toggle"
      onclick={() => onloopstyle('crossfade')}>{i18n.t('player.loop.crossfade')}</button
    >
  </div>

  {#if fellBack}
    <!--
      docs/05 §2 promised the fallback would be announced "rather than
      silently". TT-SYS-205 has carried it in the log since P3; this is the half
      a listener can actually see.
    -->
    <p class="tt-fallback" role="status" data-testid="tt-loop-fallback">
      {i18n.t('player.loop.fallback')}
    </p>
  {/if}

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
    /* Fixed column, like the other two rails — docs/03 §4. The countdown's cap
       is computed from what is left after this, so a rail that could shrink
       would make that figure a guess. */
    flex: none;
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
  .tt-fallback {
    font-size: 0.64rem;
    line-height: 1.4;
    color: var(--color-tt-warn);
  }
</style>
