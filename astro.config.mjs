// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Normative copy lives in docs/01 §5. Keep the two in sync.
export default defineConfig({
  // No SSR — docs/01 §6 non-goal. Exactly one dynamic route exists and it is a
  // Cloudflare Worker (worker/index.ts), not an Astro endpoint.
  output: 'static',

  // Required before P6: hreflang alternates + canonical URLs are a P6 exit
  // criterion and Astro cannot emit absolute ones without it (docs/08 §1).
  site: 'https://ticktune.net',

  // The app island is NOT mounted with an Astro client directive — see the
  // measured mount decision in docs/01 §3. src/pages/app/index.astro hand-mounts
  // src/app/mount.ts behind the docs/07 §3.2 guard, which is the only variant
  // that both skips SSR and fetches nothing on a blocked viewport.
  integrations: [
    svelte(),
    /*
     * Sitemap — P6.
     *
     * Build-time only: it emits static XML and ships nothing into the bundle,
     * so per docs/11 §5 it is dev tooling like Astro/Vite/Tailwind and gets a
     * GPL-compat check (MIT ✓) but **no `legal/THIRD-PARTY-NOTICES.md` row**.
     *
     * Derived from the routes actually built, which is the point: a
     * hand-authored sitemap is a second source of truth that rots the first
     * time someone adds a page.
     *
     * ⚠️ Deliberately NOT using the integration's `i18n` option. It assumes
     * every locale is a path prefix (`/vi/`, `/en/`), and TickTune's Vietnamese
     * lives at the root with no prefix (docs/08 §1) — so its automatic
     * `<xhtml:link>` pairing would be wrong. hreflang is carried by the in-page
     * `<link rel="alternate">` tags that `TtBase.astro` emits, which is what
     * search engines read and what the P6 exit criterion is about. One
     * mechanism, not two disagreeing ones.
     */
    sitemap({
      filter: (page) =>
        // The app is not content; the spikes are throwaway harnesses; a 404 in
        // a sitemap is a soft-404 waiting to happen.
        !page.includes('/app') && !page.includes('/spike/') && !page.includes('/404'),
    }),
  ],

  vite: {
    plugins: [tailwindcss()],
    define: {
      // Read by the About panel (docs/03 §6) and the diagnostics payload
      // (docs/02 §7). package.json is the single source of the version;
      // docs/14 §5 bumps it there and nowhere else.
      __TT_VERSION__: JSON.stringify(version),
    },
  },
});
