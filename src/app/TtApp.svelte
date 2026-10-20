<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import TtBackdrop from './components/TtBackdrop.svelte';
  import TtBottomBar from './components/TtBottomBar.svelte';
  import TtCountdown from './components/TtCountdown.svelte';
  import TtDebugPanel from './components/TtDebugPanel.svelte';
  import TtFinished from './components/TtFinished.svelte';
  import TtIcon from './components/TtIcon.svelte';
  import TtLegalGate from './components/TtLegalGate.svelte';
  import TtQueuePanel from './components/TtQueuePanel.svelte';
  import TtSettings from './components/TtSettings.svelte';
  import TtSetup from './components/TtSetup.svelte';
  import TtSingleRail from './components/TtSingleRail.svelte';
  import TtTrackInfo from './components/TtTrackInfo.svelte';
  import TtVisualizer from './components/TtVisualizer.svelte';
  import TtYouTubeRail from './components/TtYouTubeRail.svelte';
  import type { TtTrack } from './engine/importer/types';
  import { TtTimerDriver } from './engine/timer/tt-timer-driver';
  import { milestoneFor } from './engine/timer/tt-milestones';
  import type { TtTickSample } from './engine/timer/types';
  import { errorName, installGlobalCapture, ttLog } from './engine/log/tt-log';
  import { backdrop } from './state/backdrop.svelte';
  import { i18n } from './state/i18n.svelte';
  import { playback } from './state/playback.svelte';
  import { session } from './state/session.svelte';
  import { settings } from './state/settings.svelte';
  import { yt } from './state/yt.svelte';
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

    // docs/06 §8 — events, not a poll. A timer probing /api would be a
    // self-inflicted 429 against the very rule §6 asks us to respect.
    // `yt` used to keep its own copy of this and nothing ever read it — one
    // more channel written on every change with no consumer. `session.online`
    // is what the banner and the Start predicate read, so it is the only one.
    const setOnline = () => session.setOnline(navigator.onLine);
    setOnline();
    window.addEventListener('online', setOnline);
    window.addEventListener('offline', setOnline);

    // docs/02 §5 — a track that plays to its end advances the queue. Wired here
    // rather than inside the playback store because "what plays next" is the
    // session's question, and docs/12 §3.3 keeps data flowing one way.
    playback.onEnded = onTrackEnded;
    // docs/02 §6 — an undecodable local track is marked and skipped. The engine
    // reported it from the start; nothing listened, so a playlist stopped dead.
    playback.onError = onTrackFailed;
    // docs/06 §2: `onStateChange: ENDED` is YouTube's equivalent, and it is the
    // ONLY one — there is no `ended` event on a cross-origin iframe to listen
    // for. Same handler, so the queue rules cannot diverge per source.
    yt.onAdvance = onTrackEnded;
    // docs/06 §2's two backfills. The queue is the session's, so the patch is
    // the session's too — the store reports, the shell routes (docs/12 §3.3).
    yt.onMeta = (trackId, fields) => session.patchTrack(trackId, fields);

    void settings.load(navigator.language).then((s) => {
      // docs/08 §2 — before anything renders a string. `settings.load` has
      // already applied `initialLang`'s rule (stored → navigator.language → EN),
      // so the runtime is told the answer rather than deciding it a second time.
      i18n.start(s.lang);
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
    return () => {
      window.removeEventListener('online', setOnline);
      window.removeEventListener('offline', setOnline);
      uninstall();
    };
  });

  /**
   * The autoplay-unlock gesture, at all three `docs/05 §1` sites — and it can
   * never take anything else down with it.
   *
   * 🔴 **Every call used to be a bare `void playback.unlock()`, and each one was
   * a single point of failure for the feature around it.** `unlock()` reaches
   * `#ensure()` **synchronously**, so in a browser where constructing an
   * `AudioContext` throws, the error escaped past the rest of the handler:
   *
   * - at the gate, `session.gateAccepted()` never ran, so `needsGate` stayed
   *   true and the user was **trapped at the consent screen**, permanently, on
   *   every reload;
   * - at Start in **YouTube mode**, `yt.load()` and `yt.play()` never ran, so
   *   the player never mounted — in a mode that uses **no Web Audio at all**.
   *   The unlock is there only so the local chime works for a returning user
   *   (`06 §2`), i.e. a secondary concern was killing the primary one, and the
   *   primary one is the element YouTube's terms require to be visible;
   * - at Start in local modes, `playback.load()` never ran.
   *
   * `void` is no protection: it discards a *promise*, not a synchronous throw.
   * `try` covers the throw and `.catch` the rejection; the old code was exposed
   * to both.
   *
   * Found in P7 slice B by running desktop WebKit for the first time — 130 of
   * 166 specs failed, all on this. Playwright's WebKit build has no
   * `AudioContext`, which is a harness limitation; that a missing audio stack
   * could brick consent and the YouTube player is not.
   *
   * Stays synchronous inside the gesture: `docs/05 §1` — WebKit only counts the
   * gesture if `resume()` is reached before the task yields, and neither a
   * function call nor a `try` yields. Audio here is opportunistic and retried at
   * the next site; consent and playback are not.
   */
  function unlockAudio(site: 'gate' | 'start'): void {
    try {
      void playback.unlock().catch((err: unknown) => {
        ttLog.warn('TT-SYS-206', `audio unlock rejected at ${site}: ${errorName(err)}`);
      });
    } catch (err) {
      ttLog.warn('TT-SYS-206', `audio unlock threw at ${site}: ${errorName(err)}`);
    }
  }

  /**
   * docs/02 §1 / docs/05 §1: this click is the autoplay-unlock gesture — one of
   * three unlock sites. The gate only renders when the stored legal version
   * differs, so a returning user reaches playback without passing through here.
   *
   * 🔴 **`session.gateAccepted()` comes FIRST, and the order is load-bearing** —
   * `needsGate` derives from it, so anything that can throw ahead of it can trap
   * the user at the consent screen. `unlockAudio` explains what did.
   */
  async function acceptLegal(version: string) {
    session.gateAccepted();
    unlockAudio('gate');
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
  /**
   * The pending `endAction` re-run, so it can be CANCELLED.
   *
   * 🔴 It was a bare `setTimeout`. "Về thiết lập" inside its 400 ms window
   * started a run the user had just dismissed; "Chạy lại" inside it started a
   * second, re-seated (and reshuffled) run on top of the first. Every way out
   * of Finished cancels it, and the callback re-checks the state anyway.
   */
  let autoRestartTimer: ReturnType<typeof setTimeout> | undefined;
  function cancelAutoRestart(): void {
    clearTimeout(autoRestartTimer);
    autoRestartTimer = undefined;
  }
  /** The last run's `force`, so Chạy lại / auto re-runs repeat a ?ttdebug run faithfully. */
  let lastForce = false;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

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
      // docs/03 §8's polite milestones. Driven from the tick rather than from a
      // timer of its own, so an announcement can never claim a moment the
      // countdown has not reached — and the crossing rule (tt-milestones.ts)
      // is what keeps a throttled tab from firing four of them at once.
      announceMilestone(ms);
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
      /*
       * docs/03 §8's zero announcement, before the state leaves `playing`.
       *
       * ⚠️ It used to depend on a TICK landing exactly at 0 while still
       * running, which is a race the tick does not always win: `onDone` is the
       * authoritative "zero was reached" signal, and once `session.finished()`
       * runs, `announceMilestone` bails on its `state !== 'playing'` guard.
       * Chromium happened to win it; desktop WebKit did not, and a 12 s
       * countdown announced "ten seconds" and then nothing — the screen reader
       * never heard the run end.
       *
       * Announcing from here makes it deterministic. The crossing rule still
       * decides whether anything is said, so a run already announced at zero
       * says it once.
       */
      announceMilestone(0);

      // FIRST after that: the Finished screen reconstructs the instant zero was
      // reached from the wall clock read here minus the overshoot (docs/04 §2),
      // and the case it exists for is exactly the one where this thread has
      // been stalled.
      session.finished(info);
      phase = 'done';
      remainingMs = 0;
      doneInfo = info;

      // docs/02 §5. Fires even when `done` arrived minutes late (docs/04 §2
      // decision item 3): the End Behavior is the user's configured attention
      // signal, and firing it on return is the useful behaviour. What must not
      // happen is the SCREEN claiming the moment is now — that is TtFinished's
      // job, and it is handled by the late variant.
      // docs/06 §2: "Countdown done in YouTube mode: pauseVideo() + UI dim (no
      // audio-graph fade available); chime still plays locally." The fade has
      // nothing to act on — the audio is inside a cross-origin iframe — but the
      // chime is ours and still sounds, so the attention signal survives.
      if (session.mode === 'youtube') yt.pause();

      const end = playback.runEndBehavior();
      if (!end) return;

      if (end.flash) {
        flashing = true;
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => (flashing = false), 400);
      }

      // docs/02 §3.3. 'stay' is the default and needs no action.
      const rerun = (end.action === 'restart' && !autoRestarted) || end.action === 'loop';
      if (rerun) {
        if (end.action === 'restart') autoRestarted = true;
        cancelAutoRestart();
        autoRestartTimer = setTimeout(() => {
          autoRestartTimer = undefined;
          if (session.state === 'finished') onStart(lastForce, true);
        }, 400);
      }
    },
    onLog: (code, detail) => {
      /*
       * Into the diagnostics buffer, where Copy Diagnostics can find it.
       *
       * 🔴 This was `console.warn` alone, under a comment saying it "feeds the
       * diagnostics buffer". It never did — global capture hooks only `error`
       * and `unhandledrejection` (tt-log.ts) — so drift (201), Wake Lock (202),
       * a late finish (203) and a dead worker (207) were missing from exactly
       * the report a user would paste about a late countdown. The detail is
       * numbers only, so it is safe for the public payload (docs/12 §6).
       */
      const message = Object.entries(detail ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      ttLog.warn(code, message);
      if (debug) logLines = [...logLines, `${code} ${JSON.stringify(detail ?? {})}`];
    },
    ...(debug ? { onSample: (s: TtTickSample) => samples.push(s) } : {}),
  });

  onDestroy(() => {
    cancelAutoRestart();
    clearTimeout(flashTimer);
    clearTimeout(hintTimer);
    driver.dispose();
    playback.dispose();
    yt.dispose();
    // docs/05 §3 — the backdrop keeps its own object-URL ledger, so it owes the
    // same revoke on the way out that the audio graph does.
    backdrop.dispose();
  });

  /**
   * @param force the ?ttdebug=1 timer-only Start (docs/15 §S2) — runs the
   *   countdown with no track, which is what the spike's silent cases need.
   * @param auto this start came from `endAction`, not from the user. Only a
   *   user-initiated start re-arms the once-only restart.
   */
  function onStart(force = false, auto = false) {
    // A manual start supersedes any re-run still pending from the last finish.
    cancelAutoRestart();
    // The store's verdict, not `state === 'playing'` afterwards — that was also
    // true when a stale timer fired into a run that was ALREADY playing.
    if (!session.start(force)) return;
    lastForce = force;
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

    /*
     * Seed the baseline, and clear the last run's announcement.
     *
     * Verified by mutation, and the result corrected the comment that was here
     * first: removing the SEED alone changes nothing, because `announceMilestone`
     * assigns `milestoneFromMs` on every call and self-corrects after one tick.
     * What the clear does is load-bearing — without it the live region still
     * holds "Hết giờ" from the previous run when the next one starts.
     */
    milestoneFromMs = durationMs;
    milestone = '';

    driver.start(durationMs);

    /*
     * docs/02 §1's "re-checked on Start", kept at last — and kept HERE rather
     * than inside `session.start()`, which is what made it look impossible.
     *
     * `start()` stays synchronous: docs/05 §1's gesture chain is broken by the
     * first `await`, and the YouTube branch below still has a `playVideo()` to
     * spend that gesture on. By the time this runs the gesture is already spent,
     * so the re-check can be as asynchronous as it likes. Not awaited, and it
     * patches the queue as answers land — safe because the cursor is a track id
     * (docs/02 §5.1), not an index.
     */
    if (session.mode === 'youtube') void session.recheckPending();

    const track = session.current;
    if (!force && track) {
      if (session.mode === 'youtube') {
        /*
         * docs/06 §1.4: the gesture chain is gate Accept → Start, so calling
         * playVideo() from here is within the autoplay policy.
         *
         * The AudioContext still has to be unlocked, and this used to say it
         * did not. docs/06 §2 promises "chime still plays locally" at zero, and
         * `playback.runEndBehavior()` returns null when the driver was never
         * built — which, for a RETURNING user, is exactly what happens: the
         * legal gate is the only other unlock site and it does not render when
         * the stored version matches. The whole End Behavior — chime, flash and
         * `endAction` — was silently dead on every visit after the first.
         *
         * Fired first and unawaited, like the branch below: WebKit stops
         * counting the gesture at the first yield (docs/05 §1).
         *
         * 🔴 Guarded since P7 slice B. A bare `void playback.unlock()` here
         * threw synchronously on a browser with no `AudioContext` and the two
         * lines below never ran — no player, in the one mode whose player the
         * YouTube terms require to be visible. The chime this unlock exists for
         * is not worth the rail.
         */
        unlockAudio('start');
        yt.load(track);
        yt.play();
      } else {
        // Unlock first and unawaited — this call is still inside the click's task
        // and WebKit stops counting the gesture at the first yield (docs/05 §1).
        unlockAudio('start');
        void playback.load(track, session.mode === 'single').then(() => playback.play());
      }
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
      if (session.mode === 'youtube') yt.pause();
      else playback.stop();
      return;
    }
    loadCurrent();
  }

  /**
   * Load whatever the cursor now points at, on the right engine — and PLAY it
   * only if the run is playing.
   *
   * 🔴 This was `playTrack()`, which always played. ⏭/⏮/double-click while
   * PAUSED therefore started the music with the session paused, the countdown
   * frozen and ▶ on the transport. Paused now means silent: the track is loaded
   * (cued, in YouTube mode) and resume plays it.
   */
  function loadCurrent() {
    const track = session.current;
    if (!track) return;
    const playing = session.state === 'playing';
    if (session.mode === 'youtube') {
      if (playing) {
        yt.load(track);
        yt.play();
      } else {
        yt.cue(track);
      }
      return;
    }
    void playback.load(track, session.mode === 'single').then(() => {
      // Re-read: the user may have paused while the load was in flight.
      if (session.state === 'playing') return playback.play();
    });
  }

  /**
   * The loaded local track could not be decoded — docs/02 §6: "stop →
   * auto-advance to next", the row shown struck-through (TT-PLY-101 is already
   * logged by the engine). Single mode has no next: the media stays stopped and
   * the countdown runs on to zero (§6's carve-out, `04 §5`).
   */
  function onTrackFailed(trackId: string) {
    if (!onPlayerScreen || session.currentId !== trackId) return;
    session.markTrackError(trackId);
    if (session.mode === 'single') return;
    // markTrackError advanced the cursor first; null means nothing is left.
    if (session.currentId === null) stopCurrentEngine();
    else loadCurrent();
  }

  /**
   * A row's × (or the menu's "Xoá") — docs/02 §6: "stop if current → advance".
   *
   * 🔴 The rails called `session.removeTrack` directly. The cursor moved, but
   * nothing told the engine: the removed track kept playing (its URL already
   * revoked), and when it ended the queue advanced AGAIN — skipping the track
   * that had become current. `currentId === null`, not `current`, decides
   * "nothing left": `current` falls back to the first playable track and would
   * restart a finished playlist.
   */
  function onRemove(id: string) {
    const wasCurrent = onPlayerScreen && id === session.currentId;
    session.removeTrack(id);
    if (!wasCurrent) return;
    if (session.currentId === null) stopCurrentEngine();
    else loadCurrent();
  }

  /**
   * Volume and mute reach whichever engine is making sound — docs/03 §7.
   *
   * Without this, four documented hotkeys (`↑`, `↓`, `M`, and the Z7 slider)
   * would move a Web Audio gain node that nothing is routed through in YouTube
   * mode: silent no-ops that look like the app ignoring the user. `settings`
   * stays the single source of truth, so a level set here survives a mode
   * switch; only the SCALE differs, and that conversion lives in the player.
   */
  function applyVolume() {
    if (session.mode === 'youtube') yt.applyVolume();
    else playback.applyVolume();
  }

  /** docs/03 §2 Z7 — ⏭. Advancing past the end wraps or falls silent, as configured. */
  function onNext() {
    // Same branch as onTrackEnded's exhaustion arm, and for the same reason:
    // `playback` is the Web Audio engine, and in YouTube mode nothing is routed
    // through it — so stopping it left the video playing on past the end of a
    // queue that had already reported itself exhausted.
    if (session.advance() === 'exhausted') stopCurrentEngine();
    else loadCurrent();
  }

  /**
   * What the transport button reports — docs/06 §2.
   *
   * The session's state alone is not the answer in YouTube mode. `06 §1.2`
   * requires the native controls to stay usable, so the user can pause the video
   * without the app hearing about it — and the button then offered ⏸ for a video
   * that was already paused, with the ⏯ hotkey pointing the wrong way.
   * `yt.playing` has been written on every PLAYING/PAUSED/ENDED since P4 and read
   * by nothing at all.
   *
   * Both clauses are load-bearing: the session's is what makes an app-level
   * pause take effect instantly, and the player's is what stops a native pause —
   * or an error overlay, which also reports `false` — being drawn as playback.
   * The cost is a moment of ▶ while the first video loads, which is honest.
   */
  const transportPlaying = $derived(
    session.mode === 'youtube' ? session.state === 'playing' && yt.playing : playbackPlaying(),
  );

  /**
   * The local modes' half, and the same idea: `playback.status` is written on
   * every engine transition and was likewise read by nobody. It carries two
   * states the session cannot know — `blocked` (autoplay refused) and `error` —
   * and both should draw ▶ rather than a pause button over silence.
   */
  function playbackPlaying(): boolean {
    if (session.state !== 'playing') return false;
    // `idle` is the gap before the first load resolves; treat it as the session
    // says, so a run does not flicker on every track change.
    return (
      playback.status !== 'paused' && playback.status !== 'blocked' && playback.status !== 'error'
    );
  }

  /**
   * docs/08 §2 — instant, no reload, persisted.
   *
   * Two writes, and the order matters: the runtime switches first so the UI is
   * already correct when the await yields, and Dexie catches up afterwards. A
   * user who closes the tab in that window loses the preference, not the switch.
   */
  async function switchLang() {
    const next = i18n.lang === 'vi' ? 'en' : 'vi';
    i18n.setLang(next);
    await settings.patch({ lang: next });
  }

  /** Whichever engine is making sound — docs/06 §2. */
  function stopCurrentEngine() {
    if (session.mode === 'youtube') yt.pause();
    else playback.stop();
  }

  /**
   * The player's lifetime is exactly the rail's — docs/06 §2.
   *
   * `TtYouTubeRail` renders behind the `playing | paused` guard below, so every
   * exit from those two states destroys the iframe with the DOM. The player has
   * to go with it: it used to survive, still bound to a node that no longer
   * existed, and `attach` refused to adopt the replacement — so Stop → Start and
   * Finished → Chạy lại both ran their whole countdown against a black
   * 384×216 box.
   *
   * An effect rather than a call in `onStop`, because there are three ways out
   * (Stop, the countdown finishing, and Về thiết lập) and a fourth would be
   * added without anyone remembering this one.
   */
  $effect(() => {
    const live = session.state === 'playing' || session.state === 'paused';
    if (!live) yt.dispose();
  });

  /** ⏮. Inert at the first track: prevInOrder does not wrap (docs/02 §5.1). */
  function onPrev() {
    if (session.prev()) loadCurrent();
  }

  /** Double-click (or Enter on) a queue row. */
  function onJump(id: string) {
    if (!session.jumpTo(id)) return;
    if (session.state === 'playing' || session.state === 'paused') loadCurrent();
  }

  function onPause() {
    session.pause();
    driver.pause();
    if (session.mode === 'youtube') yt.pause();
    else playback.pause();
  }

  function onResume() {
    session.resume();
    driver.resume();
    if (session.mode === 'youtube') yt.play();
    else void playback.play();
  }

  /** docs/02 §1's Stop edge: playing/paused → setup, run discarded. */
  function onStop() {
    session.stop();
    driver.reset();
    stopCurrentEngine();
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
      // docs/06 §2: in YouTube mode the bar's numbers come from the player, not
      // from a media element — there is none. Same 10 Hz pull for the same
      // reason: `timeupdate` has no equivalent here at all.
      if (session.mode === 'youtube') yt.tick();
      else playback.tick();
      if (debug) peakRms = Math.max(peakRms, playback.peakRms);
    }, 100);
    return () => clearInterval(id);
  });

  function onActivity() {
    wakeToken += 1;
    // docs/03 §4: "Any pointer/key shows a 3 s hint chip". Focus hides every
    // control including the one that would undo it, so the way out has to be
    // re-offered rather than remembered.
    if (focusMode) showHint('focus');
  }

  // ── docs/03 §4 Focus, docs/03 §7 the rest of the hotkeys ──────────────────

  /**
   * Both are session-only on purpose.
   *
   * `02 §3.1` has no field for either, and P5 is wiring what that schema already
   * promised rather than extending it (`16 §P5`). A persisted Focus would also
   * be a trap: the app would open with every control hidden and no clue why.
   */
  let focusMode = $state(false);
  let railCollapsed = $state(false);
  let settingsOpen = $state(false);

  /**
   * The 3 s chip both `03 §2` and `03 §4` call for — one region, two messages.
   *
   * A tag rather than a `TtKey`, so the two strings are looked up by LITERAL in
   * the markup below. The key guard finds callers by grepping for `t('…')`
   * (tests/unit/tt-i18n-keys.test.ts), and passing the key through a variable
   * would make both entries read as orphans and fail the build — which is the
   * guard working, not a reason to exempt them.
   */
  let hint = $state<'focus' | 'railLocked' | null>(null);
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  function showHint(which: 'focus' | 'railLocked') {
    hint = which;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (hint = null), 3000);
  }

  /**
   * Closing the panel returns focus to ⚙ — docs/03 §8's "full keyboard support".
   *
   * The panel deliberately does not do this itself: `S` opens it with `<body>`
   * focused, so an opener-restore (which is right for the info modal) would
   * drop a keyboard user nowhere. ⚙ is the control that carries `aria-expanded`,
   * so it is where "closed" belongs. Optional because Focus mode does not
   * render Z6 at all.
   */
  function closeSettings() {
    settingsOpen = false;
    queueMicrotask(() =>
      document.querySelector<HTMLElement>('[data-testid=tt-settings-open]')?.focus(),
    );
  }

  const onPlayerScreen = $derived(session.state === 'playing' || session.state === 'paused');

  /*
   * Settings → Display → "Hide scrollbars", applied to the whole page the same
   * way the mobile gate is: an attribute on <html> that global.css keys off
   * (`html[data-tt-scrollbars='hidden']`). It has to be the document element —
   * the page itself, the settings sheet, the queue and every modal scroll, and
   * none of them can reach a class on `main`.
   */
  $effect(() => {
    document.documentElement.dataset['ttScrollbars'] = settings.current.hideScrollbars
      ? 'hidden'
      : 'styled';
  });

  /*
   * Settings → Display → Theme (v2.0), on <html> for the same reason: every
   * token in global.css is overridden under `html[data-tt-theme='light']`, and
   * the sheet, the modals and the toasts all live outside `main`. Only this
   * island sets it, so the landing and the legal pages stay dark.
   */
  $effect(() => {
    document.documentElement.dataset['ttTheme'] = settings.current.theme;
  });

  /**
   * The cover the backdrop may use — docs/03 §2 Z1 "cover".
   *
   * It read `playback.track` unconditionally, i.e. the last track the AUDIO
   * engine loaded: in YouTube mode that was a stale local track from an earlier
   * run, and in Setup after replacing the Single track it was the OLD track,
   * whose cover URL had just been revoked. YouTube gets no cover (no
   * thumbnail-derived visuals — `06 §6`); Setup previews what Start would play.
   */
  const coverArtUrl = $derived(
    session.mode === 'youtube'
      ? null
      : ((onPlayerScreen ? playback.track : session.current)?.coverArtUrl ?? null),
  );

  // ── docs/03 §8 milestone announcements, and docs/03 §1's tally pulse ───────

  /**
   * The polite region the countdown itself deliberately does not have.
   *
   * `TtCountdown` carries no `aria-live` — announcing every tick is
   * screen-reader spam — so the five milestones live here instead, in the
   * shell that owns the timer. Separate from `TtQueuePanel`'s region: two
   * `aria-live` areas with different subjects are how a reader is told which
   * one changed.
   */
  let milestone = $state<string>('');

  /**
   * The previous remaining value, kept for the crossing test — and kept
   * SEPARATELY from `remainingMs`.
   *
   * Reusing the display value looked equivalent and was not: `remainingMs` is
   * initialised to 90 000 for the idle preview and only moves once the timer
   * ticks, so the first tick of a 12-second run compared 90 000 against 12 000,
   * decided it had just crossed the one-minute mark, and announced "one minute
   * remaining" to someone who had asked for twelve seconds.
   *
   * The pure rule was right and the argument was wrong — this project's
   * signature defect shape, caught by E2E because no unit test of
   * `milestoneFor` can see which values the shell hands it. Confirmed by
   * mutation: restoring `remainingMs` here turns the 12-second spec red with
   * exactly the spurious "one minute remaining" it shipped with.
   */
  let milestoneFromMs = 0;

  function announceMilestone(currentMs: number) {
    if (session.state !== 'playing') return;
    const crossed = milestoneFor(milestoneFromMs, currentMs);
    milestoneFromMs = currentMs;
    if (!crossed) return;
    /*
     * Cleared first, then set in a microtask. A live region whose text is
     * replaced with a DIFFERENT string announces reliably, but 10 s and zero
     * can arrive close together and some readers coalesce two rapid mutations
     * into one — blanking between them makes each a distinct change.
     */
    milestone = '';
    queueMicrotask(() => {
      milestone =
        crossed === 'min10'
          ? i18n.t('player.milestone.min10')
          : crossed === 'min5'
            ? i18n.t('player.milestone.min5')
            : crossed === 'min1'
              ? i18n.t('player.milestone.min1')
              : crossed === 'sec10'
                ? i18n.t('player.milestone.sec10')
                : i18n.t('player.milestone.zero');
    });
  }

  /**
   * docs/03 §1 / docs/05 §6 — the tally light pulses to the beat.
   *
   * Published by `TtVisualizer` on every analyser frame **including when the
   * style is `off`**, which is the whole reason the beat is a separate channel:
   * "even Visualizer: off keeps one live beat element". Steady in YouTube mode,
   * where there is no Analyser to read at all.
   */
  let beat = $state(0);

  /**
   * docs/03 §2's carve-out, and the reason it is a `$derived` rather than a
   * branch at each call site: the rail holds the YouTube player, and `06 §1.2`
   * forbids hiding it. Focus reduces that rail to the player alone (the rail
   * component does that itself); `]` cannot touch it at all.
   */
  const railHidden = $derived(session.mode === 'youtube' ? false : focusMode || railCollapsed);

  /*
   * Leaving the player screen cancels both. Otherwise Stop → Setup would land
   * on a setup form with its chrome hidden and no visible way to bring it back.
   */
  $effect(() => {
    if (!onPlayerScreen) {
      focusMode = false;
      railCollapsed = false;
    }
  });

  /**
   * The space no overlay may occupy — docs/03 §2, "any overlay / modal must not
   * cover the player rect".
   *
   * Published once, as a variable, so a future overlay inherits the rule instead
   * of rediscovering it. It is the rail's own column plus the page padding, i.e.
   * the distance from the right edge of the viewport to the rail's left edge.
   */
  const ytReserve = $derived(
    session.mode === 'youtube' && onPlayerScreen ? 'calc(384px + 1.8rem + 2rem)' : '0px',
  );

  function toggleFullscreen() {
    // A rejection here is a browser policy decision the user can see the result
    // of (nothing happens); it is not an app error and gets no log code.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  }

  /** `]` — docs/03 §7, and a no-op in YouTube mode with the reason shown. */
  function toggleRail() {
    if (!onPlayerScreen) return;
    if (session.mode === 'youtube') {
      showHint('railLocked');
      return;
    }
    railCollapsed = !railCollapsed;
  }

  /**
   * Settings → General → Reset, once the second confirmation is given.
   *
   * The row is gone, so `legalAccepted` is null and the app is a first-time
   * visitor again. Doing that transition here rather than in the panel keeps
   * the state machine in one place (docs/12 §3.3), and the run is stopped first
   * because a countdown ticking behind an inert gate is nobody's intention.
   */
  function onSettingsReset() {
    // From Finished this lands on the gate; a pending re-run must not start behind it.
    cancelAutoRestart();
    settingsOpen = false;
    if (onPlayerScreen) onStop();
    else if (session.state === 'finished') session.backToSetup();
    driver.reset();
    i18n.start(settings.current.lang);
    session.booted(true);
    document.documentElement.dataset['ttBooted'] = 'gate';
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
   * docs/03 §7 hotkeys — complete since P5 slice 2. Inert while typing, so the
   * countdown inputs still take a literal space.
   *
   * Three things swallow the whole set rather than individual keys, and each is
   * a different reason: the legal gate makes `main` inert, so acting on a key
   * would drive an interface the user cannot see (`02 §1`); the info modal and
   * the settings panel own `Esc` themselves, and a second handler underneath
   * would close both at once.
   */
  function onKeydown(e: KeyboardEvent) {
    onActivity();
    /*
     * A key a component already handled is not a hotkey. 🔴 Alt+↑/↓ on a queue
     * row reorders it (and calls preventDefault) — and then reached here and
     * ALSO moved the volume ±5. Same for the context menu's arrows and Space.
     */
    if (e.defaultPrevented) return;
    /*
     * docs/03 §7's hotkeys are bare keys. With Ctrl/⌘/Alt held they belong to
     * the browser: Ctrl+F (find) used to toggle fullscreen, Ctrl+S opened the
     * panel, Ctrl+H entered Focus. Shift stays allowed (`S` == `s`), and AltGr —
     * which Windows reports as Ctrl+Alt — is how `]` is typed on German and
     * French layouts, so it must still reach the rail toggle.
     */
    if ((e.ctrlKey || e.metaKey || e.altKey) && !e.getModifierState('AltGraph')) return;
    const el = e.target as HTMLElement | null;
    if (
      el &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable)
    )
      return;
    if (booted && needsGate) return;
    if (settingsOpen) {
      // `S` toggles, so it has to survive the guard that the panel's own `Esc`
      // handler otherwise hides behind.
      if (e.key === 's' || e.key === 'S') closeSettings();
      return;
    }
    if (infoTrack) return;

    if (e.key === 's' || e.key === 'S') {
      settingsOpen = true;
      return;
    }
    if (e.key === 'f' || e.key === 'F') {
      toggleFullscreen();
      return;
    }
    if (e.key === 'h' || e.key === 'H') {
      if (onPlayerScreen) {
        focusMode = !focusMode;
        // The key that ENTERS Focus has to offer the way out too. `onActivity`
        // above ran while `focusMode` was still false, so without this the chip
        // waits for a second, unrelated keystroke — on a screen that has just
        // hidden every control that could explain itself (docs/03 §4).
        if (focusMode) showHint('focus');
      }
      return;
    }
    if (e.key === ']') {
      toggleRail();
      return;
    }

    if (e.key === ' ' && (session.state === 'playing' || session.state === 'paused')) {
      e.preventDefault();
      if (session.state === 'playing') onPause();
      else onResume();
    } else if (e.key === 'm' || e.key === 'M') {
      void settings.patch({ muted: !settings.current.muted }).then(applyVolume);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const delta = e.key === 'ArrowUp' ? 0.05 : -0.05;
      const volume = Math.min(1, Math.max(0, settings.current.volume + delta));
      void settings.patch({ volume }).then(applyVolume);
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

<!--
  docs/03 §2 Z1. Outside `<main>` and before it, because it is the page's
  background on every screen — Setup, Player and Finished alike — and because
  `main` goes `inert` behind the legal gate while this must keep painting.
-->
<TtBackdrop {coverArtUrl} {focusMode} />

<!--
  docs/03 §2 Z2 — above Z1, below everything else. Mounted whenever the player
  is up, even with the style `off`: it is also the only thing reading the
  analyser, and the Z5 tally light's pulse comes from it (docs/05 §6).

  `available={session.mode !== 'youtube'}` is the hard platform limit, not a
  preference — cross-origin media gives no Analyser access at all.
-->
<TtVisualizer
  available={session.mode !== 'youtube'}
  playing={onPlayerScreen && session.state === 'playing'}
  onbeat={(energy) => (beat = energy)}
/>

{#if booted && needsGate}
  <TtLegalGate onaccept={acceptLegal} />
{/if}

<main
  class="tt-main"
  class:tt-player={session.state === 'playing' || session.state === 'paused'}
  class:tt-setup-screen={session.state === 'setup'}
  class:tt-focus={focusMode}
  style:--tt-yt-reserve={ytReserve}
  inert={booted && needsGate}
>
  <!--
    The page's top-level heading — found missing in P7 slice B by the axe scan.

    Setup and the Player had NO `<h1>` at all: the Legal Gate has one and so does
    the Finished screen, so every state a user passes *through* was named while
    the two they spend their time in were not. A screen-reader user landing on
    Setup had nothing to orient from, and "skip to the heading" reached nothing.

    Visually hidden rather than rendered: the design's anchor is the wordmark and
    the countdown itself, and `03 §1` gives the digits their own treatment. Never
    `display: none`, which would remove it from the accessibility tree and undo
    the fix.

    A literal, like `TtLegalGate`'s: the wordmark is a proper noun and is never
    translated (`08 §3`, `i18n/static/en.ts`).

    ⚠️ Only the `wcag*` tags were scanned at first and they do **not** report a
    missing `h1` — `page-has-heading-one` is `best-practice`. The scan was green
    over this until the tag set was widened.
  -->
  <!-- Not on Finished, which has its own visible <h1> ("Hết giờ") — one
       top-level heading per screen, not two. -->
  {#if session.state !== 'finished'}
    <h1 class="tt-sr">TickTune</h1>
  {/if}

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
  {#if !focusMode}
    <header class="tt-brand" data-testid="tt-brand">
      <!--
        docs/03 §1: "Playing: tt-danger, pulsing to the beat (Analyser energy)
        in local modes; steady in YouTube mode." The pulse arrived with the
        visualizer in P5 slice 4, as docs/05 §6 said it would — P2 shipped the
        two-state dot rather than a fake pulse.

        Driven by a CSS custom property rather than a class, because the beat is
        continuous: a class would quantise it to on/off and read as a blink.
      -->
      <span
        class="tt-tally"
        class:tt-live={session.state === 'playing'}
        style:--tt-beat={beat}
        data-testid="tt-tally"
        data-tt-beat={beat > 0 ? '1' : null}
        aria-hidden="true"
      ></span>
      <!-- The lamp's engraved caption, lit with it. Hardware labelling, not
           copy — decorative, so it stays out of the accessibility tree. -->
      <span class="tt-onair" class:tt-onair-live={session.state === 'playing'} aria-hidden="true"
        >ON AIR</span
      >
      <span class="tt-wordmark">TickTune</span>
    </header>
  {/if}

  <!--
    docs/03 §2 Z6 — "Settings ⚙, language, fullscreen. Icon buttons, 40 px hit
    area." All three are here since P5 slice 2; the header shape was chosen in
    slice 1 precisely so the other two could arrive without a re-layout.

    The language label is written in the language being switched TO, on purpose:
    someone who cannot read the current interface has to be able to read their
    way out of it (docs/03 §8, "language of parts").
  -->
  {#if !focusMode}
    <header class="tt-chrome" data-testid="tt-chrome">
      <!--
        The name STARTS with the visible code (WCAG 2.5.3, label in name): a
        voice-control user says what they see, "EN", and the name must contain
        it. axe 4.14 flags the old name ("Switch to English") as
        label-content-name-mismatch.
      -->
      <button
        class="tt-key tt-key-icon"
        data-testid="tt-lang-toggle"
        lang={i18n.lang === 'vi' ? 'en' : 'vi'}
        aria-label={i18n.lang === 'vi'
          ? `EN — ${i18n.t('header.lang.toEn')}`
          : `VI — ${i18n.t('header.lang.toVi')}`}
        onclick={() => void switchLang()}>{i18n.lang === 'vi' ? 'EN' : 'VI'}</button
      >
      <button
        class="tt-key tt-key-icon"
        data-testid="tt-settings-open"
        aria-label={i18n.t('header.settings')}
        aria-expanded={settingsOpen}
        onclick={() => (settingsOpen = !settingsOpen)}><TtIcon name="settings" /></button
      >
      <button
        class="tt-key tt-key-icon"
        data-testid="tt-fullscreen"
        aria-label={i18n.t('header.fullscreen')}
        onclick={toggleFullscreen}><TtIcon name="fullscreen" /></button
      >
    </header>
  {/if}

  <section class="tt-stage">
    <!--
      The clock's own column, and it is load-bearing rather than a wrapper for
      styling — docs/03 §4. `container-type: inline-size` makes this element a
      size container whose width is computed WITHOUT its contents, so the flex
      line gives it exactly what the rail does not need, and `TtCountdown`'s
      `cqw` cap resolves against that. Measured 2026-07-23: without it the
      countdown sized itself from the viewport, the rail could not shrink below
      its 384 px player, and in the >= 1 h regime the player was pushed
      224 px off screen at 1280 px (58% of it) and off screen at every width
      below 1920 (docs/03 §4's table).
    -->
    <div class="tt-clock">
      <TtCountdown
        remainingMs={displayMs}
        glowIntensity={settings.current.glowIntensity}
        size={settings.current.countdownSize}
        face={settings.current.clockFace}
        {focusMode}
      />
    </div>

    {#if onPlayerScreen && !railHidden}
      {#if session.mode === 'youtube'}
        <TtYouTubeRail
          tracks={session.queue}
          currentId={session.currentId}
          shuffle={settings.current.shuffle}
          repeat={settings.current.repeatPlaylist}
          exhausted={session.exhausted}
          overlay={yt.overlay}
          skipInSeconds={yt.skipInSeconds}
          {focusMode}
          onmount={(el) => yt.attach(el)}
          onskip={() => yt.skipNow()}
          onremove={onRemove}
          onjump={onJump}
          onshuffle={(on) => session.setShuffle(on)}
          onrepeat={(on) => session.setRepeat(on)}
          onmove={(id, delta) => session.moveTrack(id, delta)}
          oninfo={(t) => (infoTrack = t)}
        />
      {:else if session.mode === 'single'}
        <TtSingleRail
          track={playback.track}
          loops={playback.loops}
          crossfadeAvailable={false}
          loopStyle={settings.current.singleLoopStyle}
          onloopstyle={(style) => void settings.patch({ singleLoopStyle: style })}
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
          capped={true}
          onremove={onRemove}
          onjump={onJump}
          onshuffle={(on) => session.setShuffle(on)}
          onrepeat={(on) => session.setRepeat(on)}
          onmove={(id, delta) => session.moveTrack(id, delta)}
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
      onrestart={() => onStart(lastForce)}
      onback={() => {
        cancelAutoRestart();
        session.backToSetup();
        driver.reset();
        stopCurrentEngine();
      }}
    />
  {/if}

  <!-- docs/03 §4: Focus hides Z4–Z7. Z7 goes entirely rather than dimming —
       it is already auto-hiding chrome, and a ghost of it would read as a bug. -->
  {#if onPlayerScreen && !focusMode}
    <TtBottomBar
      track={session.mode === 'youtube' ? session.current : playback.track}
      positionMs={(session.mode === 'youtube' ? yt.positionMs : playback.positionMs) ?? 0}
      durationMs={session.mode === 'youtube' ? yt.durationMs : playback.durationMs}
      playing={transportPlaying}
      volume={settings.current.volume}
      muted={settings.current.muted}
      onplaypause={() => (session.state === 'playing' ? onPause() : onResume())}
      onstop={onStop}
      onvolume={(v) => void settings.patch({ volume: v }).then(applyVolume)}
      onmute={() => void settings.patch({ muted: !settings.current.muted }).then(applyVolume)}
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

  {#if settingsOpen}
    <TtSettings onclose={closeSettings} onvolume={applyVolume} onreset={onSettingsReset} />
  {/if}

  <!--
    docs/03 §2 and §4 both ask for a 3 s chip, for two different reasons — the
    way out of Focus, and why `]` did nothing in YouTube mode. One region, so
    they cannot stack on top of each other.
  -->
  <!--
    docs/03 §8's five polite milestones. The countdown itself has no `aria-live`
    — announcing every tick is spam — so this is where 10 min / 5 min / 1 min /
    10 s / zero are spoken. Visually hidden, never `display: none`, which would
    take it out of the accessibility tree along with the announcement.
  -->
  <p class="tt-sr" role="status" aria-live="polite" data-testid="tt-milestone">{milestone}</p>

  {#if hint === 'focus'}
    <p class="tt-hint-chip" role="status" data-testid="tt-hint">{i18n.t('player.focus.hint')}</p>
  {:else if hint === 'railLocked'}
    <p class="tt-hint-chip" role="status" data-testid="tt-hint">
      {i18n.t('player.focus.railLocked')}
    </p>
  {/if}

  <!-- docs/03 §6 endFlash. Decoration, so reduced motion removes it entirely. -->
  {#if flashing}
    <div class="tt-flash" data-testid="tt-flash" aria-hidden="true"></div>
  {/if}
</main>

<style>
  .tt-main {
    /*
     * Positioned, and above Z1 — docs/03 §2's stack has the background at the
     * bottom. `position: relative` does NOT trap the fixed overlays inside (only
     * transform/filter do), so the bottom bar, the settings sheet and the info
     * modal are unaffected.
     *
     * ⚠️ The 2rem padding is part of the YouTube reserve arithmetic
     * (`ytReserve` above: rail + rail padding + THIS). Change one, change both.
     */
    position: relative;
    z-index: var(--tt-z-main);
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 1.75rem;
    min-height: 100dvh;
    padding: 2rem;
  }
  /*
   * On Setup the countdown is a PREVIEW, and the two rack modules under it are
   * the work: at full size the clock alone took a third of a 720 px window and
   * a three-track queue pushed the page into a scroll. TtCountdown multiplies
   * only its preferred size by this, never its `cqw` cap (docs/03 §4), so a
   * smaller preview can only move the digits further from the player.
   */
  .tt-setup-screen {
    --tt-stage-scale: 0.66;
    gap: 1.25rem;
    padding-block: 1.25rem;
  }
  /* The bottom bar is fixed, so the player screen reserves room for it. */
  .tt-player {
    padding-bottom: 5rem;
  }
  /* Z7 is not rendered in Focus, so neither is its reserved space. The "dims
     Z1 further" half of docs/03 §4 belongs to TtBackdrop, which owns Z1. */
  .tt-main.tt-focus {
    padding-bottom: 2rem;
  }

  /* docs/03 §2 Z6 — the top-right keycaps: language, settings, fullscreen. */
  .tt-chrome {
    position: absolute;
    top: 1.1rem;
    right: 1.25rem;
    z-index: var(--tt-z-chrome);
    display: flex;
    gap: var(--tt-space-2);
  }

  /* docs/03 §2 Z5 — the brand plate: tally lamp, its ON AIR caption, wordmark. */
  .tt-brand {
    position: absolute;
    top: 1.1rem;
    left: 1.25rem;
    display: flex;
    gap: var(--tt-space-3);
    align-items: center;
    min-height: 40px;
    padding: 0 var(--tt-space-3);
    background: var(--color-tt-surface);
    border: 1px solid var(--color-tt-line);
    border-radius: var(--tt-radius-sm);
    box-shadow: var(--tt-shadow-key);
  }
  /* The unlit lamp is a dark red lens, not grey: hardware never loses colour. */
  .tt-tally {
    width: 10px;
    height: 10px;
    background: color-mix(in srgb, var(--color-tt-danger) 22%, var(--color-tt-void));
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 55%);
  }
  /*
   * docs/03 §1's beat-reactive tally. `--tt-beat` is 0–1 from the analyser, and
   * both the glow and the scale ride it continuously — a class toggle would
   * quantise the beat to a blink. In YouTube mode `--tt-beat` stays 0 and this
   * is the steady lamp docs/03 §1 specifies.
   */
  .tt-live {
    background: var(--color-tt-danger);
    box-shadow: 0 0 calc(8px + var(--tt-beat, 0) * 14px) var(--color-tt-danger);
    scale: calc(1 + var(--tt-beat, 0) * 0.5);
    transition:
      box-shadow var(--duration-tt-fast) linear,
      scale var(--duration-tt-fast) linear;
  }
  @media (prefers-reduced-motion: reduce) {
    /* docs/03 §8 lists the tally pulse among what reduced motion disables. */
    .tt-live {
      scale: 1;
      box-shadow: 0 0 8px var(--color-tt-danger);
      transition: none;
    }
  }
  .tt-onair {
    padding: 1px 6px;
    font-family: var(--font-display);
    font-size: var(--tt-text-xs);
    font-weight: 600;
    letter-spacing: 0.2em;
    color: var(--color-tt-muted);
    border: 1px solid var(--color-tt-line);
    border-radius: var(--tt-radius-xs);
    transition:
      color var(--duration-tt-base) var(--ease-tt),
      border-color var(--duration-tt-base) var(--ease-tt);
  }
  /* The glow is on the box, never the text: axe blends a text-shadow into the
     background it measures against. */
  .tt-onair-live {
    color: var(--color-tt-danger);
    border-color: color-mix(in srgb, var(--color-tt-danger) 55%, transparent);
    box-shadow: 0 0 12px -2px color-mix(in srgb, var(--color-tt-danger) 45%, transparent);
  }
  .tt-wordmark {
    font-family: var(--font-display);
    font-size: var(--tt-text-sm);
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-tt-text);
  }

  /* docs/03 §2: Z3 countdown with Z4 to its right. Geometry-bearing (§4). */
  .tt-stage {
    display: flex;
    gap: 2.5rem;
    align-items: center;
    justify-content: center;
    width: 100%;
  }

  /*
   * The size container the countdown's ToS cap reads (docs/03 §4).
   *
   * `flex: 1 1 0` plus `contain: inline-size` (which `container-type` applies)
   * means this column's width never depends on the digits inside it — it is
   * simply "the stage, minus the rail, minus the gap". No cycle.
   */
  .tt-clock {
    display: flex;
    flex: 1 1 0;
    justify-content: center;
    min-width: 0;
    container-type: inline-size;
  }

  /*
   * The 3 s chip (docs/03 §2, §4), styled as a status strip. Bottom-CENTRE: in
   * Focus the corners are exactly what has just been emptied. Right-inset by the
   * rail reserve so it can never reach the player rect.
   */
  .tt-hint-chip {
    position: fixed;
    bottom: 1.5rem;
    /* The centre of what the reserve leaves, not of the viewport: centred on
       the viewport, a chip only half the width cap could already cross into
       the rail's column at 1024 px. */
    left: calc((100vw - var(--tt-yt-reserve, 0px)) / 2);
    z-index: var(--tt-z-hint);
    translate: -50% 0;
    max-width: calc(100vw - var(--tt-yt-reserve, 0px) - 2rem);
    padding: var(--tt-space-2) var(--tt-space-4);
    font-family: var(--font-display);
    font-size: var(--tt-text-xs);
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--color-tt-text);
    background: var(--color-tt-surface);
    border: 1px solid var(--color-tt-outline);
    border-radius: var(--tt-radius-pill);
    box-shadow: var(--tt-shadow-panel);
    pointer-events: none;
  }

  /*
   * docs/03 §6: two 120 ms pulses at ≤ 20% over Z1, 400 ms total. It never
   * touches the digits — Z3 holds 0.000 (docs/04 §4). Inset by the YouTube
   * reserve like every other full-screen layer: even a 20% wash is an overlay
   * on the player rect, which docs/03 §2's carve-out does not allow.
   */
  .tt-flash {
    position: fixed;
    inset: 0 var(--tt-yt-reserve, 0px) 0 0;
    z-index: var(--tt-z-flash);
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
