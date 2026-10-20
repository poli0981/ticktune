<script lang="ts">
  import type { TtImportResult } from '../engine/importer/types';
  import { i18n, type TtKey } from '../state/i18n.svelte';

  /**
   * The import summary toast — docs/02 §4 ("Added 12 · Skipped 3") plus one row
   * per distinct rejection code.
   *
   * Every skip is surfaced, not just counted: docs/01 §2 principle 5 is "fail
   * visible, log everything", and a file that vanished with no explanation is
   * the thing that makes an importer feel broken.
   *
   * The `data-tt-code` attribute is how E2E asserts a specific rejection
   * without a Settings panel to read the log from. Codes are non-identifying by
   * construction (docs/12 §6), so exposing them is safe.
   */

  interface Props {
    result: TtImportResult;
    ondismiss: () => void;
  }

  const { result, ondismiss }: Props = $props();

  // Grouped by code: 40 files rejected for the same reason is one row saying
  // "×40", not forty rows the user has to scroll past.
  //
  // A plain object rather than a Map: `svelte/prefer-svelte-reactivity` flags a
  // mutable Map inside a component, and it is right to — a Map is not deeply
  // reactive in runes mode, so one used as state would silently fail to update.
  // Here it is local to a derivation, but the rule cannot know that, and the
  // object form is just as clear.
  /**
   * A code's message — docs/08 §3.1 files these as `toast.import.*`.
   *
   * The `Record<string, string>` of Vietnamese that stood here WAS a dictionary,
   * keyed by log code; moving it into the JSON removes a copy rather than adding
   * a layer. This is the app's one lookup that cannot be a literal — the code
   * arrives from the import pipeline at runtime — which is why `i18n.has` exists
   * and why these keys are listed as indirect callers in the key guard.
   *
   * A code with no filed key still gets a sentence, never its own id: docs/01 §2
   * principle 5, "a file that vanished with no reason is what makes an importer
   * feel broken".
   */
  function message(code: string): string {
    const key = `toast.import.${code}`;
    return i18n.has(key) ? i18n.t(key as TtKey) : i18n.t('toast.skipped');
  }

  const groups = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const s of [...result.skipped, ...result.notes]) {
      counts[s.code] = (counts[s.code] ?? 0) + 1;
    }
    return Object.entries(counts);
  });
</script>

<div class="tt-toast" role="status" data-testid="tt-toast">
  <p class="tt-summary">
    <span class="tt-led" data-on={result.added.length > 0} aria-hidden="true"></span>
    {i18n.t('toast.summary', { added: result.added.length, skipped: result.skipped.length })}
  </p>

  {#if groups.length}
    <ul>
      {#each groups as [code, count] (code)}
        <li data-tt-code={code}>
          <code>{code}</code>
          <span>{message(code)}</span>
          {#if count > 1}<span class="tt-count">×{count}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}

  <button class="tt-key tt-key-sm tt-dismiss" onclick={ondismiss} data-testid="tt-toast-dismiss"
    >{i18n.t('toast.dismiss')}</button
  >
</div>

<style>
  /* One row — lamp, summary, dismiss — with the per-code list under it. */
  .tt-toast {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--tt-space-2) var(--tt-space-3);
    align-items: center;
    padding: var(--tt-space-3) var(--tt-space-4);
    font-size: var(--tt-text-sm);
    background: var(--color-tt-void);
    border: 1px solid var(--color-tt-line);
    border-left: 3px solid var(--color-tt-signal);
    border-radius: var(--tt-radius-sm);
    box-shadow: var(--tt-shadow-pressed);
  }
  .tt-summary {
    display: flex;
    gap: var(--tt-space-2);
    align-items: center;
    margin: 0;
    font-weight: 600;
    color: var(--color-tt-text);
  }
  ul {
    display: grid;
    grid-column: 1 / -1;
    grid-row: 2;
    gap: var(--tt-space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    gap: var(--tt-space-2);
    align-items: baseline;
    font-size: var(--tt-text-xs);
    color: var(--color-tt-warn);
  }
  code {
    font-family: var(--font-mono);
    font-size: var(--tt-text-xs);
    color: var(--color-tt-muted);
  }
  .tt-count {
    margin-left: auto;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .tt-dismiss {
    grid-column: 2;
    grid-row: 1;
  }
</style>
