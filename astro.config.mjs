// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
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

  integrations: [svelte()],

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
