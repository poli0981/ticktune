import { mount } from 'svelte';
import TtApp from './TtApp.svelte';

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
