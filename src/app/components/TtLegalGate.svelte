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
    <div class="mb-4 flex items-center gap-2">
      <span class="bg-tt-danger inline-block size-2.5 rounded-full" aria-hidden="true"></span>
      <h1 id="tt-gate-title" class="text-lg font-semibold tracking-wide">TickTune</h1>
    </div>

    <p class="mb-3 text-sm">{i18n.t('gate.intro')}</p>

    <ul class="text-tt-muted mb-4 space-y-1.5 text-sm">
      <li>
        <strong class="text-tt-text">{i18n.t('gate.point.files')}</strong>{i18n.t(
          'gate.point.filesRest',
        )}
      </li>
      <li>
        <strong class="text-tt-text">{i18n.t('gate.point.responsibility')}</strong>{i18n.t(
          'gate.point.responsibilityRest',
        )}
      </li>
      <li>
        <strong class="text-tt-text">{i18n.t('gate.point.youtube')}</strong>{i18n.t(
          'gate.point.youtubeRest',
        )}
      </li>
      <li>{i18n.t('gate.point.asIs')}</li>
    </ul>

    <p class="text-tt-muted mb-4 text-xs">
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

    <label class="mb-4 flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" bind:checked={agreed} class="mt-0.5" data-testid="tt-gate-agree" />
      <span>{i18n.t('gate.agree')}</span>
    </label>

    <button
      class="tt-gate-accept"
      disabled={!agreed}
      data-testid="tt-gate-accept"
      onclick={() => onaccept(TT_LEGAL_VERSION)}
    >
      {i18n.t('gate.accept')}
    </button>

    <p class="text-tt-muted mt-3 text-center font-mono text-[10px]">
      v{TT_LEGAL_VERSION} · {i18n.t('gate.stored')}
    </p>
  </div>
</div>

<style>
  .tt-gate {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background: color-mix(in srgb, var(--color-tt-void) 88%, transparent);
    backdrop-filter: blur(6px);
  }
  .tt-gate-card {
    width: 100%;
    max-width: 34rem;
    padding: 1.75rem;
    background: var(--color-tt-surface);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.75rem;
  }
  .tt-gate a {
    color: var(--color-tt-signal);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .tt-gate-accept {
    width: 100%;
    padding: 0.6rem;
    font-weight: 500;
    color: var(--color-tt-signal);
    background: transparent;
    border: 1px solid var(--color-tt-line);
    border-radius: 0.375rem;
    transition: border-color var(--duration-tt-fast) var(--ease-tt);
  }
  .tt-gate-accept:hover:not(:disabled) {
    border-color: var(--color-tt-signal);
  }
  .tt-gate-accept:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
