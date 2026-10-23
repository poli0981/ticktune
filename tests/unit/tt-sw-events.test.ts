// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The /app/ service worker's EVENT WIRING — docs/10 §9 (v2.0).
 *
 * `tt-sw.test.ts` covers the two pure decisions (which route, which caches are
 * stale) and the built file. This covers what the worker does with them, which
 * until now only `pwa.spec.ts` exercised — and every rule below is one a
 * deploy or an offline start has already broken once:
 *
 * - the shell comes from THIS version's cache: `caches.match()` alone searches
 *   every cache in creation order, so the previous deploy's /app/ would win;
 * - every lookup ignores `Vary`: the preview server answers `Vary: Origin`, a
 *   module script is fetched WITH an Origin, and the offline start failed on
 *   its first script (measured);
 * - an asset falls back to ANY cache, because a tab opened before a deploy asks
 *   for chunks only the previous version still holds (TT-SYS-207's defect,
 *   one layer down) — which is also why activate keeps that one cache.
 *
 * The scope, CacheStorage and fetch are faked; the module is the real source,
 * imported fresh into a scope that passes its `ServiceWorkerGlobalScope` check.
 */

const ORIGIN = 'https://ticktune.net';
const VERSION = 'v2';
const CURRENT = `tt-shell-${VERSION}`;

/** Cache keys as the Cache API sees them: one URL, resolved against the scope. */
const keyOf = (req: RequestInfo | URL): string => {
  const url = new URL(req instanceof Request ? req.url : String(req), ORIGIN);
  return url.pathname + url.search;
};

class FakeCache {
  readonly store = new Map<string, Response>();
  readonly lookups: (CacheQueryOptions | undefined)[] = [];
  addAll(urls: string[]): Promise<void> {
    for (const url of urls) this.store.set(keyOf(url), new Response(`precached ${url}`));
    return Promise.resolve();
  }
  put(req: RequestInfo | URL, res: Response): Promise<void> {
    this.store.set(keyOf(req), res);
    return Promise.resolve();
  }
  match(req: RequestInfo | URL, opts?: CacheQueryOptions): Promise<Response | undefined> {
    this.lookups.push(opts);
    return Promise.resolve(this.store.get(keyOf(req)));
  }
}

/** Insertion-ordered, like the real thing: `match` searches oldest first. */
class FakeStorage {
  readonly all = new Map<string, FakeCache>();
  readonly lookups: (CacheQueryOptions | undefined)[] = [];
  open(name: string): Promise<FakeCache> {
    let cache = this.all.get(name);
    if (!cache) this.all.set(name, (cache = new FakeCache()));
    return Promise.resolve(cache);
  }
  keys(): Promise<string[]> {
    return Promise.resolve([...this.all.keys()]);
  }
  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.all.delete(name));
  }
  async match(req: RequestInfo | URL, opts?: CacheQueryOptions): Promise<Response | undefined> {
    this.lookups.push(opts);
    for (const cache of this.all.values()) {
      const hit = cache.store.get(keyOf(req));
      if (hit) return hit;
    }
    return undefined;
  }
}

type Listener = (event: unknown) => void;

class FakeScope {
  readonly listeners = new Map<string, Listener>();
  readonly skipWaiting = vi.fn(() => Promise.resolve());
  readonly clients = { claim: vi.fn(() => Promise.resolve()) };
  readonly location = { origin: ORIGIN };
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, fn);
  }
}

let scope: FakeScope;
let storage: FakeStorage;
const network = vi.fn<(req: Request) => Promise<Response>>();

/** A same-origin network answer — `type` is read-only on a constructed Response. */
const answer = (body: string, init: ResponseInit = {}, type: ResponseType = 'basic'): Response => {
  const res = new Response(body, init);
  Object.defineProperty(res, 'type', { value: type });
  return res;
};

/** Fire an extendable event and wait for what the worker handed `waitUntil`. */
async function lifecycle(type: 'install' | 'activate'): Promise<void> {
  let work: Promise<unknown> = Promise.resolve();
  scope.listeners.get(type)?.({ waitUntil: (p: Promise<unknown>) => (work = p) });
  await work;
}

/** Fire a fetch; `undefined` means the worker left it to the browser. */
async function request(path: string, method = 'GET'): Promise<Response | undefined> {
  let answered: Promise<Response> | undefined;
  scope.listeners.get('fetch')?.({
    request: new Request(new URL(path, ORIGIN), { method }),
    respondWith: (p: Promise<Response>) => (answered = p),
  });
  return answered;
}

beforeEach(async () => {
  scope = new FakeScope();
  storage = new FakeStorage();
  network.mockReset();
  vi.stubGlobal('ServiceWorkerGlobalScope', FakeScope);
  vi.stubGlobal('self', scope);
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('fetch', network);
  // What scripts/make-sw.ts prepends to the built worker.
  vi.stubGlobal('TT_PRECACHE', ['/app/', '/_astro/mount.abc.js', '/fonts/dseg7/DSEG7.woff2']);
  vi.stubGlobal('TT_SW_VERSION', VERSION);
  vi.resetModules();
  await import('../../src/sw/tt-sw');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('install', () => {
  it('precaches the build into this version’s cache, stamps it, and takes over', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_760_000_000_000);
    await lifecycle('install');

    const cache = storage.all.get(CURRENT);
    expect([...(cache?.store.keys() ?? [])]).toEqual([
      '/app/',
      '/_astro/mount.abc.js',
      '/fonts/dseg7/DSEG7.woff2',
      '/__tt-sw-installed',
    ]);
    expect(await cache?.store.get('/__tt-sw-installed')?.text()).toBe('1760000000000');
    expect(scope.skipWaiting).toHaveBeenCalledOnce();
  });
});

describe('activate', () => {
  const stamped = async (name: string, at: number | null) => {
    const cache = await storage.open(name);
    if (at !== null) await cache.put('/__tt-sw-installed', new Response(String(at)));
  };

  it('keeps this version and the newest before it, by install time — not by name', async () => {
    await stamped('tt-shell-zzz', 1); // oldest, though it sorts last by name
    await stamped('tt-shell-aaa', 5); // the version a pre-deploy tab still needs
    await stamped('tt-shell-mmm', 3);
    await stamped(CURRENT, 9);
    await lifecycle('activate');

    expect([...storage.all.keys()].sort()).toEqual([CURRENT, 'tt-shell-aaa'].sort());
    expect(scope.clients.claim).toHaveBeenCalledOnce();
  });

  it('counts an unstamped shell cache as the oldest, and never touches anyone else’s', async () => {
    await stamped('tt-shell-unstamped', null);
    await stamped('tt-shell-prev', 5);
    await stamped('someone-else', null);
    await stamped(CURRENT, 9);
    await lifecycle('activate');

    expect([...storage.all.keys()].sort()).toEqual(
      [CURRENT, 'someone-else', 'tt-shell-prev'].sort(),
    );
  });
});

describe('fetch — the shell, network first', () => {
  it('serves the network’s answer and refreshes this version’s copy', async () => {
    network.mockResolvedValue(answer('shell from the network'));
    const res = await request('/app/');

    expect(await res?.text()).toBe('shell from the network');
    // The page reads one body and the cache keeps another — a clone, not the original.
    expect(await storage.all.get(CURRENT)?.store.get('/app/')?.text()).toBe(
      'shell from the network',
    );
  });

  it('keeps the cached shell when the network answers with an error page', async () => {
    (await storage.open(CURRENT)).store.set('/app/', new Response('good shell'));
    network.mockResolvedValue(answer('bad gateway', { status: 502 }));
    const res = await request('/app/');

    expect(res?.status).toBe(502);
    expect(await storage.all.get(CURRENT)?.store.get('/app/')?.text()).toBe('good shell');
  });

  it('starts offline from THIS version’s shell, never the previous deploy’s', async () => {
    // Created first, so a bare caches.match() would find it first.
    (await storage.open('tt-shell-prev')).store.set('/app/', new Response('previous shell'));
    (await storage.open(CURRENT)).store.set('/app/', new Response('current shell'));
    network.mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await request('/app/?ttdebug=1');

    expect(await res?.text()).toBe('current shell');
    expect(storage.all.get(CURRENT)?.lookups).toEqual([{ ignoreVary: true }]);
  });

  it('fails like the network did when nothing is cached', async () => {
    network.mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await request('/app/');

    expect(res?.type).toBe('error');
  });
});

describe('fetch — hashed assets, cache first', () => {
  it('answers from this version’s cache without touching the network', async () => {
    (await storage.open(CURRENT)).store.set('/_astro/mount.abc.js', new Response('cached chunk'));
    const res = await request('/_astro/mount.abc.js');

    expect(await res?.text()).toBe('cached chunk');
    expect(network).not.toHaveBeenCalled();
  });

  it('serves a pre-deploy tab the chunk only the previous version still holds', async () => {
    (await storage.open('tt-shell-prev')).store.set(
      '/_astro/old.123.js',
      new Response('old chunk'),
    );
    await storage.open(CURRENT);
    const res = await request('/_astro/old.123.js');

    expect(await res?.text()).toBe('old chunk');
    expect(network).not.toHaveBeenCalled();
  });

  it('ignores Vary on every lookup — an Origin header must not turn a hit into a miss', async () => {
    await storage.open(CURRENT);
    network.mockResolvedValue(answer('chunk'));
    await request('/_astro/x.js');

    expect(storage.all.get(CURRENT)?.lookups).toEqual([{ ignoreVary: true }]);
    expect(storage.lookups).toEqual([{ ignoreVary: true }]);
  });

  it('stores a same-origin answer it had to fetch', async () => {
    network.mockResolvedValue(answer('fresh chunk'));
    const res = await request('/icons/icon-192.png');

    expect(await res?.text()).toBe('fresh chunk');
    expect(await storage.all.get(CURRENT)?.store.get('/icons/icon-192.png')?.text()).toBe(
      'fresh chunk',
    );
  });

  it.each([
    ['a 404', answer('missing', { status: 404 })],
    ['an opaque answer', answer('', {}, 'opaque')],
  ])('stores nothing for %s', async (_name, res) => {
    network.mockResolvedValue(res);
    await request('/_astro/gone.js');

    expect(storage.all.get(CURRENT)?.store.has('/_astro/gone.js')).toBe(false);
  });
});

describe('fetch — everything else is the browser’s', () => {
  it.each([
    ['/api/yt/oembed?id=dQw4w9WgXcQ', 'GET'],
    ['/en/legal/privacy/', 'GET'],
    ['/_astro/x.js', 'POST'],
    ['https://www.youtube.com/iframe_api', 'GET'],
  ])('leaves %s (%s) alone', async (path, method) => {
    expect(await request(path, method)).toBeUndefined();
    expect(network).not.toHaveBeenCalled();
  });
});

describe('outside a service worker', () => {
  it('wires nothing — the page and the tests import the same module', async () => {
    vi.unstubAllGlobals();
    const elsewhere = new FakeScope();
    vi.stubGlobal('self', elsewhere);
    vi.resetModules();
    await import('../../src/sw/tt-sw');

    expect(elsewhere.listeners.size).toBe(0);
  });
});
