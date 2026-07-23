import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TtYtPlayerEvents } from '../../src/app/engine/youtube/tt-yt-player';
import type * as DriverMod from '../../src/app/engine/youtube/tt-yt-player-driver';

/**
 * The driver's constructor options — CLAUDE.md invariant 2 and docs/06 §1.1/§1.2.
 *
 * ## Why this file exists at all
 *
 * `tt-yt-player.ts:57` said the host "is asserted in a test rather than
 * trusted", and `tt-yt-player-driver.ts:70` said "An E2E asserts no frame is
 * created on that origin". Neither test existed: `grep -rn nocookie` across the
 * repo on 2026-07-23 matched source and the S1 spike, and nothing under
 * `tests/`. The invariant with the strongest wording in the project was the one
 * with no coverage.
 *
 * `docs/13 §1` excludes `*-driver.ts` from the ≥85% gate because these files
 * "are covered where they actually run: Playwright (§3)" — which was also
 * unkept. The exclusion is about the coverage THRESHOLD, not a ban on testing,
 * and the three options below are pure data on a call nobody needs a browser to
 * observe. The E2E half (no frame on `www.youtube.com` in a real bundle) is
 * still owed and lives in `tests/e2e/`.
 *
 * `host` **defaults to `www.youtube.com`**, which sets cookies, and the shipped
 * CSP still permits that origin in `frame-src` (docs/09 §4) — so omitting the
 * option would violate the invariant with nothing anywhere to catch it.
 */

interface Built {
  mount: HTMLElement;
  opts: Record<string, unknown>;
}

let built: Built[];
let browserPlayerPorts: typeof DriverMod.browserPlayerPorts;
let YT_WIDTH: number;
let YT_HEIGHT: number;

const noopEvents: TtYtPlayerEvents = {
  onReady: () => {},
  onStateChange: () => {},
  onError: () => {},
};

beforeEach(async () => {
  vi.resetModules();
  built = [];
  // Present before the driver looks, so `loadApi()` takes its short-circuit and
  // no script tag is appended: docs/13 §4 forbids CI depending on YouTube.
  (globalThis as Record<string, unknown>)['YT'] = {
    Player: class {
      constructor(mount: HTMLElement, opts: Record<string, unknown>) {
        built.push({ mount, opts });
      }
      destroy(): void {}
    },
  };
  ({ browserPlayerPorts, YT_WIDTH, YT_HEIGHT } =
    await import('../../src/app/engine/youtube/tt-yt-player-driver'));
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['YT'];
});

/** The real player arrives a microtask later — `loadApi()` returns a promise. */
async function create(): Promise<Built> {
  const mount = document.createElement('div');
  browserPlayerPorts(mount).create(noopEvents);
  await Promise.resolve();
  await Promise.resolve();
  const first = built[0];
  if (first === undefined) throw new Error('the driver never constructed a player');
  return first;
}

describe('the player is built on the privacy-enhanced host — invariant 2', () => {
  it('passes host: youtube-nocookie.com explicitly', async () => {
    const { opts } = await create();
    // Not `toContain` — the default is a DIFFERENT origin that would still
    // contain "youtube", and that is precisely the mistake being guarded.
    expect(opts['host']).toBe('https://www.youtube-nocookie.com');
  });

  it('never leaves the host to default', async () => {
    const { opts } = await create();
    expect(opts['host']).toBeDefined();
    expect(String(opts['host'])).not.toContain('www.youtube.com');
  });

  it('appends no script when the API is already present', async () => {
    await create();
    // The short-circuit is what keeps this test — and CI — off YouTube's
    // servers entirely (docs/13 §4).
    expect(document.querySelector('script[src*="iframe_api"]')).toBeNull();
  });
});

describe('the player is built at the ToS size — docs/06 §1.2', () => {
  it('requests 384×216, the slot the rail reserves', async () => {
    const { opts } = await create();
    expect(opts['width']).toBe(YT_WIDTH);
    expect(opts['height']).toBe(YT_HEIGHT);
  });

  it('is at or above the 200×200 floor in BOTH dimensions', () => {
    // The floor is square. A 16:9 slot satisfies it only because 216 > 200 —
    // deriving the height bound from the aspect ratio instead would pass at
    // 200×113, which is a ToS violation the assertion exists to prevent.
    expect(YT_WIDTH).toBeGreaterThanOrEqual(200);
    expect(YT_HEIGHT).toBeGreaterThanOrEqual(200);
  });
});

describe('the façade that stands in until the real player arrives', () => {
  it('reports duration as 0 rather than undefined', () => {
    // `toMs` reads this and maps 0 to null ("not known yet"). `undefined` would
    // reach `Number.isFinite` as NaN — same answer by accident, and it would
    // stop being an accident the day the mapping changes.
    const ports = browserPlayerPorts(document.createElement('div'));
    const api = ports.create(noopEvents);
    expect(api.getDuration()).toBe(0);
    expect(api.getCurrentTime()).toBe(0);
  });

  it('swallows transport calls made before the player exists', () => {
    const ports = browserPlayerPorts(document.createElement('div'));
    const api = ports.create(noopEvents);
    // The state machine treats "not ready" as valid and holds a pendingId, so
    // these must be no-ops rather than throws.
    expect(() => {
      api.loadVideoById('dQw4w9WgXcQ');
      api.playVideo();
      api.pauseVideo();
      api.setVolume(50);
      api.mute();
      api.unMute();
      api.destroy();
    }).not.toThrow();
  });
});
