import type { TtYtPlayerApi, TtYtPlayerEvents, TtYtPlayerPorts } from './tt-yt-player';

/**
 * The browser half of the player — docs/06 §2.
 *
 * Named `*-driver.ts` so the coverage gate skips it (docs/13 §1): it loads a
 * script and calls a constructor. Every decision lives in `tt-yt-player.ts`,
 * which is pure and fully unit-tested against a fake `create`.
 *
 * The IFrame API is loaded **lazily, on first entry into YouTube mode**. A user
 * who never opens the tab never contacts Google, which is what
 * `legal/PRIVACY-POLICY.md §4` promises about the local modes.
 */

/** The 384×216 slot docs/06 §1.2 requires. Not configurable — it is the ToS. */
export const YT_WIDTH = 384;
export const YT_HEIGHT = 216;

/*
 * Minimal shapes for what this file touches. The project ships no
 * `@types/youtube` and docs/12 §2 bans `any`.
 */
interface YtCtor {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => TtYtPlayerApi;
}

let loading: Promise<YtCtor> | null = null;

function loadApi(): Promise<YtCtor> {
  const existing = (globalThis as { YT?: YtCtor }).YT;
  if (existing?.Player) return Promise.resolve(existing);
  // One in-flight load, shared. Entering and leaving YouTube mode twice would
  // otherwise append the script twice and clobber the ready callback.
  if (loading !== null) return loading;

  loading = new Promise<YtCtor>((resolve, reject) => {
    (globalThis as { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady = () => {
      const yt = (globalThis as { YT?: YtCtor }).YT;
      if (yt?.Player) resolve(yt);
      else reject(new Error('YT.Player missing after ready'));
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => reject(new Error('iframe_api failed to load'));
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * @param mount the element the iframe replaces. Must already be laid out at
 *   384×216 — see `TtYouTubeRail`.
 */
export function browserPlayerPorts(mount: HTMLElement): TtYtPlayerPorts {
  return {
    create: (events: TtYtPlayerEvents): TtYtPlayerApi => {
      // The real player arrives asynchronously, so this returns a façade that
      // queues nothing and simply no-ops until it is swapped in. The state
      // machine already treats "not ready" as a valid state (it holds a
      // pendingId), so there is nothing to buffer here.
      let real: TtYtPlayerApi | null = null;

      void loadApi().then((yt) => {
        real = new yt.Player(mount, {
          /*
           * docs/06 §1.1 and CLAUDE.md invariant 2. **Never omit this.**
           * `host` DEFAULTS to www.youtube.com, which sets cookies — and the
           * shipped CSP still allows that origin in `frame-src` (docs/09 §4),
           * so a missing option would violate the invariant with nothing to
           * catch it. An E2E asserts no frame is created on that origin.
           */
          host: 'https://www.youtube-nocookie.com',
          width: YT_WIDTH,
          height: YT_HEIGHT,
          playerVars: {
            playsinline: 1,
            /*
             * `rel: 0` no longer suppresses related videos — since 2018 it only
             * restricts them to the same channel. The end screen is therefore
             * an overlay docs/06 §1.2's "nothing may overlap it" never
             * anticipated, and it is YouTube's own chrome rather than ours.
             * Kept because same-channel is still better than anyone's, and
             * recorded here so nobody re-adds it expecting the old behaviour.
             */
            rel: 0,
          },
          events: {
            onReady: () => events.onReady(),
            onStateChange: (e: { data: number }) => events.onStateChange(e.data),
            onError: (e: { data: number }) => events.onError(e.data),
          },
        });
      });

      const call = <K extends keyof TtYtPlayerApi>(fn: K): TtYtPlayerApi[K] =>
        ((...args: unknown[]) => {
          const target = real?.[fn] as ((...a: unknown[]) => unknown) | undefined;
          return target?.call(real, ...args);
        }) as TtYtPlayerApi[K];

      return {
        loadVideoById: call('loadVideoById'),
        playVideo: call('playVideo'),
        pauseVideo: call('pauseVideo'),
        setVolume: call('setVolume'),
        mute: call('mute'),
        unMute: call('unMute'),
        // Numbers, not void — the façade must return 0 rather than undefined
        // while the real player is still arriving, because `toMs` reads it.
        getDuration: () => real?.getDuration() ?? 0,
        getCurrentTime: () => real?.getCurrentTime() ?? 0,
        destroy: () => {
          real?.destroy();
          real = null;
        },
      };
    },
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (h) => {
      window.clearTimeout(h);
    },
  };
}
