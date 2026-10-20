<script lang="ts">
  import { trackInfoRows } from '../engine/importer/tt-track-display';
  import { i18n, type TtKey } from '../state/i18n.svelte';
  import type { TtTrack } from '../engine/importer/types';

  /**
   * docs/02 §8 — the track metadata modal.
   *
   * Every field comes from `trackInfoRows`, which is pure and unit-tested, so
   * this component decides nothing: it renders rows, traps focus, and returns
   * focus to whatever opened it (docs/03 §8).
   */

  interface Props {
    track: TtTrack;
    onclose: () => void;
  }

  const { track, onclose }: Props = $props();

  /**
   * The engine hands back KEYS; translating them is this component's job.
   *
   * A value prefixed `@` is itself a key — `source` and `coverArt` carry
   * translatable VALUES, not just labels, which docs/08 §3.1's "one key per
   * 02 §8 field" did not anticipate. `N/A` and `–` pass through untouched:
   * docs/08 §3 keeps the fallbacks universal.
   */
  const rows = $derived(
    trackInfoRows(track, i18n.locale).map((row) => ({
      key: row.labelKey,
      label: i18n.t(`player.trackinfo.${row.labelKey}` as TtKey),
      value: row.value.startsWith('@')
        ? i18n.t(`player.trackinfo.${row.value.slice(1)}` as TtKey)
        : row.value,
    })),
  );

  let dialog: HTMLDivElement;
  let closeButton: HTMLButtonElement;

  $effect(() => {
    // Remembered before focus moves, so Esc can put it back where it was —
    // otherwise focus lands on <body> and a keyboard user loses their place.
    const opener = document.activeElement as HTMLElement | null;
    closeButton?.focus();
    return () => opener?.focus?.();
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
      return;
    }
    if (e.key !== 'Tab') return;

    // Focus trap. The modal has few controls, so querying on each Tab is
    // cheaper than maintaining a list and cannot go stale.
    const focusable = dialog.querySelectorAll<HTMLElement>('button, [href], [tabindex]');
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div class="tt-backdrop" data-testid="tt-trackinfo-backdrop">
  <div
    bind:this={dialog}
    class="tt-modal"
    role="dialog"
    aria-modal="true"
    aria-label={i18n.t('player.trackinfo.open')}
    data-testid="tt-trackinfo"
  >
    <h2>{i18n.t('player.trackinfo.open')}</h2>

    <!--
      The embedded cover, when the file carried one (docs/05 §5). The `Ảnh bìa`
      row below still says Có / N/A — this is the evidence for it, and it is
      the only place in P2 the artwork is visible at all: the cover-blur
      background and auto-theme that consume it are P5 (03 §2 Z1, 03 §5).
    -->
    {#if track.coverArtUrl}
      <img class="tt-cover" src={track.coverArtUrl} alt="" data-testid="tt-cover" />
    {/if}

    <dl>
      {#each rows as row (row.key)}
        <div>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      {/each}
    </dl>

    <button
      bind:this={closeButton}
      class="tt-key tt-close"
      data-testid="tt-trackinfo-close"
      onclick={onclose}>{i18n.t('player.trackinfo.close')}</button
    >
  </div>
</div>

<style>
  /*
   * docs/03 §2: "Any overlay / modal must not cover the player rect."
   *
   * This was `inset: 0` until P5 slice 2 and therefore violated that rule in
   * v0.5.2: right-clicking a queue row during YouTube playback laid 75% opaque
   * void over a playing player, which docs/06 §1.2 forbids. The modal box
   * itself never reached the rail; the BACKDROP did, which is exactly the kind
   * of thing that survives a review of the markup.
   *
   * `--tt-yt-reserve` is published by the shell and is `0px` in every other
   * mode, so the common case is unchanged.
   */
  .tt-backdrop {
    position: fixed;
    inset: 0 var(--tt-yt-reserve, 0px) 0 0;
    z-index: var(--tt-z-modal);
    display: grid;
    place-items: center;
    padding: var(--tt-space-6);
    background: color-mix(in srgb, var(--color-tt-void) 78%, transparent);
  }
  /*
   * A spec sheet: title with the cover beside it, then the sixteen fields in
   * two columns. One column was 700 px tall — taller than 80vh at 720 — so the
   * modal opened scrolled to its close button with the title out of sight.
   * Below 34rem (YouTube mode at 1024 px leaves about 515) it is one column.
   */
  .tt-modal {
    display: grid;
    grid-template-areas:
      'title cover'
      'list list'
      'close close';
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: var(--tt-space-4);
    width: min(42rem, 100%);
    max-height: 80vh;
    container-type: inline-size;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--tt-space-5);
    background-color: var(--color-tt-surface);
    border: 1px solid var(--color-tt-outline);
    border-radius: var(--tt-radius-md);
    box-shadow: var(--tt-shadow-panel);
  }
  h2 {
    display: flex;
    grid-area: title;
    gap: var(--tt-space-2);
    align-items: center;
    align-self: start;
    margin: 0 0 var(--tt-space-4);
    font-family: var(--font-display);
    font-size: var(--tt-text-xs);
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--color-tt-muted);
  }
  h2::after {
    flex: 1;
    height: 1px;
    content: '';
    background: var(--color-tt-line);
  }
  .tt-cover {
    display: block;
    grid-area: cover;
    width: 6rem;
    height: 6rem;
    margin: 0 0 var(--tt-space-4);
    object-fit: cover;
    border: 1px solid var(--color-tt-outline);
    border-radius: var(--tt-radius-sm);
    box-shadow: 0 8px 20px rgb(0 0 0 / 45%);
  }
  dl {
    display: grid;
    grid-area: list;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--tt-space-1) var(--tt-space-5);
    margin: 0 0 var(--tt-space-5);
    font-size: var(--tt-text-sm);
  }
  @container (width < 34rem) {
    dl {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  dl > div {
    display: flex;
    gap: var(--tt-space-4);
    justify-content: space-between;
    padding-bottom: var(--tt-space-1);
    border-bottom: 1px solid var(--color-tt-line);
  }
  dt {
    color: var(--color-tt-muted);
    white-space: nowrap;
  }
  dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--tt-text-xs);
    overflow-wrap: anywhere;
    text-align: right;
  }
  .tt-close {
    grid-area: close;
    width: 100%;
  }
</style>
