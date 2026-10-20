<script lang="ts">
  import TtIcon from './TtIcon.svelte';
  import { backdrop } from '../state/backdrop.svelte';
  import { i18n } from '../state/i18n.svelte';
  import { session } from '../state/session.svelte';
  import { settings } from '../state/settings.svelte';
  import { gradientCss, gradientStops } from '../engine/visuals/tt-gradient';
  import { ttLog } from '../engine/log/tt-log';
  import type { TtLogEntry, TtLogLevel } from '../engine/log/types';
  import { TT_LEGAL_LINKS, ttLegalHref } from '../../lib/tt-legal-const';

  /**
   * docs/03 §6 — the ⚙ Settings panel.
   *
   * ## Nine groups — and a group ships WITH its feature, never before it
   *
   * Display arrived in P5 slice 3 in the same change as `TtBackdrop`, and
   * Visualizer in slice 4 with its renderer. The same rule still keeps crossfade
   * and the loop-style selector out of Audio while `15 §S4b` is open: a control
   * whose backing feature does not exist is precisely the defect fixed in
   * `TtSingleRail` — an inert button, in production, reading as finished work.
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
   * That is the P5 slice premise (`16 §P5`). Slice 2's `countdownSize` and
   * slice 3's eight Display fields had no reader at all until the change that
   * added their control — `TtCountdown` and `TtBackdrop` respectively.
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
  let head: HTMLElement;
  let closeButton: HTMLButtonElement;

  /**
   * The jump strip — nine groups in one scrolling sheet is a long way to wheel.
   *
   * Scrolls the SHEET rather than calling `scrollIntoView`, which would also
   * scroll every ancestor and has no notion of the sticky head: the group would
   * land underneath it. `scrollTo` with no `behavior` defers to the sheet's own
   * `scroll-behavior`, so reduced motion turns the glide into a jump in CSS.
   */
  function jump(group: string) {
    const target = sheet.querySelector<HTMLElement>(`[data-testid="tt-set-${group}"]`);
    if (target) sheet.scrollTo({ top: target.offsetTop - head.offsetHeight - 12 });
  }

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
    await settings.reset(navigator.language);
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

  /**
   * Edit one end of the custom gradient — docs/02 §3.1 stores it as a PAIR.
   *
   * Seeded from the active preset rather than from black, so moving one stop
   * produces a gradient related to what is already on screen instead of a jump
   * to a colour the user never chose. `clampSettings` rejects anything that is
   * not `#rrggbb`, and `<input type="color">` only ever emits that.
   */
  function setCustom(end: 0 | 1, value: string) {
    const base =
      settings.current.gradientCustom ?? gradientStops(settings.current.gradientPreset, null);
    const next: [string, string] = end === 0 ? [value, base[1]] : [base[0], value];
    void settings.patch({ gradientCustom: next });
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
  <header class="tt-head" bind:this={head}>
    <div class="tt-title">
      <h2>{i18n.t('settings.title')}</h2>
      <button
        bind:this={closeButton}
        class="tt-key tt-key-icon"
        data-testid="tt-settings-close"
        aria-label={i18n.t('settings.close')}
        onclick={onclose}><TtIcon name="close" /></button
      >
    </div>
    <!-- Written out, not mapped — the same key-guard rule as the hotkey table. -->
    <nav class="tt-jump" aria-label={i18n.t('settings.jump')}>
      <button onclick={() => jump('general')}>{i18n.t('settings.group.general')}</button>
      <button onclick={() => jump('display')}>{i18n.t('settings.group.display')}</button>
      <button onclick={() => jump('countdown')}>{i18n.t('settings.group.countdown')}</button>
      <button onclick={() => jump('visualizer')}>{i18n.t('settings.group.visualizer')}</button>
      <button onclick={() => jump('audio')}>{i18n.t('settings.group.audio')}</button>
      <button onclick={() => jump('playback')}>{i18n.t('settings.group.playback')}</button>
      <button onclick={() => jump('hotkeys')}>{i18n.t('settings.group.hotkeys')}</button>
      <button onclick={() => jump('diagnostics')}>{i18n.t('settings.group.diagnostics')}</button>
      <button onclick={() => jump('about')}>{i18n.t('settings.group.about')}</button>
    </nav>
  </header>

  <!-- ── General ───────────────────────────────────────────────────────── -->
  <section data-testid="tt-set-general">
    <h3>{i18n.t('settings.group.general')}</h3>

    <div class="tt-row">
      <span>{i18n.t('settings.general.lang')}</span>
      <div class="tt-seg" role="group" aria-label={i18n.t('settings.general.lang')}>
        <button
          aria-pressed={i18n.lang === 'vi'}
          lang="vi"
          data-testid="tt-set-lang-vi"
          onclick={() => {
            i18n.setLang('vi');
            void settings.patch({ lang: 'vi' });
          }}>Tiếng Việt</button
        >
        <button
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
      <!--
        ttLegalHref, not TT_LEGAL_LINKS: these now point at on-site routes and
        the EN reader needs the /en prefix. Reading i18n.lang inside the markup
        is also the subscription, so the hrefs re-derive when the language
        toggles — the same rule as `t()` (docs/08 §2).
      -->
      <div class="tt-links">
        <a href={ttLegalHref('eula', i18n.lang)} target="_blank" rel="noopener noreferrer"
          >{i18n.t('gate.link.eula')}</a
        >
        <a href={ttLegalHref('disclaimer', i18n.lang)} target="_blank" rel="noopener noreferrer"
          >{i18n.t('gate.link.disclaimer')}</a
        >
        <a href={ttLegalHref('privacy', i18n.lang)} target="_blank" rel="noopener noreferrer"
          >{i18n.t('gate.link.privacy')}</a
        >
      </div>
    </div>

    <div class="tt-reset">
      {#if !resetArmed}
        <button
          class="tt-key tt-key-sm tt-key-danger"
          data-testid="tt-set-reset"
          onclick={() => (resetArmed = true)}>{i18n.t('settings.general.reset')}</button
        >
        <p class="tt-note">{i18n.t('settings.general.resetHint')}</p>
      {:else}
        <p class="tt-warn" role="alert" data-testid="tt-set-reset-warning">
          {i18n.t('settings.general.resetConfirm')}
        </p>
        <div class="tt-confirm">
          <button
            class="tt-key tt-key-sm tt-key-danger"
            data-testid="tt-set-reset-yes"
            onclick={() => void confirmReset()}>{i18n.t('settings.general.resetYes')}</button
          >
          <button
            class="tt-key tt-key-sm"
            data-testid="tt-set-reset-no"
            onclick={() => (resetArmed = false)}>{i18n.t('settings.general.resetNo')}</button
          >
        </div>
      {/if}
    </div>
  </section>

  <!-- ── Display ───────────────────────────────────────────────────────── -->
  <section data-testid="tt-set-display">
    <h3>{i18n.t('settings.group.display')}</h3>

    <div class="tt-row tt-stack">
      <span>{i18n.t('settings.display.background')}</span>
      <div class="tt-seg tt-wrap" role="group" aria-label={i18n.t('settings.display.background')}>
        <button
          aria-pressed={s.background === 'solid'}
          data-testid="tt-set-bg-solid"
          onclick={() => void settings.patch({ background: 'solid' })}
          >{i18n.t('settings.display.bgSolid')}</button
        >
        <button
          aria-pressed={s.background === 'gradient'}
          data-testid="tt-set-bg-gradient"
          onclick={() => void settings.patch({ background: 'gradient' })}
          >{i18n.t('settings.display.bgGradient')}</button
        >
        <button
          aria-pressed={s.background === 'image'}
          data-testid="tt-set-bg-image"
          onclick={() => void settings.patch({ background: 'image' })}
          >{i18n.t('settings.display.bgImage')}</button
        >
        <button
          aria-pressed={s.background === 'slideshow'}
          data-testid="tt-set-bg-slideshow"
          onclick={() => void settings.patch({ background: 'slideshow' })}
          >{i18n.t('settings.display.bgSlideshow')}</button
        >
        <button
          aria-pressed={s.background === 'cover'}
          data-testid="tt-set-bg-cover"
          onclick={() => void settings.patch({ background: 'cover' })}
          >{i18n.t('settings.display.bgCover')}</button
        >
      </div>
    </div>

    {#if s.background === 'gradient'}
      <div class="tt-row tt-stack">
        <span>{i18n.t('settings.display.preset')}</span>
        <div class="tt-swatches" role="group" aria-label={i18n.t('settings.display.preset')}>
          <!--
            Written out rather than mapped, for the reason docs/08 §3.1 records:
            the key guard finds callers by grepping for a literal `t('…')`, and
            the six labels would otherwise be six orphans that fail the build.
          -->
          <button
            class="tt-swatch"
            aria-pressed={!s.gradientCustom && s.gradientPreset === 0}
            aria-label={i18n.t('settings.display.preset0')}
            style="background-image: {gradientCss(0)}"
            data-testid="tt-set-preset-0"
            onclick={() => void settings.patch({ gradientPreset: 0, gradientCustom: null })}
          ></button>
          <button
            class="tt-swatch"
            aria-pressed={!s.gradientCustom && s.gradientPreset === 1}
            aria-label={i18n.t('settings.display.preset1')}
            style="background-image: {gradientCss(1)}"
            data-testid="tt-set-preset-1"
            onclick={() => void settings.patch({ gradientPreset: 1, gradientCustom: null })}
          ></button>
          <button
            class="tt-swatch"
            aria-pressed={!s.gradientCustom && s.gradientPreset === 2}
            aria-label={i18n.t('settings.display.preset2')}
            style="background-image: {gradientCss(2)}"
            data-testid="tt-set-preset-2"
            onclick={() => void settings.patch({ gradientPreset: 2, gradientCustom: null })}
          ></button>
          <button
            class="tt-swatch"
            aria-pressed={!s.gradientCustom && s.gradientPreset === 3}
            aria-label={i18n.t('settings.display.preset3')}
            style="background-image: {gradientCss(3)}"
            data-testid="tt-set-preset-3"
            onclick={() => void settings.patch({ gradientPreset: 3, gradientCustom: null })}
          ></button>
          <button
            class="tt-swatch"
            aria-pressed={!s.gradientCustom && s.gradientPreset === 4}
            aria-label={i18n.t('settings.display.preset4')}
            style="background-image: {gradientCss(4)}"
            data-testid="tt-set-preset-4"
            onclick={() => void settings.patch({ gradientPreset: 4, gradientCustom: null })}
          ></button>
          <button
            class="tt-swatch"
            aria-pressed={!s.gradientCustom && s.gradientPreset === 5}
            aria-label={i18n.t('settings.display.preset5')}
            style="background-image: {gradientCss(5)}"
            data-testid="tt-set-preset-5"
            onclick={() => void settings.patch({ gradientPreset: 5, gradientCustom: null })}
          ></button>
        </div>
      </div>

      <div class="tt-row">
        <span>{i18n.t('settings.display.custom')}</span>
        <span class="tt-with-value">
          <input
            type="color"
            aria-label={i18n.t('settings.display.customFrom')}
            data-testid="tt-set-custom-from"
            value={s.gradientCustom?.[0] ?? gradientStops(s.gradientPreset, null)[0]}
            oninput={(e) => setCustom(0, e.currentTarget.value)}
          />
          <input
            type="color"
            aria-label={i18n.t('settings.display.customTo')}
            data-testid="tt-set-custom-to"
            value={s.gradientCustom?.[1] ?? gradientStops(s.gradientPreset, null)[1]}
            oninput={(e) => setCustom(1, e.currentTarget.value)}
          />
          {#if s.gradientCustom}
            <button
              class="tt-key tt-key-sm"
              data-testid="tt-set-custom-clear"
              onclick={() => void settings.patch({ gradientCustom: null })}
              >{i18n.t('settings.display.customClear')}</button
            >
          {/if}
        </span>
      </div>
    {/if}

    {#if s.background === 'image' || s.background === 'slideshow'}
      <div class="tt-row tt-stack">
        <span>{i18n.t('settings.display.pictures')}</span>
        <input
          type="file"
          accept="image/*"
          multiple={s.background === 'slideshow'}
          data-testid="tt-set-bg-files"
          onchange={(e) => {
            const files = e.currentTarget.files;
            if (files) backdrop.setImages([...files]);
          }}
        />
        <!--
          The honest empty state, and it is required rather than polite. Hard
          invariant 1 keeps these files in RAM only (docs/02 §3), so the CHOICE
          survives a reload and the pictures do not — leaving a user who
          selected a slideshow yesterday looking at a gradient today with no
          explanation. Z1 composites the gradient underneath anyway, so nothing
          is broken; only unexplained.
        -->
        {#if backdrop.images.length === 0}
          <p class="tt-note" data-testid="tt-set-bg-empty">
            {i18n.t('settings.display.picturesEmpty')}
          </p>
        {:else}
          <p class="tt-note" data-testid="tt-set-bg-count">
            {i18n.t('settings.display.picturesCount', { count: backdrop.images.length })}
          </p>
          <button
            class="tt-key tt-key-sm"
            data-testid="tt-set-bg-clear"
            onclick={() => backdrop.clearImages()}
            >{i18n.t('settings.display.picturesClear')}</button
          >
        {/if}
      </div>
    {/if}

    {#if s.background === 'slideshow'}
      <label class="tt-row">
        <span>{i18n.t('settings.display.interval')}</span>
        <span class="tt-with-value">
          <input
            class="tt-fader"
            type="range"
            min="5000"
            max="60000"
            step="1000"
            data-testid="tt-set-interval"
            value={s.slideshowIntervalMs}
            oninput={(e) =>
              void settings.patch({ slideshowIntervalMs: e.currentTarget.valueAsNumber })}
          />
          <output class="tt-readout" data-testid="tt-set-interval-value"
            >{i18n.t('settings.display.intervalValue', {
              seconds: Math.round(s.slideshowIntervalMs / 1000),
            })}</output
          >
        </span>
      </label>

      <div class="tt-row">
        <span>{i18n.t('settings.display.transition')}</span>
        <div class="tt-seg" role="group" aria-label={i18n.t('settings.display.transition')}>
          <button
            aria-pressed={s.slideshowTransition === 'fade'}
            data-testid="tt-set-xfade-fade"
            onclick={() => void settings.patch({ slideshowTransition: 'fade' })}
            >{i18n.t('settings.display.transitionFade')}</button
          >
          <button
            aria-pressed={s.slideshowTransition === 'kenburns'}
            data-testid="tt-set-xfade-kenburns"
            onclick={() => void settings.patch({ slideshowTransition: 'kenburns' })}
            >{i18n.t('settings.display.transitionKenBurns')}</button
          >
        </div>
      </div>
    {/if}

    <label class="tt-row">
      <span>{i18n.t('settings.display.scrim')}</span>
      <span class="tt-with-value">
        <input
          class="tt-fader"
          type="range"
          min="0.35"
          max="0.6"
          step="0.01"
          data-testid="tt-set-scrim"
          aria-valuetext={`${Math.round(s.scrimStrength * 100)}%`}
          value={s.scrimStrength}
          oninput={(e) => void settings.patch({ scrimStrength: e.currentTarget.valueAsNumber })}
        />
        <!-- The slider speaks its value (aria-valuetext); this is the visible half. -->
        <span class="tt-readout" aria-hidden="true">{Math.round(s.scrimStrength * 100)}%</span>
      </span>
    </label>

    <label class="tt-row tt-check">
      <input
        class="tt-switch"
        type="checkbox"
        data-testid="tt-set-scrimauto"
        checked={s.scrimAuto}
        onchange={(e) => void settings.patch({ scrimAuto: e.currentTarget.checked })}
      />
      <span>{i18n.t('settings.display.scrimAuto')}</span>
    </label>
    <p class="tt-note">{i18n.t('settings.display.scrimAutoHint')}</p>

    <label class="tt-row tt-check">
      <input
        class="tt-switch"
        type="checkbox"
        data-testid="tt-set-scanlines"
        checked={s.scanlines}
        onchange={(e) => void settings.patch({ scanlines: e.currentTarget.checked })}
      />
      <span>{i18n.t('settings.display.scanlines')}</span>
    </label>

    <label class="tt-row tt-check">
      <input
        class="tt-switch"
        type="checkbox"
        data-testid="tt-set-autotheme"
        checked={s.autoTheme}
        onchange={(e) => void settings.patch({ autoTheme: e.currentTarget.checked })}
      />
      <span>{i18n.t('settings.display.autoTheme')}</span>
    </label>
    <p class="tt-note">{i18n.t('settings.display.autoThemeHint')}</p>

    <label class="tt-row tt-check">
      <input
        class="tt-switch"
        type="checkbox"
        data-testid="tt-set-hidescrollbars"
        checked={s.hideScrollbars}
        onchange={(e) => void settings.patch({ hideScrollbars: e.currentTarget.checked })}
      />
      <span>{i18n.t('settings.display.hideScrollbars')}</span>
    </label>
    <p class="tt-note">{i18n.t('settings.display.hideScrollbarsHint')}</p>
  </section>

  <!-- ── Countdown ─────────────────────────────────────────────────────── -->
  <section data-testid="tt-set-countdown">
    <h3>{i18n.t('settings.group.countdown')}</h3>

    <label class="tt-row">
      <span>{i18n.t('settings.countdown.glow')}</span>
      <span class="tt-with-value">
        <input
          class="tt-fader"
          type="range"
          min="0"
          max="1"
          step="0.05"
          data-testid="tt-set-glow"
          aria-valuetext={`${Math.round(s.glowIntensity * 100)}%`}
          value={s.glowIntensity}
          oninput={(e) => void settings.patch({ glowIntensity: e.currentTarget.valueAsNumber })}
        />
        <span class="tt-readout" aria-hidden="true">{Math.round(s.glowIntensity * 100)}%</span>
      </span>
    </label>

    <div class="tt-row">
      <span>{i18n.t('settings.countdown.size')}</span>
      <div class="tt-seg" role="group" aria-label={i18n.t('settings.countdown.size')}>
        <button
          aria-pressed={s.countdownSize === 's'}
          data-testid="tt-set-size-s"
          onclick={() => void settings.patch({ countdownSize: 's' })}
          >{i18n.t('settings.countdown.sizeS')}</button
        >
        <button
          aria-pressed={s.countdownSize === 'm'}
          data-testid="tt-set-size-m"
          onclick={() => void settings.patch({ countdownSize: 'm' })}
          >{i18n.t('settings.countdown.sizeM')}</button
        >
        <button
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
          class="tt-fader"
          type="range"
          min="0"
          max="5000"
          step="250"
          data-testid="tt-set-endfade"
          value={s.endFadeMs}
          oninput={(e) => void settings.patch({ endFadeMs: e.currentTarget.valueAsNumber })}
        />
        <output class="tt-readout" data-testid="tt-set-endfade-value"
          >{i18n.t('settings.countdown.endFadeValue', { seconds: (s.endFadeMs / 1000).toFixed(2) })}
        </output>
      </span>
    </label>

    <label class="tt-row tt-check">
      <input
        class="tt-switch"
        type="checkbox"
        data-testid="tt-set-endchime"
        checked={s.endChime}
        onchange={(e) => void settings.patch({ endChime: e.currentTarget.checked })}
      />
      <span>{i18n.t('settings.countdown.endChime')}</span>
    </label>

    <label class="tt-row tt-check">
      <input
        class="tt-switch"
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
          aria-pressed={s.endAction === 'stay'}
          data-testid="tt-set-endaction-stay"
          onclick={() => void settings.patch({ endAction: 'stay' })}
          >{i18n.t('settings.countdown.endActionStay')}</button
        >
        <button
          aria-pressed={s.endAction === 'restart'}
          data-testid="tt-set-endaction-restart"
          onclick={() => void settings.patch({ endAction: 'restart' })}
          >{i18n.t('settings.countdown.endActionRestart')}</button
        >
        <button
          aria-pressed={s.endAction === 'loop'}
          data-testid="tt-set-endaction-loop"
          onclick={() => void settings.patch({ endAction: 'loop' })}
          >{i18n.t('settings.countdown.endActionLoop')}</button
        >
      </div>
    </div>
  </section>

  <!-- ── Visualizer ────────────────────────────────────────────────────── -->
  <section data-testid="tt-set-visualizer">
    <h3>{i18n.t('settings.group.visualizer')}</h3>

    <div class="tt-row tt-stack">
      <span>{i18n.t('settings.visualizer.style')}</span>
      <div class="tt-seg tt-wrap" role="group" aria-label={i18n.t('settings.visualizer.style')}>
        <button
          aria-pressed={s.visualizer === 'off'}
          data-testid="tt-set-viz-off"
          onclick={() => void settings.patch({ visualizer: 'off' })}
          >{i18n.t('settings.visualizer.off')}</button
        >
        <button
          aria-pressed={s.visualizer === 'bars'}
          data-testid="tt-set-viz-bars"
          onclick={() => void settings.patch({ visualizer: 'bars' })}
          >{i18n.t('settings.visualizer.bars')}</button
        >
        <button
          aria-pressed={s.visualizer === 'wave'}
          data-testid="tt-set-viz-wave"
          onclick={() => void settings.patch({ visualizer: 'wave' })}
          >{i18n.t('settings.visualizer.wave')}</button
        >
        <button
          aria-pressed={s.visualizer === 'ring'}
          data-testid="tt-set-viz-ring"
          onclick={() => void settings.patch({ visualizer: 'ring' })}
          >{i18n.t('settings.visualizer.ring')}</button
        >
      </div>
    </div>

    <label class="tt-row">
      <span>{i18n.t('settings.visualizer.sensitivity')}</span>
      <span class="tt-with-value">
        <input
          class="tt-fader"
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          data-testid="tt-set-viz-sensitivity"
          aria-valuetext={`${s.visualizerSensitivity.toFixed(1)}×`}
          value={s.visualizerSensitivity}
          oninput={(e) =>
            void settings.patch({ visualizerSensitivity: e.currentTarget.valueAsNumber })}
        />
        <span class="tt-readout" aria-hidden="true">{s.visualizerSensitivity.toFixed(1)}×</span>
      </span>
    </label>

    <!--
      Two limits stated rather than left to be discovered. The YouTube one is a
      platform fact (docs/05 §6: no Analyser on cross-origin media), and the
      tally line is what makes `off` a real choice rather than "no reaction at
      all" — the light keeps the beat either way.
    -->
    <p class="tt-note">{i18n.t('settings.visualizer.youtubeHint')}</p>
    <p class="tt-note">{i18n.t('settings.visualizer.tallyHint')}</p>
  </section>

  <!-- ── Audio ─────────────────────────────────────────────────────────── -->
  <section data-testid="tt-set-audio">
    <h3>{i18n.t('settings.group.audio')}</h3>

    <label class="tt-row">
      <span>{i18n.t('settings.audio.volume')}</span>
      <span class="tt-with-value">
        <input
          class="tt-fader"
          type="range"
          min="0"
          max="1"
          step="0.05"
          data-testid="tt-set-volume"
          aria-valuetext={`${Math.round(s.volume * 100)}%`}
          value={s.volume}
          oninput={(e) => setVolume(e.currentTarget.valueAsNumber)}
        />
        <span class="tt-readout" aria-hidden="true">{Math.round(s.volume * 100)}%</span>
      </span>
    </label>

    <label class="tt-row tt-check">
      <input
        class="tt-switch"
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
        class="tt-switch"
        type="checkbox"
        data-testid="tt-set-shuffle"
        checked={s.shuffle}
        onchange={(e) => session.setShuffle(e.currentTarget.checked)}
      />
      <span>{i18n.t('settings.playback.shuffle')}</span>
    </label>

    <label class="tt-row tt-check">
      <input
        class="tt-switch"
        type="checkbox"
        data-testid="tt-set-repeat"
        checked={s.repeatPlaylist}
        onchange={(e) => session.setRepeat(e.currentTarget.checked)}
      />
      <span>{i18n.t('settings.playback.repeat')}</span>
    </label>

    <label class="tt-row tt-check">
      <input
        class="tt-switch"
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
          aria-pressed={level === 'all'}
          data-testid="tt-set-log-all"
          onclick={() => (level = 'all')}>{i18n.t('settings.diagnostics.all')}</button
        >
        <button
          aria-pressed={level === 'info'}
          data-testid="tt-set-log-info"
          onclick={() => (level = 'info')}>{i18n.t('settings.diagnostics.info')}</button
        >
        <button
          aria-pressed={level === 'warn'}
          data-testid="tt-set-log-warn"
          onclick={() => (level = 'warn')}>{i18n.t('settings.diagnostics.warn')}</button
        >
        <button
          aria-pressed={level === 'error'}
          data-testid="tt-set-log-error"
          onclick={() => (level = 'error')}>{i18n.t('settings.diagnostics.error')}</button
        >
      </div>
    </div>

    {#if entries.length === 0}
      <p class="tt-note" data-testid="tt-set-log-empty">{i18n.t('settings.diagnostics.empty')}</p>
    {:else}
      <!--
        Focusable because it scrolls and nothing inside it can take focus: a
        keyboard user could otherwise never read past the twelfth entry (axe
        `scrollable-region-focusable`). Svelte's lint does not know that case.
      -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <ul
        class="tt-log tt-scroll-fade"
        data-testid="tt-set-log"
        tabindex="0"
        aria-label={i18n.t('settings.group.diagnostics')}
      >
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
      <button
        class="tt-key tt-key-sm"
        data-testid="tt-set-log-copy"
        onclick={() => void copyDiagnostics()}>{i18n.t('settings.diagnostics.copy')}</button
      >
      <button class="tt-key tt-key-sm" data-testid="tt-set-log-clear" onclick={clearLog}
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
      <textarea class="tt-field tt-payload" readonly data-testid="tt-set-log-payload"
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
      <!-- `repo` stays absolute — it is the GPL-3.0 §6 source offer. -->
      <a href={TT_LEGAL_LINKS.repo} target="_blank" rel="noopener noreferrer"
        >{i18n.t('settings.about.repo')}</a
      >
      <a href={ttLegalHref('thirdParty', i18n.lang)} target="_blank" rel="noopener noreferrer"
        >{i18n.t('settings.about.thirdParty')}</a
      >
    </div>
  </section>
</div>

<style>
  /*
   * docs/03 §6 — a patch bay: nine numbered modules down one side sheet, a
   * sticky head with the jump strip, and every control a hardware primitive
   * from global.css (`.tt-seg`, `.tt-switch`, `.tt-fader`, `.tt-key`).
   */
  .tt-sheet {
    position: fixed;
    top: 0;
    left: 0;
    z-index: var(--tt-z-sheet);
    display: flex;
    flex-direction: column;
    gap: var(--tt-space-3);
    /*
     * Capped by the rail reserve — docs/03 §2's "any overlay must not cover the
     * player rect", enforced in CSS rather than by remembering. `--tt-yt-reserve`
     * is 0 unless a YouTube video is loaded.
     */
    width: min(27rem, calc(100vw - var(--tt-yt-reserve, 0px) - 2rem));
    height: 100dvh;
    padding: 0 var(--tt-space-4) var(--tt-space-6);
    overflow-y: auto;
    overscroll-behavior: contain;
    scroll-behavior: smooth;
    counter-reset: tt-group;
    background-color: var(--color-tt-surface);
    border-right: 1px solid var(--color-tt-outline);
    box-shadow: 18px 0 48px rgb(0 0 0 / 55%);
  }
  /*
   * No entrance animation, on purpose. A slide moves the box a test measures
   * against the rail reserve, and a fade puts every label at partial opacity
   * for the first 400 ms — which axe measures as low contrast. The sheet
   * simply appears.
   */
  @media (prefers-reduced-motion: reduce) {
    .tt-sheet {
      scroll-behavior: auto;
    }
  }

  .tt-head {
    position: sticky;
    top: 0;
    z-index: 1;
    display: grid;
    gap: var(--tt-space-3);
    margin: 0 calc(-1 * var(--tt-space-4));
    padding: var(--tt-space-4) var(--tt-space-4) var(--tt-space-3);
    background: var(--color-tt-surface);
    border-bottom: 1px solid var(--color-tt-line);
  }
  .tt-title {
    display: flex;
    gap: var(--tt-space-4);
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--tt-text-lg);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-tt-signal);
  }
  .tt-jump {
    display: flex;
    flex-wrap: wrap;
    gap: var(--tt-space-1);
  }
  .tt-jump button {
    min-height: 26px;
    padding: 0 var(--tt-space-2);
    font-family: var(--font-display);
    font-size: var(--tt-text-xs);
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--color-tt-muted);
    cursor: pointer;
    background: var(--color-tt-void);
    border: 1px solid var(--color-tt-line);
    border-radius: var(--tt-radius-xs);
    transition:
      color var(--duration-tt-fast) var(--ease-tt),
      border-color var(--duration-tt-fast) var(--ease-tt);
  }
  .tt-jump button:hover {
    color: var(--color-tt-signal);
    border-color: var(--color-tt-signal);
  }

  /* A module: numbered legend, engraved rule, inset body. */
  section {
    display: grid;
    gap: var(--tt-space-2);
    padding: var(--tt-space-4);
    font-size: var(--tt-text-sm);
    counter-increment: tt-group;
    background: color-mix(in srgb, var(--color-tt-void) 55%, transparent);
    border: 1px solid var(--color-tt-line);
    border-radius: var(--tt-radius-md);
  }
  h3 {
    display: flex;
    gap: var(--tt-space-2);
    align-items: center;
    margin: 0 0 var(--tt-space-1);
    font-family: var(--font-display);
    font-size: var(--tt-text-xs);
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--color-tt-muted);
  }
  /* The module number is decoration: the `/ ""` alt text keeps it out of the
     heading's accessible name. */
  h3::before {
    font-family: var(--font-mono);
    letter-spacing: 0;
    color: var(--color-tt-signal);
    content: counter(tt-group, decimal-leading-zero) / '';
  }
  h3::after {
    flex: 1;
    height: 1px;
    content: '';
    background: var(--color-tt-line);
  }
  h4 {
    margin: var(--tt-space-3) 0 var(--tt-space-1);
    font-family: var(--font-display);
    font-size: var(--tt-text-xs);
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-tt-text);
  }

  .tt-row {
    display: flex;
    gap: var(--tt-space-4);
    align-items: center;
    justify-content: space-between;
    min-height: 36px;
  }
  .tt-stack {
    flex-direction: column;
    gap: var(--tt-space-2);
    align-items: stretch;
  }
  /* The switch sits at the right edge, where a panel's toggles line up; the
     markup keeps it first so the label still wraps the control. */
  .tt-check {
    flex-direction: row-reverse;
    cursor: pointer;
  }
  .tt-check span {
    flex: 1;
  }
  .tt-with-value {
    display: flex;
    gap: var(--tt-space-3);
    align-items: center;
  }
  .tt-with-value .tt-fader {
    width: 9rem;
  }
  .tt-readout {
    min-width: 3.5rem;
  }

  /* A strip long enough to wrap fills both rows rather than leaving the
     strip's seam colour showing where a key would be. */
  .tt-wrap {
    display: flex;
  }
  .tt-wrap > button {
    flex: 1 1 auto;
    justify-content: center;
  }
  .tt-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: var(--tt-space-2);
  }
  .tt-swatch {
    width: 2.75rem;
    height: 1.75rem;
    cursor: pointer;
    border: 1px solid var(--color-tt-outline);
    border-radius: var(--tt-radius-sm);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 40%);
  }
  .tt-swatch[aria-pressed='true'] {
    border-color: var(--color-tt-signal);
    box-shadow:
      inset 0 0 0 1px rgb(0 0 0 / 40%),
      0 0 0 2px var(--color-tt-signal);
  }
  input[type='color'] {
    width: 2.5rem;
    height: 1.75rem;
    padding: 2px;
    cursor: pointer;
    background: var(--color-tt-void);
    border: 1px solid var(--color-tt-outline);
    border-radius: var(--tt-radius-sm);
  }
  input[type='file'] {
    font-size: var(--tt-text-xs);
    color: var(--color-tt-muted);
  }
  input[type='file']::file-selector-button {
    min-height: 32px;
    margin-right: var(--tt-space-3);
    padding: 0 var(--tt-space-3);
    font-family: var(--font-display);
    font-size: var(--tt-text-xs);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-tt-text);
    cursor: pointer;
    background: var(--color-tt-surface-2);
    border: 1px solid var(--color-tt-outline);
    border-radius: var(--tt-radius-sm);
  }

  .tt-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--tt-space-1) var(--tt-space-4);
    font-size: var(--tt-text-sm);
  }
  .tt-links a {
    color: var(--color-tt-signal);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .tt-note {
    margin: 0;
    font-size: var(--tt-text-xs);
    line-height: 1.5;
    color: var(--color-tt-muted);
  }
  .tt-warn {
    margin: 0;
    font-size: var(--tt-text-sm);
    line-height: 1.5;
    color: var(--color-tt-warn);
  }
  .tt-reset {
    display: grid;
    gap: var(--tt-space-2);
    justify-items: start;
    margin-top: var(--tt-space-2);
  }
  .tt-confirm {
    display: flex;
    gap: var(--tt-space-2);
  }

  .tt-keys {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--tt-space-2) var(--tt-space-4);
    align-items: center;
    margin: 0;
    font-size: var(--tt-text-sm);
  }
  .tt-keys dt {
    display: flex;
    gap: 3px;
    align-items: center;
  }
  .tt-keys dd {
    margin: 0;
    color: var(--color-tt-muted);
  }
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 1.75rem;
    height: 1.6rem;
    padding: 0 var(--tt-space-1);
    font-family: var(--font-mono);
    font-size: var(--tt-text-xs);
    color: var(--color-tt-text);
    background: var(--color-tt-surface-2);
    border: 1px solid var(--color-tt-outline);
    border-radius: var(--tt-radius-xs);
    box-shadow: var(--tt-shadow-key);
  }

  .tt-log {
    display: grid;
    gap: 2px;
    max-height: 12rem;
    margin: 0;
    padding: var(--tt-space-2);
    overflow-y: auto;
    font-family: var(--font-mono);
    font-size: var(--tt-text-xs);
    list-style: none;
    background: var(--color-tt-void);
    border: 1px solid var(--color-tt-line);
    border-radius: var(--tt-radius-sm);
    box-shadow: var(--tt-shadow-pressed);
  }
  .tt-log li {
    display: flex;
    gap: var(--tt-space-2);
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
    padding: var(--tt-space-2);
    font-size: var(--tt-text-xs);
  }

  .tt-about {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--tt-space-1) var(--tt-space-4);
    margin: 0;
    font-size: var(--tt-text-sm);
  }
  .tt-about dd {
    margin: 0;
    font-family: var(--font-mono);
    color: var(--color-tt-signal);
  }
</style>
