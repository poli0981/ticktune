<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import TtBottomBar from './components/TtBottomBar.svelte';
  import TtCountdown from './components/TtCountdown.svelte';
  import TtDebugPanel from './components/TtDebugPanel.svelte';
  import TtFinished from './components/TtFinished.svelte';
  import TtLegalGate from './components/TtLegalGate.svelte';
  import TtQueuePanel from './components/TtQueuePanel.svelte';
  import TtSetup from './components/TtSetup.svelte';
  import TtSingleRail from './components/TtSingleRail.svelte';
  import TtTrackInfo from './components/TtTrackInfo.svelte';
  import type { TtTrack } from './engine/importer/types';
  import { TtTimerDriver } from './engine/timer/tt-timer-driver';
  import type { TtTickSample } from './engine/timer/types';
  import { installGlobalCapture, ttLog } from './engine/log/tt-log';
  import { playback } from './state/playback.svelte';
  import { session } from './state/session.svelte';
  import { settings } from './state/settings.svelte';
  import { TT_LEGAL_VERSION } from '../lib/tt-legal-const';

  /**
   * The app shell. Setup, the queue and the player screens land in P2's later
   * slices (docs/16); today this is the countdown, the legal gate and the
   * Finished screen — and it doubles as the spike S2 harness under ?ttdebug=1
   * (docs/15 §S2).
   */

  /**
   * docs/02 §1 boot → gate → setup. `boot` must always reach one of the next two
   * states, so a settings failure downgrades to defaults rather than hanging
   * here (settings.load() never throws).
   */
  let booted = $state(false);
  const needsGate = $derived(session.state === 'gate');

  onMount(() => {
    const uninstall = installGlobalCapture(window);

    // docs/02 §5 — a track that plays to its end advances the queue. Wired here
    // rather than inside the playback store because "what plays next" is the
    // session's question, and docs/12 §3.3 keeps data flowing one way.
    playback.onEnded = onTrackEnded;

    void settings.load(navigator.language).then((s) => {
      // docs/03 §3: P3 unlocks Playlist, so the remembered mode is finally
      // honoured. P2 deliberately never wrote over it for exactly this moment.
      session.adoptMode(s.lastMode);
      const gate = s.legalAccepted?.version !== TT_LEGAL_VERSION;
      session.booted(gate);
      booted = true;
      // Boot is async (settings load), so "is the gate showing?" is unanswerable
      // until it completes. Publish the transition so tests — and anything else
      // that needs to know the app settled — can wait on it instead of racing.
      document.documentElement.dataset['ttBooted'] = gate ? 'gate' : 'ready';
    });
    return uninstall;
  });

  /**
   * docs/02 §1 / docs/05 §1: this click is the autoplay-unlock gesture.
   *
   * `unlock()` is fired FIRST and deliberately not awaited: WebKit only counts
   * a `resume()` reached before the gesture task yields, and the `await` below
   * yields. It is one of three unlock sites — the gate only renders when the
   * stored legal version differs, so a returning user reaches playback without
   * ever passing through here (docs/05 §1).
   */
  async function acceptLegal(version: string) {
    void playback.unlock();
    session.gateAccepted();
    await settings.patch({ legalAccepted: { version, acceptedAt: Date.now() } });
    ttLog.info('TT-USR-100', `legal accepted v${version}`);
  }

  let hours = $state(0);
  let minutes = $state(1);
  let seconds = $state(30);

  let remainingMs = $state(90_000);
  let phase = $state<'idle' | 'running' | 'paused' | 'done'>('idle');

  const durationMs = $derived((hours * 3600 + minutes * 60 + seconds) * 1000);
  // The session store owns the state machine AND the Start predicate (docs/02
  // §1); the inputs feed it, so `canStart` and what is on screen cannot
  // disagree. The range check lives in `isReady`, not here.
  $effect(() => {
    session.countdownMs = durationMs;
  });

  /**
   * While idle the digits preview whatever the inputs currently say, so the
   * format regime and colour are visible before committing to a run. Once the
   * timer owns the value we show its derived remainder — and `done` holds
   * 0.000 per docs/04 §4 rather than snapping back to the input.
   */
  const displayMs = $derived(phase === 'idle' ? durationMs : remainingMs);

  const debug =
    typeof location !== 'undefined' && new URLSearchParams(location.search).has('ttdebug');

  // Spike S2 state (docs/15 §S2). Only populated under ?ttdebug=1; a 90-minute
  // run at 200 ms would otherwise accumulate ~27k objects for nothing.
  let samples = $state<TtTickSample[]>([]);
  let doneInfo = $state<{ late: boolean; overshootMs: number } | null>(null);
  let logLines = $state<string[]>([]);

  // Display staleness, which is a DIFFERENT quantity from the worker tick
  // cadence: below 60 s the digits repaint every rAF frame, so the number the
  // user sees is far fresher than the 200 ms authoritative tick. S2's "visible
  // tab ≤ ±50 ms" is about this; its "±500 ms at done" is about the tick gap.
  // Split by visibility. A single global max is unreadable: rAF is deliberately
  // stopped while hidden (docs/04 §2), so the hidden figure is just the worker
  // cadence and would drown out the visible one that S2's ±50 ms bound is about.
  /** docs/03 §6 — two 120 ms pulses over Z1, suppressed by reduced motion. */
  let flashing = $state(false);
  /**
   * `endAction: 'restart'` re-runs ONCE (docs/02 §3.3); 'loop' is unbounded.
   *
   * Reset by every USER-initiated start, not just set once: "once" means once
   * per run the user asked for, not once per page load. Without the reset, a
   * user who runs, goes back to setup and starts again silently gets no
   * auto-restart the second time.
   */
  let autoRestarted = false;

  let maxRenderGapVisibleMs = $state(0);
  let maxRenderGapHiddenMs = $state(0);
  let lastRenderAt = 0;
  let lastRenderHidden = false;
  let runStartedAt = $state(0);
  let hiddenMs = $state(0);
  let lastHiddenAt = 0;
  let nowMs = $state(0);

  const driver = new TtTimerDriver({
    onRemaining: (ms) => {
      remainingMs = ms;
      phase = driver.phase;
      if (debug && driver.phase === 'running') {
        const t = performance.now();
        if (lastRenderAt) {
          const gap = t - lastRenderAt;
          // Attribute by EITHER endpoint, same as the tick-gap split: a stall
          // that accrued while hidden and was only observed after the tab came
          // back would otherwise be filed under "visible". The 2026-07-21
          // control run showed exactly that — a 30.9 s "visible" render gap
          // that was really the tail of a hidden stall.
          if (document.hidden || lastRenderHidden)
            maxRenderGapHiddenMs = Math.max(maxRenderGapHiddenMs, gap);
          else maxRenderGapVisibleMs = Math.max(maxRenderGapVisibleMs, gap);
        }
        lastRenderAt = t;
        lastRenderHidden = document.hidden;
        nowMs = t;
        // Accumulate time spent hidden — the only figure that says whether a run
        // was long enough to reach Chromium's intensive throttling (~5 min).
        if (document.hidden) {
          if (lastHiddenAt) hiddenMs += t - lastHiddenAt;
          lastHiddenAt = t;
        } else {
          lastHiddenAt = 0;
        }
      }
    },
    onDone: (info) => {
      // FIRST, before anything else in this handler: the Finished screen
      // reconstructs the instant zero was reached from the wall clock read here
      // minus the overshoot (docs/04 §2), and the case it exists for is exactly
      // the one where this thread has been stalled.
      session.finished(info);
      phase = 'done';
      remainingMs = 0;
      doneInfo = info;

      // docs/02 §5. Fires even when `done` arrived minutes late (docs/04 §2
      // decision item 3): the End Behavior is the user's configured attention
      // signal, and firing it on return is the useful behaviour. What must not
      // happen is the SCREEN claiming the moment is now — that is TtFinished's
      // job, and it is handled by the late variant.
      const end = playback.runEndBehavior();
      if (!end) return;

      if (end.flash) {
        flashing = true;
        setTimeout(() => (flashing = false), 400);
      }

      // docs/02 §3.3. 'stay' is the default and needs no action.
      if (end.action === 'restart' && !autoRestarted) {
        autoRestarted = true;
        setTimeout(() => onStart(false, true), 400);
      } else if (end.action === 'loop') {
        setTimeout(() => onStart(false, true), 400);
      }
    },
    onLog: (code, detail) => {
      // Until the log engine lands (docs/02 §7), surface coded events where a
      // human can see them. console.warn is allowed by docs/12 §4 precisely
      // because it feeds the diagnostics buffer.
      console.warn(`[${code}]`, detail ?? {});
      if (debug) logLines = [...logLines, `${code} ${JSON.stringify(detail ?? {})}`];
    },
    ...(debug ? { onSample: (s: TtTickSample) => samples.push(s) } : {}),
  });

  onDestroy(() => {
    driver.dispose();
    playback.dispose();
  });

  /**
   * @param force the ?ttdebug=1 timer-only Start (docs/15 §S2) — runs the
   *   countdown with no track, which is what the spike's silent cases need.
   * @param auto this start came from `endAction`, not from the user. Only a
   *   user-initiated start re-arms the once-only restart.
   */
  function onStart(force = false, auto = false) {
    session.start(force);
    if (session.state !== 'playing') return;
    if (!auto) autoRestarted = false;

    // The previous run's fade left fadeGain at 0; without this the next run is
    // silent for its whole duration with nothing on screen to explain it.
    playback.resetFade();

    samples = [];
    doneInfo = null;
    logLines = [];
    maxRenderGapVisibleMs = 0;
    maxRenderGapHiddenMs = 0;
    lastRenderAt = 0;
    lastRenderHidden = false;
    hiddenMs = 0;
    lastHiddenAt = 0;
    runStartedAt = performance.now();
    nowMs = runStartedAt;

    driver.start(durationMs);

    const track = session.current;
    if (!force && track) {
      // Unlock first and unawaited — this call is still inside the click's task
      // and WebKit stops counting the gesture at the first yield (docs/05 §1).
      void playback.unlock();
      void playback.load(track, session.mode === 'single').then(() => playback.play());
    }
  }

  /**
   * A track reached its end — docs/02 §5.
   *
   * Only reachable in Playlist mode: Single loads with `element.loop = true`,
   * which emits no `ended` at all (docs/05 §2). Exhaustion is not an error and
   * must not touch the timer — the countdown runs on in silence (docs/02 §5.1
   * rule 6, docs/04 §5).
   */
  function onTrackEnded() {
    if (session.state !== 'playing') return;
    const outcome = session.advance();
    if (outcome === 'exhausted') {
      playback.stop();
      return;
    }
    playTrack();
  }

  /** Load and play whatever the cursor now points at. */
  function playTrack() {
    const track = session.current;
    if (!track) return;
    void playback.load(track, session.mode === 'single').then(() => playback.play());
  }

  /** docs/03 §2 Z7 — ⏭. Advancing past the end wraps or falls silent, as configured. */
  function onNext() {
    if (session.advance() === 'exhausted') playback.stop();
    else playTrack();
  }

  /** ⏮. Inert at the first track: prevInOrder does not wrap (docs/02 §5.1). */
  function onPrev() {
    if (session.prev()) playTrack();
  }

  /** Double-click a queue row. */
  function onJump(id: string) {
    if (!session.jumpTo(id)) return;
    if (session.state === 'playing' || session.state === 'paused') playTrack();
  }

  function onPause() {
    session.pause();
    driver.pause();
    playback.pause();
  }

  function onResume() {
    session.resume();
    driver.resume();
    void playback.play();
  }

  /** docs/02 §1's Stop edge: playing/paused → setup, run discarded. */
  function onStop() {
    session.stop();
    driver.reset();
    playback.stop();
  }

  // ── media position + bottom-bar wake (docs/03 §2 Z7) ──────────────────────
  let wakeToken = $state(0);
  /**
   * The track whose info modal is open — the TRACK, not a boolean.
   *
   * A boolean plus `playback.track` was fine while Single mode had one track;
   * with a queue it would show row 1's metadata however far down the user
   * right-clicked, and the modal would look like it worked (docs/02 §8).
   */
  let infoTrack = $state<TtTrack | null>(null);
  /** Peak Analyser RMS, sampled for the ?ttdebug=1 panel only. */
  let peakRms = $state(0);

  $effect(() => {
    if (session.state !== 'playing') return;
    // 10 Hz: `timeupdate` alone fires at ~4 Hz, which is visibly steppy on a
    // progress bar. This reads the element rather than accumulating anything.
    const id = setInterval(() => {
      playback.tick();
      if (debug) peakRms = Math.max(peakRms, playback.peakRms);
    }, 100);
    return () => clearInterval(id);
  });

  function onActivity() {
    wakeToken += 1;
  }

  /**
   * docs/02 §3 — warn before leaving with work in progress.
   *
   * This matters more here than in most apps: the queue is session-only by
   * design (D3), the files live in RAM and nothing is persisted, so a reload is
   * not "reload" — it is "throw the queue away". Object URLs are revoked on
   * `pagehide` regardless, which is the audio driver's job.
   */
  function onBeforeUnload(e: BeforeUnloadEvent) {
    const busy =
      session.queue.length > 0 || session.state === 'playing' || session.state === 'paused';
    if (!busy) return;
    e.preventDefault();
  }

  /**
   * docs/03 §7 hotkeys — the P2 subset. `F`/`H`/`]` arrive with Focus mode and
   * the collapsible rail in P5. Inert while typing, so the countdown inputs
   * still take a literal space.
   */
  function onKeydown(e: KeyboardEvent) {
    onActivity();
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (infoTrack) return;

    if (e.key === ' ' && (session.state === 'playing' || session.state === 'paused')) {
      e.preventDefault();
      if (session.state === 'playing') onPause();
      else onResume();
    } else if (e.key === 'm' || e.key === 'M') {
      void settings.patch({ muted: !settings.current.muted }).then(() => playback.applyVolume());
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const delta = e.key === 'ArrowUp' ? 0.05 : -0.05;
      const volume = Math.min(1, Math.max(0, settings.current.volume + delta));
      void settings.patch({ volume }).then(() => playback.applyVolume());
    } else if (e.key === 'ArrowLeft' && session.canPrev) {
      // docs/03 §7 `←/→` prev/next. Inert in Single mode — there is nowhere to
      // go, which is the same reason Z7 disables the buttons there.
      e.preventDefault();
      onPrev();
    } else if (e.key === 'ArrowRight' && session.canNext) {
      e.preventDefault();
      onNext();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} onpointermove={onActivity} onbeforeunload={onBeforeUnload} />

{#if booted && needsGate}
  <TtLegalGate onaccept={acceptLegal} />
{/if}

<main
  class="tt-main"
  class:tt-player={session.state === 'playing' || session.state === 'paused'}
  inert={booted && needsGate}
>
  {#if debug}
    <TtDebugPanel
      {samples}
      done={doneInfo}
      logs={logLines}
      {phase}
      {maxRenderGapVisibleMs}
      {maxRenderGapHiddenMs}
      {hiddenMs}
      elapsedMs={runStartedAt && nowMs ? nowMs - runStartedAt : 0}
      {peakRms}
      liveUrls={playback.liveUrls}
    />
  {/if}

  <!--
    docs/03 §2 Z5 — tally light + wordmark. The dot is STATIC in P2: the
    beat-reactive pulse needs the Analyser loop that ships with the visualizer
    in P5 (docs/05 §6), and a fake pulse would be worse than none.
  -->
  <header class="tt-brand">
    <span
      class="tt-tally"
      class:tt-live={session.state === 'playing'}
      data-testid="tt-tally"
      aria-hidden="true"
    ></span>
    <span class="tt-wordmark">TickTune</span>
  </header>

  <section class="tt-stage">
    <TtCountdown remainingMs={displayMs} glowIntensity={settings.current.glowIntensity} />

    {#if session.state === 'playing' || session.state === 'paused'}
      {#if session.mode === 'single'}
        <TtSingleRail
          track={playback.track}
          loops={playback.loops}
          crossfadeAvailable={false}
          oninfo={() => (infoTrack = playback.track)}
        />
      {:else}
        <TtQueuePanel
          variant="rail"
          tracks={session.queue}
          currentId={session.currentId}
          shuffle={settings.current.shuffle}
          repeat={settings.current.repeatPlaylist}
          exhausted={session.exhausted}
          onremove={(id) => session.removeTrack(id)}
          onjump={onJump}
          onshuffle={(on) => session.setShuffle(on)}
          onrepeat={(on) => session.setRepeat(on)}
          oninfo={(t) => (infoTrack = t)}
        />
      {/if}
    {/if}
  </section>

  {#if session.state === 'setup'}
    <TtSetup
      {hours}
      {minutes}
      {seconds}
      onchange={(h, m, s) => {
        hours = h;
        minutes = m;
        seconds = s;
      }}
      onstart={() => onStart()}
      {debug}
      ondebugstart={() => onStart(true)}
      oninfo={(t) => (infoTrack = t)}
    />
  {/if}

  <!--
    docs/03 §3.5. The screen replaces the setup controls rather than sitting
    beside them: "Chạy lại" and "Về thiết lập" are the only two moves from here
    (docs/02 §1), and leaving Bắt đầu visible would offer a third that means the
    same as one of them.
  -->
  {#if session.state === 'finished' && session.finish}
    <TtFinished
      report={session.finish}
      onrestart={() => {
        session.restart();
        onStart();
      }}
      onback={() => {
        session.backToSetup();
        driver.reset();
        playback.stop();
      }}
    />
  {/if}

  {#if session.state === 'playing' || session.state === 'paused'}
    <TtBottomBar
      track={playback.track}
      positionMs={playback.positionMs}
      durationMs={playback.durationMs}
      playing={session.state === 'playing'}
      volume={settings.current.volume}
      muted={settings.current.muted}
      onplaypause={() => (session.state === 'playing' ? onPause() : onResume())}
      onstop={onStop}
      onvolume={(v) => void settings.patch({ volume: v }).then(() => playback.applyVolume())}
      onmute={() =>
        void settings.patch({ muted: !settings.current.muted }).then(() => playback.applyVolume())}
      onprev={onPrev}
      onnext={onNext}
      canPrev={session.canPrev}
      canNext={session.canNext}
      {wakeToken}
    />
  {/if}

  {#if infoTrack}
    <TtTrackInfo track={infoTrack} onclose={() => (infoTrack = null)} />
  {/if}

  <!-- docs/03 §6 endFlash. Decoration, so reduced motion removes it entirely. -->
  {#if flashing}
    <div class="tt-flash" data-testid="tt-flash" aria-hidden="true"></div>
  {/if}
</main>

<style>
  .tt-main {
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 1.75rem;
    min-height: 100dvh;
    padding: 2rem;
  }
  /* The bottom bar is fixed, so the player screen reserves room for it. */
  .tt-player {
    padding-bottom: 5rem;
  }

  .tt-brand {
    position: absolute;
    top: 1.1rem;
    left: 1.25rem;
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .tt-tally {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-tt-muted);
  }
  .tt-live {
    background: var(--color-tt-danger);
    box-shadow: 0 0 8px var(--color-tt-danger);
  }
  .tt-wordmark {
    font-size: 0.78rem;
    letter-spacing: 0.16em;
    color: var(--color-tt-muted);
  }

  /* docs/03 §2: Z3 countdown with Z4 to its right. */
  .tt-stage {
    display: flex;
    gap: 2.5rem;
    align-items: center;
    justify-content: center;
    width: 100%;
  }

  /* Buttons live with the components that own them — Setup has its own, and
     transport is entirely Z7's (docs/03 §2). The shell renders none. */

  /* docs/03 §6: two 120 ms pulses of tt-signal at ≤20% over Z1, 400 ms total.
     It never touches the digits — Z3 holds 0.000 (docs/04 §4). */
  .tt-flash {
    position: fixed;
    inset: 0;
    z-index: 20;
    pointer-events: none;
    background: var(--color-tt-signal);
    animation: tt-flash-pulse 400ms steps(1, end) 1;
  }
  @keyframes tt-flash-pulse {
    0%,
    60% {
      opacity: 0.2;
    }
    30%,
    100% {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tt-flash {
      display: none;
    }
  }
</style>
