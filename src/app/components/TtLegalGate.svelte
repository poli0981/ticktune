<script lang="ts">
  import { i18n } from '../state/i18n.svelte';
  import { ttLegalHref, TT_LEGAL_VERSION } from '../../lib/tt-legal-const';

  /**
   * Legal gate — docs/03 §3.2, docs/02 §1.
   *
   * Two jobs, and the second is easy to miss: it collects consent, **and its
   * Accept click is the user gesture that unlocks autoplay**. docs/05 §1 hangs
   * `AudioContext.resume()` off exactly this click, because it is the only
   * guaranteed gesture before playback. P2 drops that call into `onaccept`;
   * the seam exists now so P2 does not have to reopen this component.
   */

  interface Props {
    /** Called with the version the user accepted. */
    onaccept: (version: string) => void;
  }

  const { onaccept }: Props = $props();

  let agreed = $state(false);
  let dialog = $state<HTMLElement | null>(null);

  $effect(() => {
    // Focus lands inside the dialog, not on whatever was behind it (docs/03 §8).
    dialog?.querySelector<HTMLInputElement>('input')?.focus();
  });
</script>

<!--
  Blocking by construction: a fixed full-screen layer with nothing behind it
  reachable. role/aria-modal so assistive tech treats it as a dialog rather than
  as a region the user can escape by tabbing.
-->
<div
  class="tt-gate"
  role="dialog"
  aria-modal="true"
  aria-labelledby="tt-gate-title"
  bind:this={dialog}
>
  <div class="tt-gate-card">
    <!-- The power-on plate: the lamp, the name, the version being agreed to. -->
    <div class="tt-gate-plate">
      <span class="tt-gate-lamp" aria-hidden="true"></span>
      <h1 id="tt-gate-title">TickTune</h1>
      <span class="tt-gate-ver" aria-hidden="true">v{TT_LEGAL_VERSION}</span>
    </div>

    <p class="tt-gate-intro">{i18n.t('gate.intro')}</p>

    <ul class="tt-gate-points">
      <li>
        <strong>{i18n.t('gate.point.files')}</strong>{i18n.t('gate.point.filesRest')}
      </li>
      <!-- Disclosed where consent is actually given, not only in the policy. -->
      <li>
        <strong>{i18n.t('gate.point.analytics')}</strong>{i18n.t('gate.point.analyticsRest')}
      </li>
      <li>
        <strong>{i18n.t('gate.point.responsibility')}</strong>{i18n.t(
          'gate.point.responsibilityRest',
        )}
      </li>
      <li>
        <strong>{i18n.t('gate.point.youtube')}</strong>{i18n.t('gate.point.youtubeRest')}
      </li>
      <li>{i18n.t('gate.point.asIs')}</li>
    </ul>

    <p class="tt-gate-full">
      {i18n.t('gate.full')}
      <!--
        target="_blank" is deliberate and survives the move to on-site routes:
        leaving /app/ destroys the session-only queue (docs/02 §1), and this
        gate is shown before anything exists to lose only on a first run.
      -->
      <a href={ttLegalHref('eula', i18n.lang)} rel="noopener noreferrer" target="_blank"
        >{i18n.t('gate.link.eula')}</a
      >
      ·
      <a href={ttLegalHref('disclaimer', i18n.lang)} rel="noopener noreferrer" target="_blank"
        >{i18n.t('gate.link.disclaimer')}</a
      >
      ·
      <a href={ttLegalHref('privacy', i18n.lang)} rel="noopener noreferrer" target="_blank"
        >{i18n.t('gate.link.privacy')}</a
      >
      ·
      <a href={ttLegalHref('thirdParty', i18n.lang)} rel="noopener noreferrer" target="_blank"
        >{i18n.t('gate.link.thirdParty')}</a
      >
    </p>

    <label class="tt-gate-agree">
      <input type="checkbox" bind:checked={agreed} data-testid="tt-gate-agree" />
      <span>{i18n.t('gate.agree')}</span>
    </label>

    <button
      class="tt-key tt-key-primary tt-gate-accept"
      disabled={!agreed}
      data-testid="tt-gate-accept"
      onclick={() => onaccept(TT_LEGAL_VERSION)}
    >
      {i18n.t('gate.accept')}
    </button>

    <p class="tt-gate-stored">
      v{TT_LEGAL_VERSION} · {i18n.t('gate.stored')}
    </p>
  </div>
</div>

<style>
  .tt-gate {
    position: fixed;
    inset: 0;
    z-index: var(--tt-z-gate);
    display: grid;
    place-items: center;
    padding: var(--tt-space-5);
    background-color: color-mix(in srgb, var(--color-tt-void) 90%, transparent);
    background-image: var(--tt-grain);
    backdrop-filter: blur(6px);
  }
  .tt-gate-card {
    width: 100%;
    max-width: 35rem;
    /* Scrolls itself: `main` is inert behind the gate, so nothing else can. On
       a short window or at 200% zoom the Accept button used to sit below the
       viewport with no way to reach it — consent made impossible by layout. */
    max-height: calc(100dvh - 3rem);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--tt-space-6);
    background-color: var(--color-tt-surface);
    border: 1px solid var(--color-tt-outline);
    border-radius: var(--tt-radius-lg);
    box-shadow: var(--tt-shadow-panel);
  }
  .tt-gate-plate {
    display: flex;
    gap: var(--tt-space-3);
    align-items: center;
    margin-bottom: var(--tt-space-5);
    padding-bottom: var(--tt-space-4);
    border-bottom: 1px solid var(--color-tt-line);
  }
  /* The tally lamp, lit: the app is about to go on air. */
  .tt-gate-lamp {
    width: 10px;
    height: 10px;
    background: var(--color-tt-danger);
    border-radius: 50%;
    box-shadow: 0 0 10px var(--color-tt-danger);
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--tt-text-xl);
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .tt-gate-ver {
    margin-left: auto;
    padding: 2px var(--tt-space-2);
    font-family: var(--font-mono);
    font-size: var(--tt-text-xs);
    color: var(--color-tt-signal);
    border: 1px solid color-mix(in srgb, var(--color-tt-signal) 45%, transparent);
    border-radius: var(--tt-radius-xs);
  }
  .tt-gate-intro {
    margin: 0 0 var(--tt-space-4);
    font-size: var(--tt-text-base);
    line-height: 1.55;
  }
  .tt-gate-points {
    display: grid;
    gap: var(--tt-space-2);
    margin: 0 0 var(--tt-space-5);
    padding: 0;
    font-size: var(--tt-text-sm);
    line-height: 1.55;
    color: var(--color-tt-muted);
    list-style: none;
  }
  /* Each point carries an unlit amber LED — a checklist on a front panel. */
  .tt-gate-points li {
    position: relative;
    padding-left: var(--tt-space-5);
  }
  .tt-gate-points li::before {
    position: absolute;
    top: 0.55em;
    left: 2px;
    width: 6px;
    height: 6px;
    content: '';
    background: color-mix(in srgb, var(--color-tt-signal) 70%, var(--color-tt-void));
    border-radius: 50%;
  }
  .tt-gate-points strong {
    font-weight: 600;
    color: var(--color-tt-text);
  }
  .tt-gate-full {
    margin: 0 0 var(--tt-space-5);
    font-size: var(--tt-text-xs);
    line-height: 1.7;
    color: var(--color-tt-muted);
  }
  .tt-gate a {
    color: var(--color-tt-signal);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .tt-gate-agree {
    display: flex;
    gap: var(--tt-space-3);
    align-items: flex-start;
    margin-bottom: var(--tt-space-4);
    padding: var(--tt-space-3);
    font-size: var(--tt-text-sm);
    line-height: 1.5;
    cursor: pointer;
    background: var(--color-tt-void);
    border: 1px solid var(--color-tt-line);
    border-radius: var(--tt-radius-sm);
  }
  .tt-gate-agree input {
    flex: none;
    width: 18px;
    height: 18px;
    margin: 1px 0 0;
    cursor: pointer;
    accent-color: var(--color-tt-signal);
  }
  .tt-gate-accept {
    width: 100%;
    min-height: 48px;
    font-size: var(--tt-text-base);
  }
  .tt-gate-stored {
    margin: var(--tt-space-3) 0 0;
    font-family: var(--font-mono);
    font-size: var(--tt-text-xs);
    color: var(--color-tt-muted);
    text-align: center;
  }
</style>
