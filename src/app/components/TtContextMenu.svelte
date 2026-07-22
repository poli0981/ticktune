<script lang="ts">
  /**
   * The queue row's context menu — docs/02 §8.
   *
   * Its four items are named in the spec rather than invented here, because
   * docs/13 §2's reorder test and docs/13 §6's keyboard-only journey both need
   * a fixed target. Until P3 slice 2 this component did not exist and the row's
   * `contextmenu` went straight to the info modal — which was fine while there
   * was one action and stops being fine the moment reorder needs a home that is
   * reachable without knowing a hotkey.
   *
   * Keyboard is not an afterthought here: `Menu` / `Shift+F10` open it, arrows
   * move within it, `Esc` closes it, and focus returns to the row. Without that
   * the reorder affordance would be mouse-only, which docs/03 §8 forbids.
   */

  export interface TtMenuItem {
    /** Stable id, so a test names the ACTION rather than a Vietnamese label. */
    id: 'info' | 'up' | 'down' | 'remove';
    label: string;
    disabled?: boolean;
    danger?: boolean;
  }

  interface Props {
    items: TtMenuItem[];
    /** Viewport coordinates of the click, or of the focused row for keyboard. */
    x: number;
    y: number;
    onselect: (id: TtMenuItem['id']) => void;
    onclose: () => void;
  }

  const { items, x, y, onselect, onclose }: Props = $props();

  let menu = $state<HTMLDivElement | null>(null);
  let active = $state(0);

  const enabled = $derived(items.filter((i) => !i.disabled));

  $effect(() => {
    // Focus the first item that can actually be chosen. Landing on a disabled
    // "Chuyển lên" at the top of the list would make the menu feel inert.
    const first = items.findIndex((i) => !i.disabled);
    active = first < 0 ? 0 : first;
    menu?.focus();
  });

  /**
   * Keep the menu on screen.
   *
   * A right-click near the bottom or right edge would otherwise open a menu
   * that is partly unreachable — the same class of defect as the queue panel
   * overflowing its rail, and worth handling here rather than being surprised
   * by it on a small laptop.
   */
  const pos = $derived.by(() => {
    const w = 11 * 16;
    const h = items.length * 30 + 12;
    const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
    const vh = typeof window === 'undefined' ? 720 : window.innerHeight;
    return {
      left: Math.min(x, Math.max(0, vw - w - 8)),
      top: Math.min(y, Math.max(0, vh - h - 8)),
    };
  });

  function step(delta: number) {
    if (enabled.length === 0) return;
    let next = active;
    for (let i = 0; i < items.length; i += 1) {
      next = (next + delta + items.length) % items.length;
      if (!items[next]?.disabled) break;
    }
    active = next;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const item = items[active];
      if (item && !item.disabled) onselect(item.id);
    }
  }
</script>

<!--
  A full-viewport backdrop rather than a document-level listener: it makes
  "click anywhere else closes the menu" a rendering fact instead of a listener
  that has to be added and removed correctly, and it stops a stray click landing
  on a queue row underneath.
-->
<div
  class="tt-backdrop"
  role="presentation"
  onpointerdown={onclose}
  oncontextmenu={(e) => {
    e.preventDefault();
    onclose();
  }}
></div>

<div
  bind:this={menu}
  class="tt-menu"
  role="menu"
  tabindex="-1"
  aria-label="Tuỳ chọn bài"
  data-testid="tt-context-menu"
  style="left: {pos.left}px; top: {pos.top}px;"
  onkeydown={onKeydown}
>
  {#each items as item, i (item.id)}
    <button
      role="menuitem"
      class="tt-item"
      class:tt-active={i === active}
      class:tt-danger={item.danger}
      disabled={item.disabled}
      aria-disabled={item.disabled}
      data-testid="tt-menu-{item.id}"
      onpointerenter={() => {
        if (!item.disabled) active = i;
      }}
      onclick={() => onselect(item.id)}
    >
      {item.label}
    </button>
  {/each}
</div>

<style>
  .tt-backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
  }
  .tt-menu {
    position: fixed;
    z-index: 31;
    display: grid;
    min-width: 11rem;
    padding: 0.25rem;
    background: var(--color-tt-surface);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.375rem;
    box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
  }
  .tt-menu:focus {
    outline: none;
  }
  .tt-item {
    padding: 0.3rem 0.6rem;
    font-size: 0.78rem;
    color: var(--color-tt-text);
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 0.25rem;
  }
  .tt-active:not(:disabled) {
    color: var(--color-tt-signal);
    background: color-mix(in srgb, var(--color-tt-signal) 12%, transparent);
  }
  .tt-danger {
    color: var(--color-tt-danger);
  }
  .tt-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
