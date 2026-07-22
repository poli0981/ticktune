<script lang="ts">
  import { positionText, text } from '../engine/importer/tt-track-display';
  import { TT_MAX_PLAYLIST_TOTAL_MS, queueTotalMs } from '../engine/importer/tt-queue-rules';
  import type { TtTrack } from '../engine/importer/types';

  /**
   * docs/03 §2 Z4, Playlist rail — and the same component on Setup, because
   * docs/02 §1 builds the queue in `setup` while docs/03 §2 shows a live list
   * during playback. Two mount points, one source of truth; a second component
   * would be two places for the now-playing highlight to disagree.
   *
   * P3 slice 1 renders and jumps. Drag-reorder and the context menu are slice 2
   * (docs/16) — `Alt+↑/↓` and the menu items are already specified in docs/03 §7
   * and docs/02 §8 so that implementation cannot quietly become the spec.
   */

  interface Props {
    tracks: TtTrack[];
    /** The cursor. Null before Start — nothing is highlighted then, by design. */
    currentId: string | null;
    shuffle: boolean;
    repeat: boolean;
    /** docs/02 §5.1 rule 6 — the order ran out with Repeat off. */
    exhausted: boolean;
    onremove: (id: string) => void;
    onjump: (id: string) => void;
    onshuffle: (on: boolean) => void;
    onrepeat: (on: boolean) => void;
    oninfo: (track: TtTrack) => void;
  }

  const {
    tracks,
    currentId,
    shuffle,
    repeat,
    exhausted,
    onremove,
    onjump,
    onshuffle,
    onrepeat,
    oninfo,
  }: Props = $props();

  const playable = $derived(tracks.filter((t) => t.status !== 'error'));
  /**
   * Null when any duration is unknown, which renders as `–` below rather than
   * as a sum over the known subset. Hard invariant 5, and the reason docs/03 §2
   * had to spell the degraded form out: the literal "12 tracks · 48:31 / 91:00"
   * assumes every tag parsed, and one file that did not is enough.
   */
  const totalMs = $derived(queueTotalMs(tracks));
  const capText = positionText(TT_MAX_PLAYLIST_TOTAL_MS);
</script>

<aside class="tt-rail" data-testid="tt-queue-panel">
  <div class="tt-badge">DANH SÁCH</div>

  <div class="tt-toggles" role="group" aria-label="Phát lại">
    <button
      class="tt-toggle"
      class:tt-on={shuffle}
      aria-pressed={shuffle}
      data-testid="tt-shuffle"
      onclick={() => onshuffle(!shuffle)}>Trộn</button
    >
    <button
      class="tt-toggle"
      class:tt-on={repeat}
      aria-pressed={repeat}
      data-testid="tt-repeat"
      onclick={() => onrepeat(!repeat)}>Lặp lại</button
    >
  </div>

  {#if tracks.length === 0}
    <p class="tt-empty">Chưa có bài nào.</p>
  {:else}
    <ul class="tt-rows">
      {#each tracks as track, i (track.id)}
        <li
          class="tt-row"
          class:tt-current={track.id === currentId}
          class:tt-error={track.status === 'error'}
          data-testid="tt-queue-row"
          data-tt-id={track.id}
        >
          <span class="tt-no" aria-hidden="true">{i + 1}</span>
          <!--
            A button, not a div with a role: it is focusable, it reaches the
            context menu by keyboard for free, and docs/03 §8 requires queue
            rows to be focusable. Right-click, Menu and Shift+F10 all open the
            info modal, matching the Single rail's card.
          -->
          <button
            class="tt-row-main"
            aria-current={track.id === currentId ? 'true' : undefined}
            ondblclick={() => onjump(track.id)}
            oncontextmenu={(e) => {
              e.preventDefault();
              oninfo(track);
            }}
            onkeydown={(e) => {
              if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                e.preventDefault();
                oninfo(track);
              }
            }}
          >
            <strong>{text(track.title)}</strong>
            <span>{text(track.artist)}</span>
          </button>
          <span class="tt-dur">{positionText(track.durationMs)}</span>
          <button
            class="tt-remove"
            data-testid="tt-queue-remove"
            aria-label="Bỏ {text(track.title)}"
            onclick={() => onremove(track.id)}>×</button
          >
        </li>
      {/each}
    </ul>

    <p class="tt-totals" data-testid="tt-queue-totals">
      {playable.length} bài · {totalMs === null ? '–' : positionText(totalMs)} / {capText}
    </p>
  {/if}

  {#if exhausted}
    <!-- docs/02 §5 / §5.1 rule 6: the countdown keeps running; only media stops. -->
    <p class="tt-ended" role="status" data-testid="tt-playlist-ended">Đã hết danh sách</p>
  {/if}
</aside>

<style>
  .tt-rail {
    display: grid;
    gap: 0.5rem;
    align-content: start;
    width: 17rem;
    max-height: 60vh;
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
  .tt-toggles {
    display: flex;
    gap: 0.3rem;
  }
  .tt-toggle {
    flex: 1;
    padding: 0.2rem 0.4rem;
    font-size: 0.7rem;
    color: var(--color-tt-muted);
    background: transparent;
    border: 1px solid var(--color-tt-line);
    border-radius: 0.25rem;
  }
  .tt-on {
    color: var(--color-tt-signal);
    border-color: var(--color-tt-signal);
  }
  .tt-empty,
  .tt-totals,
  .tt-ended {
    font-size: 0.7rem;
    color: var(--color-tt-muted);
  }
  .tt-ended {
    color: var(--color-tt-warn);
  }
  .tt-rows {
    display: grid;
    gap: 0.1rem;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  .tt-row {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    padding: 0.15rem 0.25rem;
    border-radius: 0.25rem;
  }
  .tt-current {
    background: color-mix(in srgb, var(--color-tt-signal) 12%, transparent);
  }
  /* docs/02 §1: an errored track is SHOWN struck-through so the user can see
     why Start is disabled — never silently hidden. */
  .tt-error .tt-row-main {
    text-decoration: line-through;
    opacity: 0.55;
  }
  .tt-no {
    width: 1.5rem;
    font-family: var(--font-mono);
    font-size: 0.66rem;
    color: var(--color-tt-muted);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .tt-row-main {
    display: grid;
    flex: 1;
    min-width: 0;
    padding: 0.1rem 0.2rem;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0.2rem;
  }
  .tt-row-main:hover {
    border-color: var(--color-tt-line);
  }
  .tt-row-main strong {
    font-size: 0.76rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tt-row-main span {
    font-size: 0.66rem;
    color: var(--color-tt-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tt-current .tt-row-main strong {
    color: var(--color-tt-signal);
  }
  .tt-dur {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    color: var(--color-tt-muted);
    font-variant-numeric: tabular-nums;
  }
  .tt-remove {
    padding: 0 0.3rem;
    color: var(--color-tt-muted);
    background: transparent;
    border: none;
    border-radius: 0.2rem;
  }
  .tt-remove:hover {
    color: var(--color-tt-danger);
  }
</style>
