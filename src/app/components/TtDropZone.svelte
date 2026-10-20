<script lang="ts">
  import TtIcon from './TtIcon.svelte';
  import { i18n } from '../state/i18n.svelte';
  import { TT_ACCEPT_ATTR } from '../engine/importer/tt-accept';

  /**
   * docs/03 §3 — the Setup drop zone and file picker.
   *
   * The `accept` attribute comes from the same module as the validator
   * (docs/02 §4 step 1), so the picker cannot advertise a format the pipeline
   * rejects, or hide one it would have taken.
   */

  interface Props {
    busy: boolean;
    /**
     * Playlist and YouTube modes only. Without it the picker takes exactly one
     * file, so a 95-file batch is unreachable through the button and
     * `setInputFiles` with several paths throws outright — the count cap in
     * docs/02 §4 step 0 would never be exercised from the UI at all.
     */
    multiple: boolean;
    /**
     * A one-line bay once the queue has tracks: the zone is still the way to
     * add more, but it no longer needs to be the biggest thing in Setup — at
     * full height it pushed a three-track queue past a 720 px window.
     */
    compact?: boolean;
    ondrop: (dt: DataTransfer) => void;
    onpick: (files: FileList | null) => void;
  }

  const { busy, multiple, compact = false, ondrop, onpick }: Props = $props();

  let over = $state(false);
  let input: HTMLInputElement;

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    over = false;
    if (e.dataTransfer) ondrop(e.dataTransfer);
  }
</script>

<!--
  A label wrapping the input, so clicking anywhere in the zone opens the picker
  and keyboard focus lands on a real control rather than a div with a role.
-->
<label
  class="tt-drop"
  class:over
  class:busy
  class:compact
  data-testid="tt-dropzone"
  ondragover={(e) => {
    e.preventDefault();
    over = true;
  }}
  ondragleave={() => (over = false)}
  ondrop={handleDrop}
>
  <input
    bind:this={input}
    type="file"
    accept={TT_ACCEPT_ATTR}
    {multiple}
    disabled={busy}
    data-testid="tt-file-input"
    onchange={(e) => {
      const el = e.currentTarget as HTMLInputElement;
      onpick(el.files);
      // Cleared so re-picking the SAME file fires `change` again — otherwise
      // "import, remove, import the same file" silently does nothing.
      el.value = '';
    }}
  />
  <!-- Translated since v1.1: these were Vietnamese literals that stayed
       Vietnamese in the English UI, and said "one file" in Playlist mode too. -->
  <span class="tt-drop-icon"><TtIcon name="import" size={26} /></span>
  <span class="tt-drop-text">
    {#if busy}
      {i18n.t('setup.drop.busy')}
    {:else if multiple}
      {i18n.t('setup.drop.multiple')}
    {:else}
      {i18n.t('setup.drop.single')}
    {/if}
  </span>
  {#if !compact}
    <span class="tt-drop-hint">{i18n.t('setup.drop.hint')}</span>
  {/if}
</label>

<style>
  .tt-drop {
    position: relative;
    display: grid;
    justify-items: center;
    gap: var(--tt-space-2);
    padding: var(--tt-space-6) var(--tt-space-5);
    text-align: center;
    cursor: pointer;
    background: var(--color-tt-void);
    border: 1px dashed var(--color-tt-outline);
    border-radius: var(--tt-radius-sm);
    box-shadow: var(--tt-shadow-pressed);
    transition:
      border-color var(--duration-tt-fast) var(--ease-tt),
      background-color var(--duration-tt-fast) var(--ease-tt);
  }
  .tt-drop:hover,
  .tt-drop:focus-within,
  .over {
    border-color: var(--color-tt-signal);
  }
  /* A file held over the bay: the slot lights. */
  .over {
    background: color-mix(in srgb, var(--color-tt-signal) 7%, var(--color-tt-void));
  }
  .compact {
    grid-auto-flow: column;
    gap: var(--tt-space-3);
    align-items: center;
    justify-content: center;
    padding: var(--tt-space-3) var(--tt-space-4);
  }
  .compact .tt-drop-text {
    font-size: var(--tt-text-sm);
  }
  .busy {
    cursor: progress;
    opacity: 0.6;
  }
  .tt-drop input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .tt-drop-icon {
    color: var(--color-tt-muted);
    transition: color var(--duration-tt-fast) var(--ease-tt);
  }
  .tt-drop:hover .tt-drop-icon,
  .over .tt-drop-icon {
    color: var(--color-tt-signal);
  }
  .tt-drop-text {
    font-family: var(--font-display);
    font-size: var(--tt-text-base);
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--color-tt-text);
  }
  .tt-drop-hint {
    font-size: var(--tt-text-xs);
    color: var(--color-tt-muted);
  }
</style>
