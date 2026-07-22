<script lang="ts">
  import { onMount } from 'svelte';

  /**
   * Spike S1 harness — the YouTube error matrix and playback chain (docs/15 §S1).
   *
   * THROWAWAY, like the S3 and S4 harnesses beside it. It is **instrumentation,
   * not feature code**, which is what keeps it inside the docs/15 scope rule:
   * the rule holds YouTube *feature* code behind S1, and a spike cannot measure
   * a player without opening one. Nothing here is imported by the app.
   *
   * Three things this measures that a bare page cannot:
   *
   * 1. **The player lives inside a mock of the real Z4 rail**, with the `]`
   *    collapse and Focus mode both reachable. docs/03 §2/§4 let either hide the
   *    rail; docs/06 §1.2 forbids the player ever being hidden while a video
   *    plays. Those two rules conflict, and only a rail-shaped harness shows it.
   * 2. **CSP violations are captured and displayed.** docs/09 §4 allows
   *    `script-src https://www.youtube.com` but NOT `s.ytimg.com`, and the audit
   *    suspects the loader injects `www-widgetapi.js` from there. If so the API
   *    never loads on the deployed site — a finding, not a broken harness, so it
   *    has to be reported as one rather than looking like a hang.
   * 3. **Hands-free advance.** One gesture, then the queue must walk itself.
   */

  /* Minimal shapes for the bits of the IFrame API this harness touches. The
     project ships no `@types/youtube` and docs/12 §2 bans `any`. */
  interface YtPlayer {
    playVideo: () => void;
    loadVideoById: (id: string) => void;
    getPlayerState: () => number;
    destroy: () => void;
  }
  interface YtEvent {
    data: number;
    target: YtPlayer;
  }
  interface YtCtor {
    Player: new (el: HTMLElement, opts: Record<string, unknown>) => YtPlayer;
  }

  const STATE: Record<number, string> = {
    [-1]: 'unstarted',
    0: 'ENDED',
    1: 'playing',
    2: 'paused',
    3: 'buffering',
    5: 'cued',
  };

  /**
   * docs/06 §4, verbatim. The acceptance criterion is that no run ever lands in
   * `unknown` — that bucket existing in the code is the point.
   */
  function classify(code: number): string {
    if (code === 2) return 'yt.err.invalid (TT-YT-002)';
    if (code === 5) return 'yt.err.player (TT-YT-005)';
    if (code === 100) return 'yt.err.gone (TT-YT-100)';
    if (code === 101 || code === 150) return 'yt.err.blocked (TT-YT-101/150)';
    return `⚠️ UNKNOWN (${code}) — docs/06 §4 has no row for this`;
  }

  const CURATED = [
    'dQw4w9WgXcQ  # normal — re-verified 200 on 2026-07-22',
    'jNQXAC9IVRw  # normal — "Me at the zoo", oldest and most stable id on the site',
    'M7lc1UVf-VE  # normal — YouTube own IFrame API demo',
    'aaaaaaaaaaa  # no such video — expect onError 100',
  ].join('\n');

  let ids = $state(CURATED);
  let log = $state<string[]>([]);
  let apiState = $state<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  let violations = $state<string[]>([]);
  let queue = $state<string[]>([]);
  let cursor = $state(0);
  let advances = $state(0);
  let gestures = $state(0);
  let collapsed = $state(false);
  let focusMode = $state(false);

  let host = $state<HTMLDivElement | null>(null);
  let player: YtPlayer | null = null;
  let started = 0;

  function stamp(): string {
    const ms = started ? Math.round(performance.now() - started) : 0;
    return `+${String(ms).padStart(6, ' ')}ms`;
  }

  function say(line: string) {
    log = [...log, `${stamp()}  ${line}`];
  }

  const parsed = $derived(
    ids
      .split('\n')
      .map((l) => l.split('#')[0]?.trim() ?? '')
      .filter(Boolean)
      // Accept a bare id or any URL shape docs/06 §5 lists.
      .map((l) => /([\w-]{11})(?:\D|$)/.exec(l)?.[1] ?? l),
  );

  onMount(() => {
    // Captured BEFORE the loader is injected, or the very violation this exists
    // to catch would fire before anyone is listening.
    const onViolation = (e: SecurityPolicyViolationEvent) => {
      violations = [...violations, `${e.violatedDirective} blocked ${e.blockedURI}`];
    };
    document.addEventListener('securitypolicyviolation', onViolation);
    return () => {
      document.removeEventListener('securitypolicyviolation', onViolation);
      player?.destroy();
    };
  });

  function loadApi(): Promise<YtCtor> {
    const existing = (globalThis as { YT?: YtCtor }).YT;
    if (existing?.Player) return Promise.resolve(existing);

    apiState = 'loading';
    return new Promise((resolve, reject) => {
      (globalThis as { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady = () => {
        const yt = (globalThis as { YT?: YtCtor }).YT;
        if (yt?.Player) resolve(yt);
        else reject(new Error('YT.Player missing after ready'));
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => reject(new Error('iframe_api script failed to load'));
      document.head.appendChild(s);
      // The loader resolving is not the same as the API arriving: if
      // s.ytimg.com is CSP-blocked the script loads and then goes quiet.
      setTimeout(
        () => reject(new Error('timeout — API never called onYouTubeIframeAPIReady')),
        15_000,
      );
    });
  }

  /** The ONE user gesture. Everything after this must be hands-free. */
  async function start() {
    gestures += 1;
    started = performance.now();
    log = [];
    violations = [];
    advances = 0;
    cursor = 0;
    queue = parsed;
    say(`queue = ${queue.length} ids: ${queue.join(', ')}`);

    let yt: YtCtor;
    try {
      yt = await loadApi();
      apiState = 'ready';
      say('IFrame API ready');
    } catch (err) {
      apiState = 'failed';
      say(`✖ API DID NOT LOAD: ${err instanceof Error ? err.message : String(err)}`);
      say('If a CSP row appeared below, that IS the finding — docs/09 §4 omits s.ytimg.com.');
      return;
    }

    const first = queue[0];
    if (!first || !host) return;

    player?.destroy();
    player = new yt.Player(host, {
      // docs/06 §1.1 and CLAUDE.md invariant 2 — nocookie host, no exceptions.
      host: 'https://www.youtube-nocookie.com',
      videoId: first,
      width: 384,
      height: 216,
      playerVars: { playsinline: 1, rel: 0 },
      events: {
        onReady: (e: YtEvent) => {
          say(`onReady — playing ${queue[cursor]}`);
          e.target.playVideo();
        },
        onStateChange: (e: YtEvent) => {
          say(`onStateChange ${e.data} (${STATE[e.data] ?? '?'}) — ${queue[cursor]}`);
          if (e.data === 0) next('ended');
        },
        onError: (e: YtEvent) => {
          say(`onError ${e.data} → ${classify(e.data)} — ${queue[cursor]}`);
          // docs/06 §4 skips after 5 s; shortened here so a run stays brisk.
          setTimeout(() => next('error'), 1_500);
        },
      },
    });
  }

  function next(why: string) {
    if (cursor >= queue.length - 1) {
      say(`queue finished after ${advances} hands-free advance(s), ${gestures} gesture(s)`);
      return;
    }
    cursor += 1;
    advances += 1;
    const id = queue[cursor];
    say(`advance (${why}) → ${id}`);
    if (id) player?.loadVideoById(id);
  }

  async function copyLog() {
    await navigator.clipboard.writeText(
      [
        `# S1 run — ${new Date().toISOString()}`,
        `# ua: ${navigator.userAgent}`,
        `# gestures: ${gestures} · advances: ${advances} · api: ${apiState}`,
        '',
        ...log,
        '',
        '# CSP violations',
        ...(violations.length ? violations : ['(none)']),
      ].join('\n'),
    );
  }
</script>

<div class="tt-spike">
  <h1>Spike S1 — YouTube matrix</h1>

  <div class="tt-cols">
    <section class="tt-left">
      <label>
        <span>Video ids or URLs — one per line, `#` for comments</span>
        <textarea bind:value={ids} rows="8" data-testid="s1-ids"></textarea>
      </label>

      <div class="tt-actions">
        <button class="tt-go" onclick={start} data-testid="s1-start">
          ▶ Start (the ONE gesture)
        </button>
        <button onclick={copyLog}>Copy log</button>
        <button onclick={() => (collapsed = !collapsed)}>
          {collapsed ? 'Show rail (])' : 'Collapse rail (])'}
        </button>
        <button onclick={() => (focusMode = !focusMode)}>
          {focusMode ? 'Exit Focus (H)' : 'Focus mode (H)'}
        </button>
      </div>

      <p class="tt-meta">
        API: <strong>{apiState}</strong> · gestures: <strong>{gestures}</strong> · hands-free
        advances: <strong>{advances}</strong>
      </p>

      {#if violations.length}
        <div class="tt-violations">
          <strong>CSP violations — this is a FINDING, not a harness bug</strong>
          <ul>
            {#each violations as v, i (i)}<li>{v}</li>{/each}
          </ul>
        </div>
      {/if}

      <pre class="tt-log" data-testid="s1-log">{log.join('\n')}</pre>
    </section>

    <!--
      A mock of the docs/03 §2 Z4 rail, not a bare page. The two buttons above
      drive the exact affordances that can hide it — `]` and Focus — because
      docs/06 §1.2 forbids the player being hidden while a video is playing and
      docs/03 §2 already carves an exception for that. This is where you check
      whether the carve-out actually holds.
    -->
    <aside class="tt-rail" class:tt-collapsed={collapsed} class:tt-focus={focusMode}>
      <div class="tt-badge">Z4 · YOUTUBE (mock rail)</div>
      <div class="tt-player" bind:this={host}></div>
      <p class="tt-hint">
        The player must stay fully visible and unobscured at 384×216 whenever a video is playing —
        including with the rail collapsed and in Focus mode.
      </p>
    </aside>
  </div>
</div>

<style>
  .tt-spike {
    padding: 1.25rem;
    color: var(--color-tt-text);
    font-family: var(--font-ui);
  }
  h1 {
    font-size: 1rem;
    letter-spacing: 0.08em;
    color: var(--color-tt-signal);
  }
  .tt-cols {
    display: flex;
    gap: 1.5rem;
    align-items: start;
    margin-top: 1rem;
  }
  .tt-left {
    display: grid;
    gap: 0.6rem;
    flex: 1;
    min-width: 0;
  }
  label {
    display: grid;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--color-tt-muted);
  }
  textarea {
    width: 100%;
    padding: 0.5rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--color-tt-text);
    background: var(--color-tt-surface);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.25rem;
  }
  .tt-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  button {
    padding: 0.3rem 0.7rem;
    font-size: 0.75rem;
    color: var(--color-tt-muted);
    background: transparent;
    border: 1px solid var(--color-tt-line);
    border-radius: 0.25rem;
  }
  .tt-go {
    color: var(--color-tt-signal);
    border-color: var(--color-tt-signal);
  }
  .tt-meta {
    font-size: 0.75rem;
    color: var(--color-tt-muted);
  }
  .tt-violations {
    padding: 0.5rem 0.7rem;
    font-size: 0.72rem;
    color: var(--color-tt-danger);
    border: 1px solid var(--color-tt-danger);
    border-radius: 0.25rem;
  }
  .tt-log {
    max-height: 22rem;
    margin: 0;
    padding: 0.6rem;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    line-height: 1.5;
    white-space: pre-wrap;
    background: var(--color-tt-surface);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.25rem;
  }
  .tt-rail {
    display: grid;
    gap: 0.5rem;
    width: 25rem;
    padding: 0.9rem;
    background: color-mix(in srgb, var(--color-tt-surface) 80%, transparent);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.5rem;
  }
  /* Deliberately the NAIVE behaviours, so the conflict is observable rather
     than designed away: docs/03 §2's carve-out says the rail must NOT do this
     in YouTube mode, and the point of the spike is to see it happen. */
  .tt-collapsed {
    display: none;
  }
  .tt-focus {
    opacity: 0.06;
  }
  .tt-badge {
    font-size: 0.62rem;
    letter-spacing: 0.14em;
    color: var(--color-tt-muted);
  }
  .tt-player {
    width: 384px;
    height: 216px;
    background: #000;
  }
  .tt-hint {
    font-size: 0.68rem;
    color: var(--color-tt-muted);
  }
</style>
