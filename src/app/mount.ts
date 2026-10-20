import { mount } from 'svelte';
import TtApp from './TtApp.svelte';
import { ttLog } from './engine/log/tt-log';

/**
 * Island entry point — docs/01 §3 mount decision.
 *
 * Reached ONLY through the guarded dynamic import in src/pages/app/index.astro,
 * so nothing in this module graph (and therefore no engine, no AudioContext, no
 * Dexie, no Worker) is ever fetched on a blocked viewport.
 *
 * Deliberately not an Astro client directive: `client:only` fetches and
 * hydrates regardless of the gate, and a custom directive would put TtApp
 * through SSR. Both were measured — see docs/01 §3.
 */
const target = document.getElementById('tt-app');
if (target) {
  mount(TtApp, { target });
  document.documentElement.dataset['ttMounted'] = '1';
}

/*
 * docs/10 §9 (v2.0) — the service worker that lets the local modes start
 * offline. Production builds only: under `astro dev` a worker caching Vite's
 * unhashed modules would serve stale code. Registered from here, inside the
 * gate's guard like everything else in the island, so a blocked viewport
 * never installs it and no inline script (no new CSP hash) is needed. After
 * `load`, so its precache never competes with the first render.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const register = (): void => {
    navigator.serviceWorker.register('/sw.js', { scope: '/app/' }).catch((e: unknown) => {
      ttLog.warn('TT-SYS-211', e instanceof Error ? e.name : '');
    });
  };
  if (document.readyState === 'complete') register();
  else addEventListener('load', register, { once: true });
}
