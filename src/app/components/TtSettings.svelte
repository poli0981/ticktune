<script lang="ts">
  import { i18n } from '../state/i18n.svelte';
  import { session } from '../state/session.svelte';
  import { settings } from '../state/settings.svelte';
  import { ttLog } from '../engine/log/tt-log';
  import type { TtLogEntry, TtLogLevel } from '../engine/log/types';
  import { TT_LEGAL_LINKS } from '../../lib/tt-legal-const';

  /**
   * docs/03 §6 — the ⚙ Settings panel.
   *
   * ## Seven groups, not nine
   *
   * `03 §6` lists nine. **Display and Visualizer are not rendered here at all**,
   * because their renderers ship in P5 slices 3 and 4 — and the same rule
   * removes crossfade and the loop-style selector from Audio while `15 §S4b` is
   * open. A control whose backing feature does not exist is precisely the defect
   * this file also fixes in `TtSingleRail`: an inert button, in production,
   * reading as finished work. The groups arrive with the features.
   *
   * ## A side sheet, and deliberately NOT modal
   *
   * `03 §2` forbids any overlay covering the YouTube player rect, which is what
   * a centred modal with a full-bleed backdrop does. So this is a left-anchored
   * sheet with no backdrop, capped by `--tt-yt-reserve` so it can never reach the
   * rail, and it carries **no `aria-modal`** — the page behind really does stay
   * interactive, and claiming otherwise to a screen reader would be a lie about
   * the same fact. `Esc` and a pointer press outside both close it.
   *
   * ## Every control here writes a field something already reads
   *
   * That is the P5 slice premise (`16 §P5`). `countdownSize` was the one field
   * with no reader at all, so `TtCountdown` gained one in the same change.
   */

  interface Props {
    onclose: () => void;
    /** Volume and mute must reach whichever engine is making sound (docs/03 §7). */
    onvolume: () => void;
    /** Reset returns the app to the legal gate — the shell owns that transition. */
    onreset: () => void;
  }

  const { onclose, onvolume, onreset }: Props = $props();

  const s = $derived(settings.current);

  let sheet: HTMLDivElement;
  let closeButton: HTMLButtonElement;

  /*
   * Focus moves in; putting it BACK is the shell's job, not this component's.
   *
   * `TtTrackInfo` captures `document.activeElement` and restores it, which is
   * right for a modal opened by a click. This panel also opens from the `S`
   * hotkey, where the active element is `<body>` and "restore the opener" means
   * dropping a keyboard user on nothing. The shell returns focus to ⚙ instead —
   * one rule for both entry paths, and ⚙ is the control carrying `aria-expanded`.
   */
  $effect(() => {
    closeButton?.focus();
  });

  // ── General ───────────────────────────────────────────────────────────────

  /**
   * Two steps, and the second one says what it will cost.
   *
   * `settings.reset()` deletes the row, so `legalAccepted` goes null and the
   * legal gate blocks at next boot. That is what "clears Dexie" means and it is
   * the honest behaviour — but nothing said so, and an unannounced re-block is
   * indistinguishable from the app having broken.
   */
  let resetArmed = $state(false);

  async function confirmReset() {
    await settings.reset();
    ttLog.info('TT-USR-101', 'settings reset to defaults');
    resetArmed = false;
    onreset();
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  let level = $state<TtLogLevel | 'all'>('all');
  let entries = $state<TtLogEntry[]>([]);
  /** Set when the clipboard refuses — the payload is shown to copy by hand. */
  let copyFallback = $state<string | null>(null);
  let copied = $state(false);

  /*
   * `ttLog.subscribe` has existed since P1 with no caller at all. This is it:
   * a viewer that only read the buffer on open would go stale in front of
   * someone watching for the entry they just triggered.
   */
  $effect(() => {
    const refresh = () => {
      entries = ttLog.entries(level === 'all' ? undefined : level);
    };
    refresh();
    return ttLog.subscribe(refresh);
  });

  const stamp = $derived(
    new Intl.DateTimeFormat(i18n.locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  );

  function diagnosticsJson(): string {
    return JSON.stringify(
      ttLog.diagnostics({
        version: __TT_VERSION__,
        ua: navigator.userAgent,
        mode: session.mode,
        // A runes proxy does not survive JSON round-trips predictably, and the
        // same snapshot rule the settings store needs for structured clone
        // applies here.
        settings: $state.snapshot(s) as unknown as Record<string, unknown>,
      }),
      null,
      2,
    );
  }

  async function copyDiagnostics() {
    const payload = diagnosticsJson();
    copied = false;
    copyFallback = null;
    try {
      await navigator.clipboard.writeText(payload);
      copied = true;
    } catch {
      // Clipboard permission is not ours to assume. Failing silently would look
      // exactly like succeeding, so the payload is offered instead.
      copyFallback = payload;
    }
  }

  function clearLog() {
    ttLog.clear();
    entries = [];
  }

  // ── shell interaction ─────────────────────────────────────────────────────

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onclose();
  }

  function onPointerDown(e: PointerEvent) {
    if (!sheet.contains(e.target as Node)) onclose();
  }

  /** Patch + persist, then push the level at whatever is making sound. */
  function setVolume(volume: number) {
    void settings.patch({ volume }).then(onvolume);
  }
</script>

<svelte:window on:keydown={onKeydown} on:pointerdown={onPointerDown} />

<div
  bind:this={sheet}
  class="tt-sheet"
  role="dialog"
  aria-label={i18n.t('settings.title')}
  data-testid="tt-settings"
>
  <header>
    <h2>{i18n.t('settings.title')}</h2>
    <button
      bind:this={closeButton}
      class="tt-x"
      data-testid="tt-settings-close"
      aria-label={i18n.t('settings.close')}
      onclick={onclose}>✕</button
    >
  </header>

  <!-- ── General ───────────────────────────────────────────────────────── -->
  <section data-testid="tt-set-general">
    <h3>{i18n.t('settings.group.general')}</h3>

    <div class="tt-row">
      <span>{i18n.t('settings.general.lang')}</span>
      <div class="tt-seg" role="group" aria-label={i18n.t('settings.general.lang')}>
        <button
          class="tt-opt"
          class:tt-on={i18n.lang === 'vi'}
          aria-pressed={i18n.lang === 'vi'}
          lang="vi"
          data-testid="tt-set-lang-vi"
          onclick={() => {
            i18n.setLang('vi');
            void settings.patch({ lang: 'vi' });
          }}>Tiếng Việt</button
        >
        <button
          class="tt-opt"
          class:tt-on={i18n.lang === 'en'}
          aria-pressed={i18n.lang === 'en'}
          lang="en"
          data-testid="tt-set-lang-en"
          onclick={() => {
            i18n.setLang('en');
            void settings.patch({ lang: 'en' });
          }}>English</button
        >
      </div>
    </div>

    <div class="tt-row">
      <span>{i18n.t('settings.general.legal')}</span>
      <div class="tt-links">
        <a href={TT_LEGAL_LINKS.eula} target="_blank" rel="noopener noreferrer"
          >{i18n.t('gate.link.eula')}</a
        >
        <a href={TT_LEGAL_LINKS.disclaimer} target="_blank" rel="noopener noreferrer"
          >{i18n.t('gate.link.disclaimer')}</a
        >
        <a href={TT_LEGAL_LINKS.privacy} target="_blank" rel="noopener noreferrer"
          >{i18n.t('gate.link.privacy')}</a
        >
      </div>
    </div>

    <div class="tt-reset">
      {#if !resetArmed}
        <button class="tt-danger-btn" data-testid="tt-set-reset" onclick={() => (resetArmed = true)}
          >{i18n.t('settings.general.reset')}</button
        >
        <p class="tt-note">{i18n.t('settings.general.resetHint')}</p>
      {:else}
        <p class="tt-warn" role="alert" data-testid="tt-set-reset-warning">
          {i18n.t('settings.general.resetConfirm')}
        </p>
        <div class="tt-confirm">
          <button
            class="tt-danger-btn"
            data-testid="tt-set-reset-yes"
            onclick={() => void confirmReset()}>{i18n.t('settings.general.resetYes')}</button
          >
          <button data-testid="tt-set-reset-no" onclick={() => (resetArmed = false)}
            >{i18n.t('settings.general.resetNo')}</button
          >
        </div>
      {/if}
    </div>
  </section>

  <!-- ── Countdown ─────────────────────────────────────────────────────── -->
  <section data-testid="tt-set-countdown">
    <h3>{i18n.t('settings.group.countdown')}</h3>

    <label class="tt-row">
      <span>{i18n.t('settings.countdown.glow')}</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        data-testid="tt-set-glow"
        value={s.glowIntensity}
        oninput={(e) => void settings.patch({ glowIntensity: e.currentTarget.valueAsNumber })}
      />
    </label>

    <div class="tt-row">
      <span>{i18n.t('settings.countdown.size')}</span>
      <div class="tt-seg" role="group" aria-label={i18n.t('settings.countdown.size')}>
        <button
          class="tt-opt"
          class:tt-on={s.countdownSize === 's'}
          aria-pressed={s.countdownSize === 's'}
          data-testid="tt-set-size-s"
          onclick={() => void settings.patch({ countdownSize: 's' })}
          >{i18n.t('settings.countdown.sizeS')}</button
        >
        <button
          class="tt-opt"
          class:tt-on={s.countdownSize === 'm'}
          aria-pressed={s.countdownSize === 'm'}
          data-testid="tt-set-size-m"
          onclick={() => void settings.patch({ countdownSize: 'm' })}
          >{i18n.t('settings.countdown.sizeM')}</button
        >
        <button
          class="tt-opt"
          class:tt-on={s.countdownSize === 'l'}
          aria-pressed={s.countdownSize === 'l'}
          data-testid="tt-set-size-l"
          onclick={() => void settings.patch({ countdownSize: 'l' })}
          >{i18n.t('settings.countdown.sizeL')}</button
        >
      </div>
    </div>

    <h4>{i18n.t('settings.countdown.end')}</h4>

    <label class="tt-row">
      <span>{i18n.t('settings.countdown.endFade')}</span>
      <span class="tt-with-value">
        <input
          type="range"
          min="0"
          max="5000"
          step="250"
          data-testid="tt-set-endfade"
          value={s.endFadeMs}
          oninput={(e) => void settings.patch({ endFadeMs: e.currentTarget.valueAsNumber })}
        />
        <output data-testid="tt-set-endfade-value"
          >{i18n.t('settings.countdown.endFadeValue', { seconds: (s.endFadeMs / 1000).toFixed(2) })}
        </output>
      </span>
    </label>

    <label class="tt-row tt-check">
      <input
        type="checkbox"
        data-testid="tt-set-endchime"
        checked={s.endChime}
        onchange={(e) => void settings.patch({ endChime: e.currentTarget.checked })}
      />
      <span>{i18n.t('settings.countdown.endChime')}</span>
    </label>

    <label class="tt-row tt-check">
      <input
        type="checkbox"
        data-testid="tt-set-endflash"
        checked={s.endFlash}
        onchange={(e) => void settings.patch({ endFlash: e.currentTarget.checked })}
      />
      <span>{i18n.t('settings.countdown.endFlash')}</span>
    </label>

    <div class="tt-row tt-stack">
      <span>{i18n.t('settings.countdown.endAction')}</span>
      <div class="tt-seg" role="group" aria-label={i18n.t('settings.countdown.endAction')}>
        <button
          class="tt-opt"
          class:tt-on={s.endAction === 'stay'}
          aria-pressed={s.endAction === 'stay'}
          data-testid="tt-set-endaction-stay"
          onclick={() => void settings.patch({ endAction: 'stay' })}
          >{i18n.t('settings.countdown.endActionStay')}</button
        >
        <button
          class="tt-opt"
          class:tt-on={s.endAction === 'restart'}
          aria-pressed={s.endAction === 'restart'}
          data-testid="tt-set-endaction-restart"
          onclick={() => void settings.patch({ endAction: 'restart' })}
          >{i18n.t('settings.countdown.endActionRestart')}</button
        >
        <button
          class="tt-opt"
          class:tt-on={s.endAction === 'loop'}
          aria-pressed={s.endAction === 'loop'}
          data-testid="tt-set-endaction-loop"
          onclick={() => void settings.patch({ endAction: 'loop' })}
          >{i18n.t('settings.countdown.endActionLoop')}</button
        >
      </div>
    </div>
  </section>

  <!-- ── Audio ─────────────────────────────────────────────────────────── -->
  <section data-testid="tt-set-audio">
    <h3>{i18n.t('settings.group.audio')}</h3>

    <label class="tt-row">
      <span>{i18n.t('settings.audio.volume')}</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        data-testid="tt-set-volume"
        value={s.volume}
        oninput={(e) => setVolume(e.currentTarget.valueAsNumber)}
      />
    </label>

    <label class="tt-row tt-check">
      <input
        type="checkbox"
        data-testid="tt-set-mute"
        checked={s.muted}
        onchange={(e) => void settings.patch({ muted: e.currentTarget.checked }).then(onvolume)}
      />
      <span>{i18n.t('settings.audio.mute')}</span>
    </label>

    <!--
      No crossfade slider and no loop-style selector: docs/15 §S4b is open, so
      neither has an implementation to drive. Saying so beats rendering two
      controls that would move a stored value nothing acts on.
    -->
    <p class="tt-note">{i18n.t('settings.audio.deferred')}</p>
  </section>

  <!-- ── Playback ──────────────────────────────────────────────────────── -->
  <section data-testid="tt-set-playback">
    <h3>{i18n.t('settings.group.playback')}</h3>

    <!--
      Shuffle and Repeat go through the SESSION, not straight to settings: the
      store patches the field and re-derives the play order in one place
      (docs/02 §5.1). Writing the field here would leave the order stale.
    -->
    <label class="tt-row tt-check">
      <input
        type="checkbox"
        data-testid="tt-set-shuffle"
        checked={s.shuffle}
        onchange={(e) => session.setShuffle(e.currentTarget.checked)}
      />
      <span>{i18n.t('settings.playback.shuffle')}</span>
    </label>

    <label class="tt-row tt-check">
      <input
        type="checkbox"
        data-testid="tt-set-repeat"
        checked={s.repeatPlaylist}
        onchange={(e) => session.setRepeat(e.currentTarget.checked)}
      />
      <span>{i18n.t('settings.playback.repeat')}</span>
    </label>

    <label class="tt-row tt-check">
      <input
        type="checkbox"
        data-testid="tt-set-duplicates"
        checked={s.allowDuplicates}
        onchange={(e) => void settings.patch({ allowDuplicates: e.currentTarget.checked })}
      />
      <span>{i18n.t('settings.playback.duplicates')}</span>
    </label>
    <p class="tt-note">{i18n.t('settings.playback.duplicatesHint')}</p>
  </section>

  <!-- ── Hotkeys ───────────────────────────────────────────────────────── -->
  <section data-testid="tt-set-hotkeys">
    <h3>{i18n.t('settings.group.hotkeys')}</h3>
    <!--
      Written out rather than mapped over an array, and that is a constraint
      rather than a style: the key guard in tests/unit/tt-i18n-keys.test.ts finds
      callers by grepping for literal `t('…')`, so a table built from a list
      would report eleven orphan keys and fail the build.
    -->
    <dl class="tt-keys">
      <dt><kbd>Space</kbd></dt>
      <dd>{i18n.t('settings.hotkeys.space')}</dd>
      <dt><kbd>←</kbd> <kbd>→</kbd></dt>
      <dd>{i18n.t('settings.hotkeys.arrows')}</dd>
      <dt><kbd>↑</kbd> <kbd>↓</kbd></dt>
      <dd>{i18n.t('settings.hotkeys.updown')}</dd>
      <dt><kbd>M</kbd></dt>
      <dd>{i18n.t('settings.hotkeys.m')}</dd>
      <dt><kbd>F</kbd></dt>
      <dd>{i18n.t('settings.hotkeys.f')}</dd>
      <dt><kbd>H</kbd></dt>
      <dd>{i18n.t('settings.hotkeys.h')}</dd>
      <dt><kbd>S</kbd></dt>
      <dd>{i18n.t('settings.hotkeys.s')}</dd>
      <dt><kbd>]</kbd></dt>
      <dd>{i18n.t('settings.hotkeys.bracket')}</dd>
      <dt><kbd>Esc</kbd></dt>
      <dd>{i18n.t('settings.hotkeys.esc')}</dd>
      <dt><kbd>Alt</kbd>+<kbd>↑</kbd><kbd>↓</kbd></dt>
      <dd>{i18n.t('settings.hotkeys.altUpDown')}</dd>
    </dl>
    <p class="tt-note">{i18n.t('settings.hotkeys.note')}</p>
  </section>

  <!-- ── Diagnostics ───────────────────────────────────────────────────── -->
  <section data-testid="tt-set-diagnostics">
    <h3>{i18n.t('settings.group.diagnostics')}</h3>

    <div class="tt-row">
      <span>{i18n.t('settings.diagnostics.level')}</span>
      <div class="tt-seg" role="group" aria-label={i18n.t('settings.diagnostics.level')}>
        <button
          class="tt-opt"
          class:tt-on={level === 'all'}
          aria-pressed={level === 'all'}
          data-testid="tt-set-log-all"
          onclick={() => (level = 'all')}>{i18n.t('settings.diagnostics.all')}</button
        >
        <button
          class="tt-opt"
          class:tt-on={level === 'info'}
          aria-pressed={level === 'info'}
          data-testid="tt-set-log-info"
          onclick={() => (level = 'info')}>{i18n.t('settings.diagnostics.info')}</button
        >
        <button
          class="tt-opt"
          class:tt-on={level === 'warn'}
          aria-pressed={level === 'warn'}
          data-testid="tt-set-log-warn"
          onclick={() => (level = 'warn')}>{i18n.t('settings.diagnostics.warn')}</button
        >
        <button
          class="tt-opt"
          class:tt-on={level === 'error'}
          aria-pressed={level === 'error'}
          data-testid="tt-set-log-error"
          onclick={() => (level = 'error')}>{i18n.t('settings.diagnostics.error')}</button
        >
      </div>
    </div>

    {#if entries.length === 0}
      <p class="tt-note" data-testid="tt-set-log-empty">{i18n.t('settings.diagnostics.empty')}</p>
    {:else}
      <ul class="tt-log" data-testid="tt-set-log">
        {#each entries as entry (entry.ts + entry.code + entry.message)}
          <li data-tt-level={entry.level}>
            <span class="tt-ts">{stamp.format(entry.ts)}</span>
            <code>{entry.code}</code>
            <span class="tt-msg">{entry.message}</span>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="tt-confirm">
      <button data-testid="tt-set-log-copy" onclick={() => void copyDiagnostics()}
        >{i18n.t('settings.diagnostics.copy')}</button
      >
      <button data-testid="tt-set-log-clear" onclick={clearLog}
        >{i18n.t('settings.diagnostics.clear')}</button
      >
    </div>
    {#if copied}
      <p class="tt-note" role="status" data-testid="tt-set-log-copied">
        {i18n.t('settings.diagnostics.copied')}
      </p>
    {/if}
    {#if copyFallback}
      <p class="tt-note" role="alert">{i18n.t('settings.diagnostics.copyFailed')}</p>
      <textarea class="tt-payload" readonly data-testid="tt-set-log-payload"
        >{copyFallback}</textarea
      >
    {/if}
    <p class="tt-note">{i18n.t('settings.diagnostics.privacy')}</p>
  </section>

  <!-- ── About ─────────────────────────────────────────────────────────── -->
  <section data-testid="tt-set-about">
    <h3>{i18n.t('settings.group.about')}</h3>
    <dl class="tt-about">
      <dt>{i18n.t('settings.about.version')}</dt>
      <!-- Injected from package.json by astro.config.mjs — one source (docs/14 §5). -->
      <dd data-testid="tt-set-version">{__TT_VERSION__}</dd>
      <dt>{i18n.t('settings.about.license')}</dt>
      <!-- An SPDX identifier, not prose: untranslated for the same reason
           `N/A` is (docs/08 §3). -->
      <dd>GPL-3.0-only</dd>
    </dl>
    <div class="tt-links">
      <a href={TT_LEGAL_LINKS.repo} target="_blank" rel="noopener noreferrer"
        >{i18n.t('settings.about.repo')}</a
      >
      <a href={TT_LEGAL_LINKS.thirdParty} target="_blank" rel="noopener noreferrer"
        >{i18n.t('settings.about.thirdParty')}</a
      >
    </div>
  </section>
</div>

<style>
  .tt-sheet {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 25;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    /*
     * Capped by the rail reserve — docs/03 §2's "any overlay must not cover the
     * player rect", enforced in CSS rather than by remembering. `--tt-yt-reserve`
     * is 0 unless a YouTube video is loaded.
     */
    width: min(26rem, calc(100vw - var(--tt-yt-reserve, 0px) - 2rem));
    height: 100dvh;
    padding: 1.1rem 1.25rem 2rem;
    overflow-y: auto;
    background: var(--color-tt-surface);
    border-right: 1px solid var(--color-tt-line);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  h2 {
    font-size: 0.95rem;
    letter-spacing: 0.04em;
    color: var(--color-tt-signal);
  }
  h3 {
    margin-bottom: 0.5rem;
    font-size: 0.68rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-tt-muted);
  }
  h4 {
    margin: 0.7rem 0 0.35rem;
    font-size: 0.72rem;
    color: var(--color-tt-text);
  }
  section {
    display: grid;
    gap: 0.4rem;
    font-size: 0.78rem;
  }
  section + section {
    padding-top: 1rem;
    border-top: 1px solid color-mix(in srgb, var(--color-tt-line) 70%, transparent);
  }

  .tt-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .tt-stack {
    flex-direction: column;
    align-items: stretch;
    gap: 0.35rem;
  }
  .tt-check {
    justify-content: flex-start;
    gap: 0.5rem;
  }
  .tt-with-value {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  output {
    min-width: 3.2rem;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--color-tt-muted);
    text-align: right;
  }

  .tt-seg {
    display: flex;
    gap: 0.25rem;
  }
  .tt-opt {
    padding: 0.22rem 0.55rem;
    font-size: 0.72rem;
    color: var(--color-tt-muted);
    background: transparent;
    border: 1px solid var(--color-tt-line);
    border-radius: 0.25rem;
  }
  .tt-on {
    color: var(--color-tt-signal);
    border-color: var(--color-tt-signal);
  }

  .tt-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    font-size: 0.74rem;
  }
  .tt-links a {
    color: var(--color-tt-signal);
    text-decoration: underline;
  }

  .tt-note {
    font-size: 0.68rem;
    line-height: 1.45;
    color: var(--color-tt-muted);
  }
  .tt-warn {
    font-size: 0.72rem;
    line-height: 1.45;
    color: var(--color-tt-warn);
  }
  .tt-reset {
    display: grid;
    gap: 0.35rem;
    margin-top: 0.5rem;
  }
  .tt-confirm {
    display: flex;
    gap: 0.4rem;
  }
  .tt-confirm button,
  .tt-x {
    padding: 0.28rem 0.7rem;
    font-size: 0.72rem;
    color: var(--color-tt-text);
    background: transparent;
    border: 1px solid var(--color-tt-line);
    border-radius: 0.25rem;
  }
  .tt-danger-btn {
    padding: 0.28rem 0.7rem;
    font-size: 0.72rem;
    color: var(--color-tt-danger);
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--color-tt-danger) 55%, transparent);
    border-radius: 0.25rem;
  }

  .tt-keys {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.25rem 0.8rem;
    font-size: 0.72rem;
  }
  .tt-keys dd {
    margin: 0;
    color: var(--color-tt-muted);
  }
  kbd {
    padding: 0.05rem 0.3rem;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    background: var(--color-tt-void);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.2rem;
  }

  .tt-log {
    display: grid;
    gap: 0.15rem;
    max-height: 12rem;
    overflow-y: auto;
    padding: 0.4rem;
    font-family: var(--font-mono);
    font-size: 0.66rem;
    background: var(--color-tt-void);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.25rem;
  }
  .tt-log li {
    display: flex;
    gap: 0.45rem;
  }
  .tt-log li[data-tt-level='warn'] code {
    color: var(--color-tt-warn);
  }
  .tt-log li[data-tt-level='error'] code {
    color: var(--color-tt-danger);
  }
  .tt-ts {
    color: var(--color-tt-muted);
  }
  .tt-msg {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tt-payload {
    width: 100%;
    height: 7rem;
    font-family: var(--font-mono);
    font-size: 0.62rem;
    background: var(--color-tt-void);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.25rem;
  }

  .tt-about {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.2rem 0.8rem;
    font-size: 0.74rem;
  }
  .tt-about dd {
    margin: 0;
    font-family: var(--font-mono);
    color: var(--color-tt-muted);
  }
</style>
