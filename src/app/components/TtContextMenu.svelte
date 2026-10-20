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

  import { i18n } from '../state/i18n.svelte';

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
  /** The item buttons, for roving focus. Index-aligned with `items`. */
  const buttons: HTMLButtonElement[] = $state([]);

  const enabled = $derived(items.filter((i) => !i.disabled));

  $effect(() => {
    // Start on the first item that can actually be chosen. Landing on a disabled
    // "Chuyển lên" at the top of the list would make the menu feel inert.
    const first = items.findIndex((i) => !i.disabled);
    active = first < 0 ? 0 : first;
  });

  /*
   * Real focus on the active item — roving focus, not a highlight class.
   *
   * The menu container used to hold focus while the arrows moved a CSS class,
   * so a screen reader heard "menu" and nothing else: the item a keyboard user
   * was about to activate was never announced. Moving DOM focus is what makes
   * `role="menuitem"` mean something.
   */
  $effect(() => {
    buttons[active]?.focus();
  });

  /*
   * "Click anywhere else closes the menu" — WITHOUT an element covering the page.
   *
   * 🔴 This used to be a full-viewport `position: fixed; inset: 0` backdrop. In
   * YouTube mode the menu opens from the queue directly under the player, and
   * that backdrop covered the player's rect for as long as the menu was open —
   * the exact overlay `docs/03 §2`'s carve-out forbids (the transparent layer
   * took every click meant for the player's own controls). yt-visibility never
   * sampled that moment, so nothing noticed.
   *
   * A capture-phase listener on the window does the same job with nothing on
   * screen: an outside pointerdown closes the menu and is swallowed, together
   * with the click that follows, so a stray click still cannot land on a queue
   * row underneath (a "×" on another row would otherwise remove a track). A
   * click INTO the YouTube iframe never reaches this window at all — it moves
   * focus to the frame, so `blur` closes the menu, and the player keeps the
   * click, which is what its terms require.
   */
  $effect(() => {
    const outside = (e: Event) => !(menu && e.target instanceof Node && menu.contains(e.target));
    const swallowClick = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!outside(e)) return;
      e.preventDefault();
      e.stopPropagation();
      window.addEventListener('click', swallowClick, { capture: true, once: true });
      onclose();
    };
    const onContextMenu = (e: MouseEvent) => {
      if (!outside(e)) return;
      e.preventDefault();
      e.stopPropagation();
      onclose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('blur', onclose);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('blur', onclose);
    };
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
    // The rendered box: 11rem wide; 32 px items, 4 px padding, 1 px border.
    const w = 11 * 16;
    const h = items.length * 32 + 10;
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

<div
  bind:this={menu}
  class="tt-menu"
  role="menu"
  tabindex="-1"
  aria-label={i18n.t('player.menu.label')}
  data-testid="tt-context-menu"
  style="left: {pos.left}px; top: {pos.top}px;"
  onkeydown={onKeydown}
>
  {#each items as item, i (item.id)}
    <button
      bind:this={buttons[i]}
      role="menuitem"
      tabindex={i === active ? 0 : -1}
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
  .tt-menu {
    position: fixed;
    z-index: var(--tt-z-popover);
    display: grid;
    min-width: 11rem;
    padding: var(--tt-space-1);
    background-color: var(--color-tt-surface-2);
    border: 1px solid var(--color-tt-outline);
    border-radius: var(--tt-radius-sm);
    box-shadow: 0 12px 32px rgb(0 0 0 / 55%);
  }
  .tt-menu:focus {
    outline: none;
  }
  .tt-item {
    min-height: 32px;
    padding: 0 var(--tt-space-3);
    font-size: var(--tt-text-sm);
    color: var(--color-tt-text);
    text-align: left;
    cursor: pointer;
    background: transparent;
    border: none;
    border-radius: var(--tt-radius-xs);
  }
  .tt-active:not(:disabled) {
    color: var(--color-tt-signal);
    background: color-mix(in srgb, var(--color-tt-signal) 12%, transparent);
  }
  .tt-danger {
    color: var(--color-tt-danger);
  }
  .tt-active.tt-danger:not(:disabled) {
    color: var(--color-tt-danger);
    background: color-mix(in srgb, var(--color-tt-danger) 12%, transparent);
  }
  .tt-item:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }
</style>
