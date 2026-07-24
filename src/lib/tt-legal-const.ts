/**
 * Version of the legal set (EULA + Disclaimer + Privacy Policy).
 *
 * Stored alongside the user's acceptance as `legalAccepted.version`
 * (docs/02 §3.1). Bumping it re-shows the Legal Gate on next boot — the
 * mechanism `legal/PRIVACY-POLICY.md §7` and `legal/EULA.md §1` promise when
 * they say material changes re-trigger the gate.
 *
 * Bump in the same PR that materially changes any `legal/*.md`. Do not bump for
 * typos: every bump re-prompts every existing user.
 *
 * ⚠️ P6 slice B added the Vietnamese translations and deliberately did **not**
 * bump for them: publishing a translation of an unchanged document changes
 * nobody's rights, and re-prompting every user over it would be the larger harm.
 *
 * 🔴 **It bumped `1.0-draft` → `1.1-draft` for a different reason**, and the
 * distinction is what this constant is for. `PRIVACY-POLICY.md` stated that
 * TickTune "stores no server-side logs of its own about you" while
 * `wrangler.jsonc` had `observability.enabled` — which retains one log entry per
 * `/api/yt/oembed` call for three days. That is not a typo: users accepted a
 * description of our data handling that was **untrue**, and consent given to an
 * inaccurate description is not consent. `PRIVACY-POLICY.md §7` promises the
 * gate returns for exactly this, so it does.
 *
 * Promoting `1.1-draft` → `1.0` is still a P7 launch decision.
 */
export const TT_LEGAL_VERSION = '1.1-draft';

/**
 * The legal set, as one table.
 *
 * The route slug is **not** derivable from the filename — `PRIVACY-POLICY.md`
 * is served at `/legal/privacy` and `THIRD-PARTY-NOTICES.md` at
 * `/legal/third-party` — so the mapping has to be written down once. Four
 * consumers read it and would otherwise drift: the pages, the remark plugin in
 * `astro.config.mjs` that rewrites EULA's `.md` cross-links, `TT_LEGAL_LINKS`
 * below, and `tests/unit/tt-legal-parity.test.ts`.
 *
 * `id` is what Astro's content layer derives from the filename (`glob()`
 * slugifies it), so it is the key for `getEntry()`.
 */
export const TT_LEGAL_DOCS = [
  { key: 'eula', file: 'EULA.md', id: 'eula', slug: 'eula' },
  { key: 'disclaimer', file: 'DISCLAIMER.md', id: 'disclaimer', slug: 'disclaimer' },
  { key: 'privacy', file: 'PRIVACY-POLICY.md', id: 'privacy-policy', slug: 'privacy' },
  {
    key: 'thirdParty',
    file: 'THIRD-PARTY-NOTICES.md',
    id: 'third-party-notices',
    slug: 'third-party',
  },
] as const;

/** The four documents' keys — the gate, the About panel and the footer all link these. */
export type TtLegalKey = (typeof TT_LEGAL_DOCS)[number]['key'];

/**
 * Where the legal links point.
 *
 * P6 slice B moved these from GitHub blob URLs to on-site routes. `repo` stays
 * absolute: it is the GPL-3.0 §6 source offer, which must point at the source,
 * not at a page about it.
 *
 * ⚠️ These are the **Vietnamese** routes. Anything rendering for an English
 * reader must go through `ttLegalHref()` — see the warning there.
 *
 * ⚠️ **The trailing slash is required, not cosmetic.** `build.format` is
 * `'directory'`, so the built route is `dist/legal/eula/index.html` and the host
 * answers `/legal/eula` with a **307** to `/legal/eula/`. Without the slash every
 * legal link in the app costs an extra round trip. It is also the convention the
 * rest of the site already follows (`/en/`, `/app/`).
 *
 * 🔴 A test asserting `status === 200` will **not** catch a missing slash:
 * Playwright follows redirects by default and reports the final response, so the
 * assertion passes on the redirected page. `tests/e2e/legal.spec.ts` pins
 * `maxRedirects: 0` for exactly this reason.
 */
export const TT_LEGAL_LINKS = {
  eula: '/legal/eula/',
  disclaimer: '/legal/disclaimer/',
  privacy: '/legal/privacy/',
  thirdParty: '/legal/third-party/',
  repo: 'https://github.com/poli0981/ticktune',
} as const;

/**
 * The language-correct href for a legal document.
 *
 * VI lives at the root and EN under `/en/` (`docs/08 §1`), so English is a
 * prefix rather than a different table.
 *
 * 🔴 **Every caller must use this, including the ones that are not Svelte.**
 * Reading `TT_LEGAL_LINKS[key]` directly yields the Vietnamese route, which is
 * correct for a Vietnamese reader *by accident* and silently wrong for an
 * English one — every value valid, every link resolving, all four pointing at
 * the wrong language. The three call sites do not even get their language the
 * same way: `TtLegalGate.svelte` and `TtSettings.svelte` read `i18n.lang` at
 * runtime, while `TtFooter.astro` is handed its page's language at build time.
 * `tests/e2e/legal.spec.ts` asserts the EN landing's footer, because that is the
 * one a unit test cannot see.
 */
export function ttLegalHref(key: TtLegalKey, lang: 'vi' | 'en'): string {
  return lang === 'en' ? `/en${TT_LEGAL_LINKS[key]}` : TT_LEGAL_LINKS[key];
}
