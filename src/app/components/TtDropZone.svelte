<script lang="ts">
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
    ondrop: (dt: DataTransfer) => void;
    onpick: (files: FileList | null) => void;
  }

  const { busy, multiple, ondrop, onpick }: Props = $props();

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
  <span class="tt-drop-text">
    {#if busy}
      Đang nhập…
    {:else}
      Kéo thả một tệp nhạc vào đây, hoặc bấm để chọn
    {/if}
  </span>
  <span class="tt-drop-hint">MP3 · M4A · AAC · FLAC · WAV · OGG · Opus · WebM — tối đa 10:02</span>
</label>

<style>
  .tt-drop {
    display: grid;
    justify-items: center;
    gap: 0.35rem;
    padding: 1.75rem 2rem;
    text-align: center;
    border: 1px dashed var(--color-tt-line);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: border-color var(--duration-tt-fast) var(--ease-tt);
  }
  .tt-drop:hover,
  .tt-drop:focus-within,
  .over {
    border-color: var(--color-tt-signal);
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
  .tt-drop-text {
    color: var(--color-tt-text);
    font-size: 0.9rem;
  }
  .tt-drop-hint {
    color: var(--color-tt-muted);
    font-size: 0.72rem;
  }
</style>
