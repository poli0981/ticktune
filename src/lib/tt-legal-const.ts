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
 */
export const TT_LEGAL_VERSION = '1.0-draft';

/** Where the gate links. P6 replaces these with local `/legal/*` routes. */
export const TT_LEGAL_LINKS = {
  eula: 'https://github.com/poli0981/ticktune/blob/main/legal/EULA.md',
  disclaimer: 'https://github.com/poli0981/ticktune/blob/main/legal/DISCLAIMER.md',
  privacy: 'https://github.com/poli0981/ticktune/blob/main/legal/PRIVACY-POLICY.md',
  thirdParty: 'https://github.com/poli0981/ticktune/blob/main/legal/THIRD-PARTY-NOTICES.md',
  repo: 'https://github.com/poli0981/ticktune',
} as const;
