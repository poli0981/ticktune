// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { satteri } from '@astrojs/markdown-satteri';
import { readFileSync } from 'node:fs';
import { TT_LEGAL_DOCS } from './src/lib/tt-legal-const.ts';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * Rewrite the legal documents' `.md` cross-links to site routes — P6 slice B.
 *
 * `legal/EULA.md` links to `./DISCLAIMER.md` and `./PRIVACY-POLICY.md` so that
 * the drafts read correctly on GitHub, which is where they are reviewed. Left
 * alone those two links 404 on the rendered page, so they are rewritten here
 * rather than in the source — editing the source would fix the page and break
 * the review surface.
 *
 * Language comes from the **file path**: `legal/vi/*.md` is only ever rendered
 * by a `/legal/*` route and `legal/*.md` only by `/en/legal/*`, so the file
 * already knows which prefix it needs. That is why this can be one plugin
 * instead of a per-page option.
 *
 * The filename → slug mapping is NOT derivable (`PRIVACY-POLICY.md` →
 * `privacy`), so it comes from the one table in `tt-legal-const.ts` that the
 * pages and the tests read too. `tests/e2e/legal.spec.ts` asserts no rendered
 * legal href ends in `.md`, which fails if a new cross-link appears that this
 * does not know about.
 *
 * ⚠️ This is an **mdast plugin for Sätteri**, not a remark plugin. Astro 7 made
 * Sätteri the default Markdown processor, and `markdown.remarkPlugins` now
 * requires installing `@astrojs/markdown-remark` to switch the pipeline back to
 * unified. Adding a dependency and changing the processor to rewrite two links
 * is the wrong trade — `mdastPlugins` is the native seam and costs nothing.
 * `link` and `definition` are the only two mdast nodes that carry a `url`.
 */
function ttLegalLinksPlugin() {
  const bySource = new Map(TT_LEGAL_DOCS.map((d) => [d.file.toLowerCase(), d.slug]));

  /** `legal/vi/EULA.md` → `/legal`, `legal/EULA.md` → `/en/legal`. */
  const prefixFor = (ctx) =>
    /\/legal\/vi\//.test(String(ctx.fileURL ?? '')) ? '/legal' : '/en/legal';

  const rewrite = (node, ctx) => {
    const [, name, hash = ''] = /([^/]+\.md)(#.*)?$/i.exec(String(node.url ?? '')) ?? [];
    const slug = name && bySource.get(name.toLowerCase());
    if (slug) ctx.setProperty(node, 'url', `${prefixFor(ctx)}/${slug}${hash}`);
  };

  return { name: 'tt-legal-links', link: rewrite, definition: rewrite };
}

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

  markdown: {
    // P6 slice B — see ttLegalLinksPlugin above. The legal bodies are the only
    // markdown this project renders. Passed as a factory so its closure is
    // rebuilt per compile rather than shared across documents.
    processor: satteri({ mdastPlugins: [ttLegalLinksPlugin] }),
  },

  vite: {
    plugins: [tailwindcss()],

    build: {
      /*
       * Never inline a font as a `data:` URL — docs/09 §4.
       *
       * Vite inlines assets under ~4 KB by default, and several of the
       * fontsource subsets fall under it. The CSP says `font-src 'self'` with
       * **no `data:`**, so the browser blocked every inlined face: three failed
       * requests and four console errors on the live landing page, which is
       * what pulled Lighthouse "Best Practices" down to 92 against a ≥ 95 exit
       * criterion. The page still rendered — the non-inlined faces covered it —
       * so nothing looked wrong.
       *
       * Fixed here rather than by adding `data:` to `font-src`: the CSP is
       * deliberately tight (docs/09), and `data:` in `font-src` would be a real
       * loosening to work around a bundler default. Emitting every face as a
       * file also lets the `/_astro/*` immutable cache rule apply to it.
       */
      assetsInlineLimit: (filePath) =>
        /\.(woff2?|ttf|otf|eot)$/i.test(filePath) ? false : undefined,
    },
    define: {
      // Read by the About panel (docs/03 §6) and the diagnostics payload
      // (docs/02 §7). package.json is the single source of the version;
      // docs/14 §5 bumps it there and nowhere else.
      __TT_VERSION__: JSON.stringify(version),
    },
  },
});
