<script lang="ts">
  import TtContextMenu, { type TtMenuItem } from './TtContextMenu.svelte';
  import { i18n } from '../state/i18n.svelte';
  import { positionText, text } from '../engine/importer/tt-track-display';
  import { TT_MAX_PLAYLIST_TOTAL_MS, queueTotalMs } from '../engine/importer/tt-queue-rules';
  import type { TtTrack } from '../engine/importer/types';

  /**
   * docs/03 §2 Z4, Playlist rail — and the same component on Setup, because
   * docs/02 §1 builds the queue in `setup` while docs/03 §2 shows a live list
   * during playback. Two mount points, one source of truth; a second component
   * would be two places for the now-playing highlight to disagree.
   *
   * **Reorder is driven by POINTER events, not the HTML5 drag-and-drop API.**
   * That is a testability decision taken deliberately: `tests/e2e/_helpers.ts`
   * already records that Playwright cannot synthesise a native drag, which is
   * why file import uses a synthetic `DragEvent`. Building rows on `draggable`
   * would make docs/13 §2's "TtQueuePanel (reorder…)" test and docs/13 §6's
   * keyboard-only journey unassertable — the feature would ship with its only
   * coverage being a screenshot. Pointer events are drivable end to end.
   *
   * The keyboard path (`Alt+↑/↓`, docs/03 §7) is not a fallback for the drag;
   * it is the primary tested route, and the drag is the ergonomic one.
   */

  interface Props {
    tracks: TtTrack[];
    /**
     * Where this instance is mounted.
     *
     * `rail` is the docs/03 §2 Z4 player rail, which owns its column and can
     * take 60vh. `setup` stacks under the drop zone and above the countdown
     * inputs and Start — at 60vh a 24-track queue pushed Start clean off a
     * 720 px viewport, so the list is capped much shorter there and scrolls
     * sooner. Same component, same rules, different budget.
     */
    variant: 'rail' | 'setup';
    /** The cursor. Null before Start — nothing is highlighted then, by design. */
    currentId: string | null;
    shuffle: boolean;
    repeat: boolean;
    /** docs/02 §5.1 rule 6 — the order ran out with Repeat off. */
    exhausted: boolean;
    /**
     * Whether a total-duration cap applies — false in YouTube mode.
     *
     * docs/06 §5: "No per-track or total duration limits in this mode." Showing
     * `… / 91:00` against links would assert a ceiling that does not exist, and
     * the numerator is `–` anyway until the player backfills each duration
     * (docs/06 §2), so the row would read as a limit nobody can measure.
     */
    capped: boolean;
    onremove: (id: string) => void;
    onjump: (id: string) => void;
    onshuffle: (on: boolean) => void;
    onrepeat: (on: boolean) => void;
    oninfo: (track: TtTrack) => void;
    /** @param delta −1 up, +1 down. Clamped by the store (docs/02 §5.1). */
    onmove: (id: string, delta: number) => void;
  }

  const {
    tracks,
    variant,
    currentId,
    shuffle,
    repeat,
    exhausted,
    capped,
    onremove,
    onjump,
    onshuffle,
    onrepeat,
    oninfo,
    onmove,
  }: Props = $props();

  const playable = $derived(tracks.filter((t) => t.status !== 'error'));

  // ── reorder ───────────────────────────────────────────────────────────────

  let list = $state<HTMLUListElement | null>(null);
  let draggingId = $state<string | null>(null);
  /**
   * Announced politely on every move — docs/03 §8.
   *
   * Without it a reorder is silent to a screen reader: the DOM changed, but
   * nothing said so, and the user has no way to tell whether the key did
   * anything. The position is stated in words rather than left to the row's
   * number, which is `aria-hidden`.
   */
  let announcement = $state('');

  function announce(id: string, to: number) {
    const t = tracks.find((x) => x.id === id);
    announcement = i18n.t('player.queue.moved', {
      title: text(t?.title),
      to: to + 1,
      total: tracks.length,
    });
  }

  function move(id: string, delta: number) {
    const from = tracks.findIndex((t) => t.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= tracks.length) return;
    onmove(id, delta);
    announce(id, to);
  }

  /**
   * Which row index the pointer is currently over.
   *
   * Read from the live row rects rather than from a cached height: rows are one
   * or two lines depending on how long the title is, so a fixed row height
   * would drift down a long queue and drop tracks in the wrong place.
   */
  function indexAtPointer(clientY: number): number {
    const rows = list?.querySelectorAll('[data-testid=tt-queue-row]');
    if (!rows) return -1;
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i]?.getBoundingClientRect();
      if (r && clientY < r.bottom) return i;
    }
    return rows.length - 1;
  }

  function onHandleDown(e: PointerEvent, id: string) {
    // Left button only: a right-click on the handle should reach the context
    // menu, not start a drag nobody asked for.
    if (e.button !== 0) return;
    e.preventDefault();
    draggingId = id;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onHandleMove(e: PointerEvent) {
    if (draggingId === null) return;
    const from = tracks.findIndex((t) => t.id === draggingId);
    const to = indexAtPointer(e.clientY);
    if (from < 0 || to < 0 || to === from) return;
    // Move ONE step per crossing rather than jumping straight to `to`. The row
    // then tracks the pointer continuously instead of teleporting, and every
    // intermediate state is a valid queue.
    move(draggingId, to > from ? 1 : -1);
  }

  function endDrag(e: PointerEvent) {
    if (draggingId === null) return;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    draggingId = null;
  }

  // ── context menu (docs/02 §8) ─────────────────────────────────────────────

  let menu = $state<{ track: TtTrack; x: number; y: number } | null>(null);

  const menuItems = $derived.by((): TtMenuItem[] => {
    const i = menu === null ? -1 : tracks.findIndex((t) => t.id === menu?.track.id);
    return [
      { id: 'info', label: i18n.t('player.menu.info') },
      { id: 'up', label: i18n.t('player.menu.up'), disabled: i <= 0 },
      { id: 'down', label: i18n.t('player.menu.down'), disabled: i < 0 || i >= tracks.length - 1 },
      { id: 'remove', label: i18n.t('player.menu.remove'), danger: true },
    ];
  });

  function openMenu(track: TtTrack, x: number, y: number) {
    menu = { track, x, y };
  }

  /** Menu / Shift+F10 open it at the row, so the keyboard path has a position. */
  function openMenuAtRow(track: TtTrack, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    openMenu(track, r.left + 8, r.bottom);
  }

  function onMenuSelect(id: TtMenuItem['id']) {
    const target = menu?.track;
    menu = null;
    if (!target) return;
    if (id === 'info') oninfo(target);
    else if (id === 'up') move(target.id, -1);
    else if (id === 'down') move(target.id, 1);
    else onremove(target.id);
  }

  function onRowKeydown(e: KeyboardEvent, track: TtTrack) {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      openMenuAtRow(track, e.currentTarget as HTMLElement);
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      // docs/03 §7 — Alt-modified because bare ↑/↓ are volume ±5. The row keeps
      // focus across the move, so a second press continues from where it is.
      e.preventDefault();
      move(track.id, e.key === 'ArrowUp' ? -1 : 1);
    }
  }
  /**
   * Null when any duration is unknown, which renders as `–` below rather than
   * as a sum over the known subset. Hard invariant 5, and the reason docs/03 §2
   * had to spell the degraded form out: the literal "12 tracks · 48:31 / 91:00"
   * assumes every tag parsed, and one file that did not is enough.
   */
  const totalMs = $derived(queueTotalMs(tracks));
  const capText = positionText(TT_MAX_PLAYLIST_TOTAL_MS);
  const badge = $derived(capped ? i18n.t('player.badge.playlist') : i18n.t('player.badge.youtube'));
</script>

<aside
  class="tt-rail"
  class:tt-in-setup={variant === 'setup'}
  data-testid="tt-queue-panel"
  data-tt-variant={variant}
>
  <div class="tt-badge">{badge}</div>

  <div class="tt-toggles" role="group" aria-label={i18n.t('player.queue.label')}>
    <button
      class="tt-toggle"
      class:tt-on={shuffle}
      aria-pressed={shuffle}
      data-testid="tt-shuffle"
      onclick={() => onshuffle(!shuffle)}>{i18n.t('player.queue.shuffle')}</button
    >
    <button
      class="tt-toggle"
      class:tt-on={repeat}
      aria-pressed={repeat}
      data-testid="tt-repeat"
      onclick={() => onrepeat(!repeat)}>{i18n.t('player.queue.repeat')}</button
    >
  </div>

  {#if tracks.length === 0}
    <p class="tt-empty">{i18n.t('player.queue.empty')}</p>
  {:else}
    <ul class="tt-rows" bind:this={list}>
      {#each tracks as track, i (track.id)}
        <li
          class="tt-row"
          class:tt-current={track.id === currentId}
          class:tt-error={track.status === 'error'}
          class:tt-dragging={track.id === draggingId}
          data-testid="tt-queue-row"
          data-tt-id={track.id}
          oncontextmenu={(e) => {
            e.preventDefault();
            openMenu(track, e.clientX, e.clientY);
          }}
        >
          <!--
            The drag handle, not the whole row: dragging from the row body would
            make it impossible to click a track without risking a reorder, and
            the handle gives the affordance somewhere visible to live.
          -->
          <button
            class="tt-grip"
            aria-label={i18n.t('player.queue.drag', { title: text(track.title) })}
            data-testid="tt-queue-grip"
            onpointerdown={(e) => onHandleDown(e, track.id)}
            onpointermove={onHandleMove}
            onpointerup={endDrag}
            onpointercancel={endDrag}
            onkeydown={(e) => onRowKeydown(e, track)}>⠿</button
          >
          <span class="tt-no" aria-hidden="true">{i + 1}</span>
          <!--
            A button, not a div with a role: it is focusable, and docs/03 §8
            requires queue rows to be focusable. Menu / Shift+F10 open the same
            context menu the right-click does, so the reorder items are reachable
            without a pointer.
          -->
          <button
            class="tt-row-main"
            aria-current={track.id === currentId ? 'true' : undefined}
            ondblclick={() => onjump(track.id)}
            onkeydown={(e) => onRowKeydown(e, track)}
          >
            <strong>{text(track.title)}</strong>
            <span>{text(track.artist)}</span>
          </button>
          <span class="tt-dur">{positionText(track.durationMs)}</span>
          <button
            class="tt-remove"
            data-testid="tt-queue-remove"
            aria-label={i18n.t('player.queue.remove', { title: text(track.title) })}
            onclick={() => onremove(track.id)}>×</button
          >
        </li>
      {/each}
    </ul>

    <p class="tt-totals" data-testid="tt-queue-totals">
      {i18n.t('player.queue.totals', { count: playable.length })} · {totalMs === null
        ? '–'
        : positionText(totalMs)}{capped ? ` / ${capText}` : ''}
    </p>
  {/if}

  {#if exhausted}
    <!-- docs/02 §5 / §5.1 rule 6: the countdown keeps running; only media stops. -->
    <p class="tt-ended" role="status" data-testid="tt-playlist-ended">
      {i18n.t('player.queue.ended')}
    </p>
  {/if}

  <!-- docs/03 §8: a reorder that only changes the DOM is silent to a screen
       reader. Polite, so it never interrupts the countdown milestones. -->
  <p class="tt-sr" role="status" aria-live="polite" data-testid="tt-queue-announce">
    {announcement}
  </p>
</aside>

{#if menu}
  <TtContextMenu
    items={menuItems}
    x={menu.x}
    y={menu.y}
    onselect={onMenuSelect}
    onclose={() => (menu = null)}
  />
{/if}

<style>
  /*
   * FLEX column, not grid — and that is load-bearing rather than taste.
   *
   * As a grid this panel had `align-content: start` and implicit `auto` rows,
   * and an `auto` track sizes to its content: the container's `max-height` caps
   * the BOX while the track keeps growing, so a long queue painted straight
   * through the border, over the bottom bar and off the screen. `min-height: 0`
   * on the list does not help there, because nothing was ever asking the track
   * to be smaller.
   *
   * In a height-constrained flex column the free space really is negative, so a
   * shrinkable item with `min-height: 0` gives way — which is what makes the
   * list's own `overflow-y: auto` fire.
   */
  .tt-rail {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    /* A fixed column on the stage, so the countdown's cap can be computed from
       what is left over (docs/03 §4). Harmless in `setup`, where `.tt-in-setup`
       overrides the width and the parent is not a flex row. */
    flex: none;
    width: 17rem;
    max-height: 60vh;
    padding: 0.9rem;
    background: color-mix(in srgb, var(--color-tt-surface) 80%, transparent);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.5rem;
    /* Backstop. The list scrolls itself; a future child that forgets to should
       be clipped by the border rather than escaping it the way this one did. */
    overflow: hidden;
  }
  /* Setup stacks this above the countdown inputs and Start, so it gets a much
     smaller budget — and a fixed one, because what has to stay on screen is the
     Start button, not a proportion of the viewport. */
  .tt-in-setup {
    width: 100%;
    max-height: 15rem;
  }
  /* Only the row list gives way. Without this the toggles and the totals footer
     are shrinkable too, and a long queue squashes them instead of scrolling. */
  .tt-badge,
  .tt-toggles,
  .tt-empty,
  .tt-totals,
  .tt-ended {
    flex: none;
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
    /*
     * `min-height: 0` is what lets this shrink at all: a flex item's automatic
     * minimum size is its CONTENT size, so without it the list refuses to give
     * way, `overflow-y` never fires, and 95 rows escape the panel. Reported
     * from the live app with a 24-track queue — every test before it used three
     * tracks and never reached the cap.
     */
    flex: 1 1 auto;
    min-height: 0;
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
  /* Visually hidden, still announced. Not `display: none`, which removes it
     from the accessibility tree and would silence the live region entirely. */
  .tt-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .tt-grip {
    padding: 0 0.15rem;
    font-size: 0.8rem;
    line-height: 1;
    color: var(--color-tt-muted);
    background: transparent;
    border: none;
    cursor: grab;
    touch-action: none;
  }
  .tt-grip:hover {
    color: var(--color-tt-signal);
  }
  .tt-dragging {
    background: color-mix(in srgb, var(--color-tt-signal) 18%, transparent);
    cursor: grabbing;
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
