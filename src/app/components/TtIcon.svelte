<script lang="ts">
  /**
   * The keycap glyphs — docs/03 §1.
   *
   * Inline SVG rather than the emoji the transport used before v1.1: ⏮ ⏯ ⏭ 🔊 ⚙
   * render as colour emoji on Windows and as text glyphs elsewhere, so the same
   * button looked different on every OS and never like hardware. These are
   * drawn on one 24-unit grid, in `currentColor`, so a keycap's hover and
   * pressed colours reach them for free.
   *
   * Always decorative: the button carrying one owns the accessible name
   * (`aria-label`), so the icon is hidden from the accessibility tree.
   */
  type TtIconName =
    | 'prev'
    | 'play'
    | 'pause'
    | 'next'
    | 'stop'
    | 'volume'
    | 'mute'
    | 'settings'
    | 'fullscreen'
    | 'close'
    | 'import';

  const { name, size = 18 }: { name: TtIconName; size?: number } = $props();
</script>

<svg
  class="tt-icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
  focusable="false"
>
  {#if name === 'play'}
    <path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l10.6-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5Z" />
  {:else if name === 'pause'}
    <rect x="6" y="5" width="4.2" height="14" rx="1" />
    <rect x="13.8" y="5" width="4.2" height="14" rx="1" />
  {:else if name === 'stop'}
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  {:else if name === 'prev'}
    <rect x="5" y="5.5" width="2.6" height="13" rx="1" />
    <path d="M19 6.2v11.6a.6.6 0 0 1-.9.5l-9-5.8a.6.6 0 0 1 0-1l9-5.8a.6.6 0 0 1 .9.5Z" />
  {:else if name === 'next'}
    <rect x="16.4" y="5.5" width="2.6" height="13" rx="1" />
    <path d="M5 6.2v11.6a.6.6 0 0 0 .9.5l9-5.8a.6.6 0 0 0 0-1l-9-5.8a.6.6 0 0 0-.9.5Z" />
  {:else if name === 'volume' || name === 'mute'}
    <path
      d="M3.5 9.6c0-.5.4-.9.9-.9h3.2l4.3-3.6a.6.6 0 0 1 1 .5v12.8a.6.6 0 0 1-1 .5l-4.3-3.6H4.4a.9.9 0 0 1-.9-.9Z"
    />
    {#if name === 'volume'}
      <path
        d="M16 9.2a4 4 0 0 1 0 5.6M18.6 6.6a7.6 7.6 0 0 1 0 10.8"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    {:else}
      <path
        d="m16 9.5 5 5m0-5-5 5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    {/if}
  {:else if name === 'settings'}
    <!-- Three faders on a strip: the mixing-desk reading of "settings". -->
    <path
      d="M6 4v16M12 4v16M18 4v16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      opacity="0.55"
    />
    <rect x="3.6" y="13" width="4.8" height="3.4" rx="1" />
    <rect x="9.6" y="6.4" width="4.8" height="3.4" rx="1" />
    <rect x="15.6" y="10.6" width="4.8" height="3.4" rx="1" />
  {:else if name === 'fullscreen'}
    <path
      d="M4 9V4.8c0-.4.4-.8.8-.8H9M15 4h4.2c.4 0 .8.4.8.8V9M20 15v4.2c0 .4-.4.8-.8.8H15M9 20H4.8a.8.8 0 0 1-.8-.8V15"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else if name === 'import'}
    <!-- A tray with an arrow into it: the drop zone's loading bay. -->
    <path
      d="M12 3.5v10.5m0 0-4.2-4.2M12 14l4.2-4.2M4 13.5v5.2c0 .4.4.8.8.8h14.4c.4 0 .8-.4.8-.8v-5.2"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else if name === 'close'}
    <path
      d="m6.5 6.5 11 11m0-11-11 11"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
    />
  {/if}
</svg>

<style>
  .tt-icon {
    display: block;
    flex: none;
  }
</style>
