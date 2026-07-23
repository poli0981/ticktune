<script lang="ts">
  import TtQueuePanel from './TtQueuePanel.svelte';
  import { i18n, type TtKey } from '../state/i18n.svelte';
  import { YT_HEIGHT, YT_WIDTH } from '../engine/youtube/tt-yt-player-driver';
  import type { TtYtOverlayState } from '../engine/youtube/tt-yt-player';
  import type { TtTrack } from '../engine/importer/types';

  /**
   * docs/03 §2 Z4, YouTube rail — player above, queue beneath.
   *
   * ## Why this is a third rail and not a branch inside the Playlist one
   *
   * `TtSingleRail` is 15rem and `TtQueuePanel` is 17rem — 240 and 272 px. The
   * player's slot is **384 px and not negotiable** (docs/06 §1.2: the ToS floor
   * is 200×200 and 16:9 was chosen so the native controls render fully). Bolting
   * the iframe into either would clip it, which is the exact failure spike S1
   * measured.
   *
   * ## The visibility carve-out is implemented here, not documented here
   *
   * docs/03 §2 says the `]` collapse is disabled and Focus keeps the rail while
   * a YouTube track plays, because docs/06 §1.2 forbids the player ever being
   * hidden or obscured. S1 measured what happens without it: a collapsed rail
   * left the player **0×0 under `display: none` with the audio still running**,
   * and Focus left it at **opacity 0.06, also still running**. Both are ToS
   * violations, and both are what the naive implementation does.
   *
   * So the collapse control is **not rendered** in this rail and Focus dims
   * everything *except* it — enforced in markup rather than by remembering,
   * which is what docs/03 §2 means by "enforced in the component".
   *
   * ⚠️ Do not verify this with `checkVisibility({ checkOpacity: true })`. S1
   * measured it returning **true** at opacity 0.06 — it only catches exactly 0.
   */

  interface Props {
    tracks: TtTrack[];
    currentId: string | null;
    shuffle: boolean;
    repeat: boolean;
    exhausted: boolean;
    /** docs/06 §4 — the typed card, rendered INSIDE the player area. */
    overlay: TtYtOverlayState | null;
    /** Seconds until the card skips itself, or null when nothing is counting. */
    skipInSeconds: number | null;
    /** True while Focus mode is on. The player stays; the queue does not. */
    focusMode: boolean;
    onmount: (el: HTMLElement) => void;
    onskip: () => void;
    onremove: (id: string) => void;
    onjump: (id: string) => void;
    onshuffle: (on: boolean) => void;
    onrepeat: (on: boolean) => void;
    oninfo: (track: TtTrack) => void;
    onmove: (id: string, delta: number) => void;
  }

  const {
    tracks,
    currentId,
    shuffle,
    repeat,
    exhausted,
    overlay,
    skipInSeconds,
    focusMode,
    onmount,
    onskip,
    onremove,
    onjump,
    onshuffle,
    onrepeat,
    oninfo,
    onmove,
  }: Props = $props();

  /*
   * The overlay's `key` IS the dictionary stem — `tt-yt-player.ts` has typed it
   * that way since P4 ("i18n key stem. Hardcoded VI until P5"). So the two
   * `Record` maps that stood here were a dictionary in disguise, and P5 deletes
   * them rather than translating them: one lookup, no second list to drift.
   *
   * These are the keys the guard lists as indirect callers — a stem plus a
   * suffix is not something a grep for `t('literal')` can see.
   */
  const title = $derived(overlay ? i18n.t(`${overlay.key}.title` as TtKey) : '');
  const cause = $derived(overlay ? i18n.t(`${overlay.key}.cause` as TtKey) : '');

  let mount = $state<HTMLDivElement | null>(null);
  $effect(() => {
    if (mount) onmount(mount);
  });
</script>

<aside class="tt-rail" class:tt-focus={focusMode} data-testid="tt-yt-rail">
  <div class="tt-badge">{i18n.t('player.badge.youtube')}</div>

  <!--
    The player slot. Fixed pixel size on purpose: docs/06 §1.2 is a ToS
    requirement, so it must not inherit a percentage that a future layout change
    could shrink below 200×200 without anyone noticing.
  -->
  <div
    class="tt-player"
    style="width: {YT_WIDTH}px; height: {YT_HEIGHT}px;"
    data-testid="tt-yt-player"
  >
    <div bind:this={mount}></div>

    {#if overlay}
      <!--
        docs/06 §4: a typed card INSIDE the player area. A routed page would
        break the running countdown, and an overlay elsewhere would leave a
        failed video looking like a frozen player.
      -->
      <div class="tt-overlay" role="alert" data-testid="tt-yt-overlay" data-tt-key={overlay.key}>
        <strong>{title}</strong>
        <p>{cause}</p>
        <!--
          docs/06 §4 lists FIVE parts and this was the missing one: without the
          countdown the card sat still and then vanished, which reads as the app
          losing its place rather than as a decision it announced.

          `aria-live` is off on purpose — the card itself is `role=alert`, so it
          is announced once on arrival; a per-second counter re-announcing would
          talk over the reason the user is trying to read.
        -->
        {#if skipInSeconds !== null}
          <p class="tt-skip-in" data-testid="tt-yt-skip-in">
            {i18n.t('yt.err.skipIn', { seconds: skipInSeconds })}
          </p>
        {/if}
        <button data-testid="tt-yt-skip" onclick={onskip}>{i18n.t('yt.err.skip')}</button>
        <!--
          `ambiguous` was declared with a paragraph of rationale, written on all
          four branches, and read by nothing — the coverArtUrl shape in
          miniature. It marks the one card whose cause genuinely cannot be
          narrowed (S1: age-restricted and region-blocked are identical from the
          outside), so it earns a mark the three definite ones do not get.
        -->
        <code data-tt-ambiguous={overlay.ambiguous ? '1' : null}>
          {overlay.code}{overlay.ambiguous ? i18n.t('yt.err.ambiguous') : ''}
        </code>
      </div>
    {/if}
  </div>

  <!--
    docs/03 §2's carve-out: Focus reduces the rail to the player alone. The queue
    goes, the player never does — and there is deliberately NO collapse control
    rendered in this rail at all, so the `]` affordance cannot reach it.
  -->
  {#if !focusMode}
    <div class="tt-queue">
      <TtQueuePanel
        variant="rail"
        capped={false}
        {tracks}
        {currentId}
        {shuffle}
        {repeat}
        {exhausted}
        {onremove}
        {onjump}
        {onshuffle}
        {onrepeat}
        {oninfo}
        {onmove}
      />
    </div>
  {/if}
</aside>

<style>
  .tt-rail {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    /* Wide enough for the mandatory 384 px player plus the rail's own padding.
       Never a percentage — see the markup note. */
    width: calc(384px + 1.8rem);
    max-height: 78vh;
    padding: 0.9rem;
    background: color-mix(in srgb, var(--color-tt-surface) 80%, transparent);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.5rem;
  }
  /*
   * Focus mode dims the rail's CHROME and never the player. The naive rule —
   * one opacity on the whole rail — is what S1 measured at 0.06 with the video
   * still playing, which is a ToS violation rather than a style choice.
   */
  .tt-focus .tt-badge {
    opacity: 0.25;
  }
  .tt-badge {
    flex: none;
    font-size: 0.66rem;
    letter-spacing: 0.14em;
    color: var(--color-tt-muted);
  }
  .tt-player {
    position: relative;
    flex: none;
    background: #000;
    border-radius: 0.25rem;
    overflow: hidden;
  }
  .tt-player :global(iframe) {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }
  .tt-overlay {
    position: absolute;
    inset: 0;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 0.35rem;
    padding: 1rem;
    text-align: center;
    background: color-mix(in srgb, var(--color-tt-void) 92%, transparent);
  }
  .tt-overlay strong {
    color: var(--color-tt-warn);
    font-size: 0.9rem;
  }
  .tt-overlay p {
    max-width: 22rem;
    font-size: 0.74rem;
    color: var(--color-tt-muted);
  }
  .tt-overlay button {
    padding: 0.25rem 0.8rem;
    font-size: 0.74rem;
    color: var(--color-tt-signal);
    background: transparent;
    border: 1px solid var(--color-tt-signal);
    border-radius: 0.25rem;
  }
  .tt-overlay code {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    color: var(--color-tt-muted);
  }
  .tt-skip-in {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    color: var(--color-tt-muted);
  }
  .tt-queue {
    display: flex;
    min-height: 0;
  }
  .tt-queue :global(.tt-rail) {
    width: 100%;
    max-height: none;
    background: transparent;
    border: none;
    padding: 0;
  }
</style>
