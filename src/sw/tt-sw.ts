/// <reference lib="webworker" />

/**
 * The /app/ service worker — docs/10 §9 (v2.0): the local modes start offline.
 *
 * scripts/make-sw.ts builds this into dist/sw.js: it prepends the two constants
 * declared below — the precache list and its version — and strips `export`,
 * because a classic service worker has no module to export from. The routing
 * and cleanup decisions are exported for the unit tests; the event wiring at
 * the bottom only runs inside a service worker.
 *
 * What it never touches:
 * - another origin — YouTube's player and API, Google, the analytics beacon;
 * - `/api/*` — oEmbed and lengths are live answers, and a cached one would be
 *   a lie about the network (docs/06 §8);
 * - the user's files — `blob:` URLs never reach a fetch handler, and nothing
 *   here stores anything the app did not ship (hard invariant 1).
 */

declare const TT_PRECACHE: readonly string[];
declare const TT_SW_VERSION: string;

/** `shell`: network first, the cached /app/ when offline. `asset`: cache first. */
export type TtSwRoute = 'shell' | 'asset' | 'network';

export function ttSwRoute(url: URL, method: string, origin: string): TtSwRoute {
  if (method !== 'GET' || url.origin !== origin) return 'network';
  if (url.pathname.startsWith('/api/')) return 'network';
  if (url.pathname === '/app/' || url.pathname === '/app/index.html') return 'shell';
  // Everything the precache holds. Hashed or pinned, or versioned by this
  // worker's own version (the icons, the favicon, the manifest).
  if (/^\/(?:_astro|fonts|icons)\//.test(url.pathname)) return 'asset';
  if (url.pathname === '/favicon.svg' || url.pathname === '/manifest.webmanifest') return 'asset';
  return 'network';
}

export const TT_SW_PREFIX = 'tt-shell-';

/**
 * Caches to drop on activate: every shell cache but this version's and the
 * newest one before it. That one stays because a tab opened before a deploy
 * still asks for ITS chunks, which the deploy removed from the server — the
 * defect TT-SYS-207 was registered for, one layer down.
 */
export function ttSwStale(
  caches: ReadonlyArray<{ name: string; installedAt: number }>,
  current: string,
): string[] {
  return caches
    .filter((c) => c.name.startsWith(TT_SW_PREFIX) && c.name !== current)
    .sort((a, b) => b.installedAt - a.installedAt)
    .slice(1)
    .map((c) => c.name);
}

if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
  const sw = self as unknown as ServiceWorkerGlobalScope;
  const CACHE = TT_SW_PREFIX + TT_SW_VERSION;
  const INSTALLED = '/__tt-sw-installed';

  sw.addEventListener('install', (event) => {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE);
        await cache.addAll([...TT_PRECACHE]);
        await cache.put(INSTALLED, new Response(String(Date.now())));
        await sw.skipWaiting();
      })(),
    );
  });

  sw.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        const listed = await Promise.all(
          (await caches.keys()).map(async (name) => {
            const stamp = await (await caches.open(name)).match(INSTALLED);
            return { name, installedAt: Number((await stamp?.text()) ?? 0) };
          }),
        );
        await Promise.all(ttSwStale(listed, CACHE).map((name) => caches.delete(name)));
        await sw.clients.claim();
      })(),
    );
  });

  /*
   * THIS version's cache first, always. `caches.match()` alone searches every
   * cache in creation order, so the previous version's copy of an unhashed
   * file — /app/ itself — would win, and an offline start would boot the app
   * as it was one deploy ago.
   */
  const shell = async (request: Request): Promise<Response> => {
    const current = await caches.open(CACHE);
    try {
      const res = await fetch(request);
      if (res.ok) await current.put('/app/', res.clone());
      return res;
    } catch {
      return (await current.match('/app/')) ?? Response.error();
    }
  };

  // …then any cache: a tab opened before a deploy asks for its own chunks,
  // which only the previous version's cache still holds.
  const asset = async (request: Request): Promise<Response> => {
    const current = await caches.open(CACHE);
    const hit = (await current.match(request)) ?? (await caches.match(request));
    if (hit) return hit;
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') await current.put(request, res.clone());
    return res;
  };

  sw.addEventListener('fetch', (event) => {
    const route = ttSwRoute(new URL(event.request.url), event.request.method, sw.location.origin);
    if (route === 'network') return;
    event.respondWith(route === 'shell' ? shell(event.request) : asset(event.request));
  });
}
