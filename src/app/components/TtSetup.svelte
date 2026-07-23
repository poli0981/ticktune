<script lang="ts">
  import TtDropZone from './TtDropZone.svelte';
  import TtQueuePanel from './TtQueuePanel.svelte';
  import TtToast from './TtToast.svelte';
  import { positionText } from '../engine/importer/tt-track-display';
  import type { TtTrack } from '../engine/importer/types';
  import { session } from '../state/session.svelte';
  import { settings } from '../state/settings.svelte';

  /**
   * docs/03 §3 item 3 — the Setup screen.
   *
   * Keeps the `giờ` / `phút` / `giây` labels and the `Bắt đầu` button name the
   * P1 shell used: five E2E tests address them, and renaming a control to no
   * benefit while migrating the tests that name it is how a rewrite loses
   * coverage without anyone noticing.
   */

  interface Props {
    hours: number;
    minutes: number;
    seconds: number;
    onchange: (h: number, m: number, s: number) => void;
    onstart: () => void;
    /** ?ttdebug=1 only — the docs/15 §S2 timer-only Start. */
    debug: boolean;
    ondebugstart: () => void;
    oninfo: (track: TtTrack) => void;
  }

  const { hours, minutes, seconds, onchange, onstart, debug, ondebugstart, oninfo }: Props =
    $props();

  /** docs/03 §3 — presets in MINUTES. The unit was never stated until P2. */
  const PRESETS = [5, 10, 15, 25, 30, 45, 60, 90];

  function setFromMs(ms: number) {
    const total = Math.floor(ms / 1000);
    onchange(Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60);
  }

  const track = $derived(session.current);
  const single = $derived(session.mode === 'single');
  const youtube = $derived(session.mode === 'youtube');
  const playlist = $derived(session.mode === 'playlist');

  /**
   * docs/06 §5 — the paste box. Local state, submitted explicitly.
   *
   * Not an `oninput` import: a partially typed URL is not a link the user has
   * asked us to fetch, and firing the oEmbed pre-check per keystroke would walk
   * straight into the rate limit the P4 exit criterion is about.
   */
  let links = $state('');
</script>

<section class="tt-setup" data-testid="tt-setup">
  <!--
    docs/03 §3: all three tabs render; YouTube is disabled with a hint rather
    than hidden, so the shape of the finished app is visible and the absence
    reads as "not yet" instead of "not a feature". P3 unlocked Playlist.

    Switching mode never touches the queue — docs/03 §3: readiness is a
    predicate, so an invalid queue just re-disables Start with its reason shown.
  -->
  <div class="tt-tabs" role="tablist" aria-label="Chế độ">
    <button
      role="tab"
      aria-selected={single}
      class="tt-tab"
      class:tt-tab-on={single}
      data-testid="tt-tab-single"
      onclick={() => session.setMode('single')}>Một bài</button
    >
    <button
      role="tab"
      aria-selected={playlist}
      class="tt-tab"
      class:tt-tab-on={playlist}
      data-testid="tt-tab-playlist"
      onclick={() => session.setMode('playlist')}>Danh sách</button
    >
    <button
      role="tab"
      aria-selected={youtube}
      class="tt-tab"
      class:tt-tab-on={youtube}
      data-testid="tt-tab-youtube"
      onclick={() => session.setMode('youtube')}>YouTube</button
    >
  </div>

  <!--
    docs/06 §8 — the offline banner. Renders in the Setup column and never over
    Z4: `03 §2`'s carve-out applies to it like any other overlay.
  -->
  {#if !session.online}
    <p class="tt-offline" role="status" data-testid="tt-offline">
      Mất kết nối mạng.{youtube
        ? ' Chế độ YouTube cần mạng để phát.'
        : ' Nhạc trong máy vẫn phát bình thường.'}
      <!--
        The way out, and it has to exist.

        The banner blocks Start (§8), and the re-check that would clear it runs
        just after Start — so on a machine whose `navigator.onLine` never flips,
        the evidence that would lift the banner could only be gathered by an
        action the banner forbids. Measured on the deployed v0.5.1: banner up,
        Start disabled, nothing able to change either.

        A poll is not the answer (§8 rejects it — the only endpoint worth
        probing is the one the rate limit guards), so the user says when to try.
      -->
      {#if youtube && session.hasPending}
        <button
          type="button"
          class="tt-retry"
          data-testid="tt-offline-retry"
          onclick={() => void session.recheckPending()}>Thử lại</button
        >
      {/if}
    </p>
  {/if}

  {#if youtube}
    <!--
      docs/06 §5. Sources do not mix, so YouTube mode shows a paste box and no
      drop zone at all — a queue is all-local or all-links, decided by the mode.
    -->
    <div class="tt-links">
      <label>
        <span>Dán link YouTube — mỗi dòng một link</span>
        <textarea
          bind:value={links}
          rows="4"
          placeholder="https://www.youtube.com/watch?v=..."
          data-testid="tt-yt-input"></textarea>
      </label>
      <button
        class="tt-btn"
        data-testid="tt-yt-add"
        disabled={session.importing || links.trim() === ''}
        onclick={() => {
          const text = links;
          links = '';
          void session.importLinks(text);
        }}>Thêm vào danh sách</button
      >
    </div>
  {:else}
    <TtDropZone
      busy={session.importing}
      multiple={!single}
      ondrop={(dt) => void session.importDropped(dt)}
      onpick={(files) => void session.importPicked(files)}
    />
  {/if}

  {#if single}
    {#if track}
      <div class="tt-staged" data-testid="tt-staged">
        <div class="tt-staged-text">
          <strong>{track.title}</strong>
          <span>{track.artist || '—'} · {positionText(track.durationMs)}</span>
        </div>
        <button
          class="tt-remove"
          data-testid="tt-remove-track"
          onclick={() => session.removeTrack(track.id)}>Bỏ</button
        >
      </div>
    {/if}
  {:else}
    <!-- Same component as the Z4 rail: one now-playing highlight, one totals
         footer, one place for either to be wrong (docs/03 §2). -->
    <TtQueuePanel
      variant="setup"
      tracks={session.queue}
      currentId={session.currentId}
      shuffle={settings.current.shuffle}
      repeat={settings.current.repeatPlaylist}
      exhausted={false}
      capped={!youtube}
      onremove={(id) => session.removeTrack(id)}
      onjump={() => undefined}
      onshuffle={(on) => session.setShuffle(on)}
      onrepeat={(on) => session.setRepeat(on)}
      onmove={(id, delta) => session.moveTrack(id, delta)}
      {oninfo}
    />
  {/if}

  <!--
    docs/02 §4's progress indicator, deferred out of P2 and landed here.

    The store decides whether it is worth showing at all (PROGRESS_DELAY_MS), so
    a one-file import renders nothing rather than flashing — which is the exact
    reason P2 chose to defer it instead of shipping a spinner.
  -->
  {#if session.progress}
    <div class="tt-progress" data-testid="tt-import-progress">
      <progress
        max={session.progress.total}
        value={session.progress.done}
        aria-label="Đang nhập tệp"
      ></progress>
      <span>Đang nhập {session.progress.done}/{session.progress.total}</span>
    </div>
  {/if}

  {#if session.lastImport}
    <TtToast result={session.lastImport} ondismiss={() => session.dismissImport()} />
  {/if}

  <div class="tt-countdown-input">
    <div class="tt-hms">
      <label>
        <span>giờ</span>
        <input
          type="number"
          min="0"
          max="24"
          value={hours}
          oninput={(e) => onchange(Number(e.currentTarget.value), minutes, seconds)}
        />
      </label>
      <label>
        <span>phút</span>
        <input
          type="number"
          min="0"
          max="59"
          value={minutes}
          oninput={(e) => onchange(hours, Number(e.currentTarget.value), seconds)}
        />
      </label>
      <label>
        <span>giây</span>
        <input
          type="number"
          min="0"
          max="59"
          value={seconds}
          oninput={(e) => onchange(hours, minutes, Number(e.currentTarget.value))}
        />
      </label>
    </div>

    <div class="tt-presets">
      {#each PRESETS as p (p)}
        <button class="tt-preset" onclick={() => setFromMs(p * 60_000)}>{p}′</button>
      {/each}
      <!-- docs/03 §3: disabled on an empty queue or any unknown duration, and
           one-shot — it does not recompute when the queue changes later.
           The title states WHY: one untagged file in a 95-track queue is enough
           to disable it, and a dead-looking button with no reason is the same
           defect as a silent fallback (docs/03 §2 totals footer). -->
      <button
        class="tt-preset tt-match"
        data-testid="tt-match-length"
        disabled={session.matchableMs === null}
        title={session.matchableMs === null
          ? 'Cần biết thời lượng của mọi bài trong danh sách'
          : ''}
        onclick={() => setFromMs(session.matchableMs ?? 0)}>Khớp độ dài</button
      >
    </div>
  </div>

  <div class="tt-actions">
    <button class="tt-btn" disabled={!session.canStart} onclick={onstart}>Bắt đầu</button>
    {#if debug}
      <!-- docs/15 §S2: cases 4-7 are still unrun and the silent case is
           audio-free by definition, so the harness keeps a way past the queue
           predicate. Unreachable without ?ttdebug=1. -->
      <button class="tt-btn tt-debug-btn" data-testid="tt-debug-start" onclick={ondebugstart}>
        Chỉ đồng hồ (S2)
      </button>
    {/if}
  </div>

  {#if !session.canStart}
    <p class="tt-why" data-testid="tt-start-hint">
      {#if !track}
        Chọn {single ? 'một tệp nhạc' : 'ít nhất một tệp nhạc'} để bắt đầu.
      {:else if !session.countdownInRange}
        Đếm ngược phải từ 1 giây đến 24 giờ.
      {:else if youtube && !session.online}
        Cần kết nối mạng để phát video YouTube.
      {:else if single && session.queue.length > 1}
        <!-- Playlist → Single with several tracks staged. docs/03 §3 keeps the
             queue and says why, rather than truncating the user's work. -->
        Chế độ Một bài chỉ nhận đúng một tệp — bỏ bớt hoặc quay lại Danh sách.
      {:else}
        Tệp đang chọn không phát được.
      {/if}
    </p>
  {/if}
</section>

<style>
  .tt-setup {
    display: grid;
    gap: 1rem;
    justify-items: center;
    width: min(34rem, 100%);
  }
  .tt-tabs {
    display: flex;
    gap: 0.35rem;
  }
  .tt-tab {
    padding: 0.35rem 0.9rem;
    font-size: 0.82rem;
    color: var(--color-tt-muted);
    background: transparent;
    border: 1px solid var(--color-tt-line);
    border-radius: 0.375rem;
  }
  .tt-tab-on {
    color: var(--color-tt-signal);
    border-color: var(--color-tt-signal);
  }
  .tt-tab:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .tt-staged {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: var(--color-tt-surface);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.375rem;
  }
  .tt-staged-text {
    display: grid;
    min-width: 0;
    font-size: 0.82rem;
  }
  .tt-staged-text strong,
  .tt-staged-text span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tt-staged-text span {
    color: var(--color-tt-muted);
    font-size: 0.74rem;
  }
  .tt-remove {
    margin-left: auto;
    padding: 0.2rem 0.6rem;
    color: var(--color-tt-danger);
    background: transparent;
    border: 1px solid var(--color-tt-line);
    border-radius: 0.25rem;
  }
  .tt-retry {
    margin-left: 0.5rem;
    padding: 0.1rem 0.5rem;
    font-size: 0.72rem;
    color: var(--color-tt-warn);
    background: transparent;
    border: 1px solid var(--color-tt-warn);
    border-radius: 0.25rem;
  }
  .tt-offline {
    width: 100%;
    padding: 0.35rem 0.6rem;
    font-size: 0.74rem;
    color: var(--color-tt-warn);
    border: 1px solid var(--color-tt-warn);
    border-radius: 0.25rem;
  }
  .tt-links {
    display: grid;
    gap: 0.5rem;
    justify-items: end;
    width: 100%;
  }
  .tt-links label {
    display: grid;
    gap: 0.25rem;
    width: 100%;
    font-size: 0.72rem;
    color: var(--color-tt-muted);
  }
  .tt-links textarea {
    width: 100%;
    padding: 0.5rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--color-tt-text);
    background: var(--color-tt-surface);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.25rem;
    resize: vertical;
  }
  .tt-progress {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    width: 100%;
    font-size: 0.72rem;
    color: var(--color-tt-muted);
  }
  .tt-progress progress {
    flex: 1;
    height: 0.35rem;
    accent-color: var(--color-tt-signal);
  }
  .tt-countdown-input {
    display: grid;
    gap: 0.6rem;
    justify-items: center;
  }
  .tt-hms {
    display: flex;
    gap: 0.5rem;
    align-items: end;
    font-family: var(--font-mono);
  }
  .tt-hms label {
    display: grid;
    gap: 0.25rem;
    justify-items: center;
  }
  .tt-hms span {
    color: var(--color-tt-muted);
    font-size: 0.7rem;
  }
  .tt-hms input {
    width: 4rem;
    padding: 0.25rem 0.5rem;
    text-align: center;
    background: var(--color-tt-surface);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.25rem;
  }
  .tt-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    justify-content: center;
  }
  .tt-preset {
    padding: 0.2rem 0.55rem;
    font-size: 0.75rem;
    color: var(--color-tt-muted);
    background: transparent;
    border: 1px solid var(--color-tt-line);
    border-radius: 0.25rem;
  }
  .tt-preset:hover:not(:disabled) {
    color: var(--color-tt-signal);
    border-color: var(--color-tt-signal);
  }
  .tt-preset:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .tt-actions {
    display: flex;
    gap: 0.6rem;
  }
  .tt-btn {
    padding: 0.5rem 1.5rem;
    font-weight: 500;
    color: var(--color-tt-signal);
    background: var(--color-tt-surface);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.375rem;
  }
  .tt-btn:hover:not(:disabled) {
    border-color: var(--color-tt-signal);
  }
  .tt-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .tt-debug-btn {
    color: var(--color-tt-warn);
  }
  .tt-why {
    color: var(--color-tt-muted);
    font-size: 0.75rem;
  }
</style>
