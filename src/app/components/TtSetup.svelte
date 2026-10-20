<script lang="ts">
  import TtDropZone from './TtDropZone.svelte';
  import { i18n } from '../state/i18n.svelte';
  import TtQueuePanel from './TtQueuePanel.svelte';
  import TtToast from './TtToast.svelte';
  import { positionText, text } from '../engine/importer/tt-track-display';
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
  <!-- Two rack modules: what plays (left) and how long (right). Side by side so
       Setup fits a 1280×720 window under the countdown preview — stacked, it
       scrolled on common laptop screens. -->
  <div class="tt-module tt-source">
    <h2 class="tt-label tt-module-head">{i18n.t('setup.panel.source')}</h2>
    <!--
      docs/03 §3: all three tabs render; YouTube is disabled with a hint rather
      than hidden, so the shape of the finished app is visible and the absence
      reads as "not yet" instead of "not a feature". P3 unlocked Playlist.

      Switching mode never touches the queue — docs/03 §3: readiness is a
      predicate, so an invalid queue just re-disables Start with its reason shown.
    -->
    <div class="tt-seg tt-tabs" role="tablist" aria-label={i18n.t('setup.mode.label')}>
      <button
        role="tab"
        aria-selected={single}
        data-testid="tt-tab-single"
        onclick={() => session.setMode('single')}>{i18n.t('setup.mode.single')}</button
      >
      <button
        role="tab"
        aria-selected={playlist}
        data-testid="tt-tab-playlist"
        onclick={() => session.setMode('playlist')}>{i18n.t('setup.mode.playlist')}</button
      >
      <button
        role="tab"
        aria-selected={youtube}
        data-testid="tt-tab-youtube"
        onclick={() => session.setMode('youtube')}>{i18n.t('setup.mode.youtube')}</button
      >
    </div>

    <!--
      docs/06 §8 — the offline banner. Renders in the Setup column and never over
      Z4: `03 §2`'s carve-out applies to it like any other overlay.
    -->
    {#if !session.online}
      <p class="tt-offline" role="status" data-testid="tt-offline">
        {i18n.t('setup.offline.title')}{youtube
          ? i18n.t('setup.offline.youtube')
          : i18n.t('setup.offline.local')}
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
            class="tt-key tt-key-sm tt-retry"
            data-testid="tt-offline-retry"
            onclick={() => void session.recheckPending()}>{i18n.t('setup.offline.retry')}</button
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
          <span>{i18n.t('yt.setup.paste.label')}</span>
          <textarea
            bind:value={links}
            rows="4"
            class="tt-field"
            placeholder="https://www.youtube.com/watch?v=..."
            data-testid="tt-yt-input"></textarea>
        </label>
        <button
          class="tt-key"
          data-testid="tt-yt-add"
          disabled={session.importing || links.trim() === ''}
          onclick={() => {
            const text = links;
            links = '';
            void session.importLinks(text);
          }}>{i18n.t('yt.setup.paste.submit')}</button
        >
      </div>
    {:else}
      <TtDropZone
        busy={session.importing}
        multiple={!single}
        compact={session.queue.length > 0}
        ondrop={(dt) => void session.importDropped(dt)}
        onpick={(files) => void session.importPicked(files)}
      />
    {/if}

    {#if single}
      {#if track}
        <div class="tt-staged" data-testid="tt-staged">
          <div class="tt-staged-text">
            <!-- Hard invariant 5: missing text is `N/A`. This row used an em dash
                 for a missing artist — the one surface that bypassed `text()`. -->
            <strong>{text(track.title)}</strong>
            <span>{text(track.artist)} · {positionText(track.durationMs)}</span>
          </div>
          <button
            class="tt-key tt-key-sm tt-key-danger"
            data-testid="tt-remove-track"
            onclick={() => session.removeTrack(track.id)}>{i18n.t('setup.staged.remove')}</button
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
          aria-label={i18n.t('setup.progress.label')}
        ></progress>
        <span>
          {i18n.t('setup.progress.text', {
            done: session.progress.done,
            total: session.progress.total,
          })}
        </span>
      </div>
    {/if}

    {#if session.lastImport}
      <TtToast result={session.lastImport} ondismiss={() => session.dismissImport()} />
    {/if}
  </div>

  <div class="tt-module tt-timer">
    <h2 class="tt-label tt-module-head">{i18n.t('setup.panel.timer')}</h2>
    <div class="tt-countdown-input">
      <div class="tt-hms">
        <label>
          <span>{i18n.t('setup.countdown.hours')}</span>
          <input
            class="tt-field"
            type="number"
            min="0"
            max="24"
            value={hours}
            oninput={(e) => onchange(Number(e.currentTarget.value), minutes, seconds)}
          />
        </label>
        <label>
          <span>{i18n.t('setup.countdown.minutes')}</span>
          <input
            class="tt-field"
            type="number"
            min="0"
            max="59"
            value={minutes}
            oninput={(e) => onchange(hours, Number(e.currentTarget.value), seconds)}
          />
        </label>
        <label>
          <span>{i18n.t('setup.countdown.seconds')}</span>
          <input
            class="tt-field"
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
          <!-- The visible label is "5′"; the accessible one says what the unit is. -->
          <button
            class="tt-key tt-key-sm tt-preset"
            aria-label={i18n.t('setup.countdown.preset', { minutes: p })}
            onclick={() => setFromMs(p * 60_000)}>{p}′</button
          >
        {/each}
        <!-- docs/03 §3: disabled on an empty queue or any unknown duration, and
             one-shot — it does not recompute when the queue changes later.
             The title states WHY: one untagged file in a 95-track queue is enough
             to disable it, and a dead-looking button with no reason is the same
             defect as a silent fallback (docs/03 §2 totals footer). -->
        <button
          class="tt-key tt-key-sm tt-match"
          data-testid="tt-match-length"
          disabled={session.matchableMs === null}
          title={session.matchableMs === null ? i18n.t('setup.countdown.matchLocked') : ''}
          onclick={() => setFromMs(session.matchableMs ?? 0)}
          >{i18n.t('setup.countdown.match')}</button
        >
      </div>
    </div>

    <div class="tt-actions">
      <button class="tt-key tt-key-primary tt-start" disabled={!session.canStart} onclick={onstart}
        >{i18n.t('setup.start')}</button
      >
      {#if debug}
        <!-- docs/15 §S2: cases 4-7 are still unrun and the silent case is
             audio-free by definition, so the harness keeps a way past the queue
             predicate. Unreachable without ?ttdebug=1. -->
        <button class="tt-key tt-debug-btn" data-testid="tt-debug-start" onclick={ondebugstart}>
          Chỉ đồng hồ (S2)
        </button>
      {/if}
    </div>

    {#if !session.canStart}
      <p class="tt-why" data-testid="tt-start-hint">
        {#if !track}
          {single ? i18n.t('setup.hint.single') : i18n.t('setup.hint.playlist')}
        {:else if !session.countdownInRange}
          {i18n.t('setup.hint.range')}
        {:else if youtube && !session.online}
          {i18n.t('setup.hint.youtubeOffline')}
        {:else if single && session.queue.length > 1}
          <!-- Playlist → Single with several tracks staged. docs/03 §3 keeps the
               queue and says why, rather than truncating the user's work. -->
          {i18n.t('setup.hint.singleOnly')}
        {:else}
          {i18n.t('setup.hint.unplayable')}
        {/if}
      </p>
    {/if}
  </div>
</section>

<style>
  /* docs/03 §3 — two rack modules under the countdown preview. */
  .tt-setup {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 19rem;
    gap: var(--tt-space-4);
    align-items: start;
    width: min(60rem, 100%);
  }
  .tt-module {
    display: grid;
    gap: var(--tt-space-3);
    min-width: 0;
    padding: var(--tt-space-4);
    background-color: var(--color-tt-surface);
    border: 1px solid var(--color-tt-line);
    border-radius: var(--tt-radius-md);
    box-shadow: var(--tt-shadow-panel);
  }
  .tt-module-head {
    display: flex;
    gap: var(--tt-space-2);
    align-items: center;
    margin: 0;
  }
  /* An engraved rule after the label, like a panel legend. */
  .tt-module-head::after {
    flex: 1;
    height: 1px;
    content: '';
    background: var(--color-tt-line);
  }
  .tt-tabs {
    justify-self: start;
  }

  .tt-staged {
    display: flex;
    gap: var(--tt-space-3);
    align-items: center;
    padding: var(--tt-space-2) var(--tt-space-3);
    background: var(--color-tt-void);
    border: 1px solid var(--color-tt-line);
    border-radius: var(--tt-radius-sm);
    box-shadow: var(--tt-shadow-pressed);
  }
  .tt-staged-text {
    display: grid;
    min-width: 0;
    font-size: var(--tt-text-sm);
  }
  .tt-staged-text strong,
  .tt-staged-text span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tt-staged-text span {
    font-family: var(--font-mono);
    font-size: var(--tt-text-xs);
    color: var(--color-tt-muted);
  }
  .tt-staged .tt-key {
    margin-left: auto;
  }

  .tt-offline {
    display: flex;
    flex-wrap: wrap;
    gap: var(--tt-space-2);
    align-items: center;
    padding: var(--tt-space-2) var(--tt-space-3);
    font-size: var(--tt-text-xs);
    color: var(--color-tt-warn);
    background: color-mix(in srgb, var(--color-tt-warn) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-tt-warn) 60%, transparent);
    border-radius: var(--tt-radius-sm);
  }

  .tt-links {
    display: grid;
    gap: var(--tt-space-2);
    justify-items: end;
  }
  .tt-links label {
    display: grid;
    gap: var(--tt-space-1);
    width: 100%;
    font-size: var(--tt-text-xs);
    color: var(--color-tt-muted);
  }
  .tt-links textarea {
    width: 100%;
    min-height: 6rem;
    padding: var(--tt-space-2) var(--tt-space-3);
    font-size: var(--tt-text-xs);
    resize: vertical;
  }

  .tt-progress {
    display: flex;
    gap: var(--tt-space-2);
    align-items: center;
    font-family: var(--font-mono);
    font-size: var(--tt-text-xs);
    color: var(--color-tt-muted);
  }
  .tt-progress progress {
    flex: 1;
    height: 4px;
    accent-color: var(--color-tt-signal);
  }

  .tt-countdown-input {
    display: grid;
    gap: var(--tt-space-3);
  }
  .tt-hms {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--tt-space-2);
  }
  .tt-hms label {
    display: grid;
    gap: var(--tt-space-1);
  }
  .tt-hms span {
    font-family: var(--font-display);
    font-size: var(--tt-text-xs);
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-tt-muted);
  }
  .tt-hms input {
    width: 100%;
    text-align: center;
    font-size: var(--tt-text-lg);
    font-variant-numeric: tabular-nums;
  }
  .tt-presets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--tt-space-1);
  }
  .tt-preset {
    min-width: 2.75rem;
    font-family: var(--font-mono);
    letter-spacing: 0;
  }
  .tt-match {
    flex-basis: 100%;
  }

  .tt-actions {
    display: flex;
    gap: var(--tt-space-2);
  }
  .tt-start {
    flex: 1;
    min-height: 48px;
    font-size: var(--tt-text-base);
  }
  .tt-debug-btn {
    color: var(--color-tt-warn);
  }
  .tt-why {
    margin: 0;
    font-size: var(--tt-text-xs);
    color: var(--color-tt-muted);
  }
</style>
