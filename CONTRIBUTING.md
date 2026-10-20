# Contributing to TickTune

Thanks for your interest! TickTune is GPL-3.0-only; by contributing you agree
your contributions are licensed the same way.

## Setup

```bash
# Requirements: Node 24 LTS, pnpm 11 (corepack enable)
git clone https://github.com/poli0981/ticktune
cd ticktune
pnpm install
pnpm dev            # http://localhost:4321
```

Optional: `pnpm wrangler dev` to exercise the `/api/yt/*` routes locally
(`/api/yt/durations` answers `not_configured` without the Data API key, which
lives only on the deployed Worker).
Enable the corpus guard once per clone: `git config core.hooksPath .githooks`.

## Before you code

- Read `CLAUDE.md` (condensed contract) and the relevant `docs/` chapter —
  especially the **hard invariants** (privacy, YouTube ToS, limits, mobile
  gate). PRs that violate an invariant are closed regardless of quality.
- For anything non-trivial, open an issue first to align on approach.

## Workflow

1. Branch from `main`: `feat/…`, `fix/…`, `docs/…`, `chore/…`, `spike/…`.
2. Conventional Commits (`feat: add ring visualizer sensitivity`).
3. Keep PRs focused; UI changes include a screenshot/clip.
4. A change to how a screen looks updates its visual baselines in the same PR:
   `pnpm test:visual:docker --update` (Docker), then review the new PNGs in the
   diff. They are only ever made inside the pinned Playwright image — a
   screenshot from any other machine compares against nothing (`docs/13 §3`).
5. Merging to `main` does **not** deploy. Production changes only with a signed
   release tag (`docs/14`), so a merged PR is safe to sit until the next
   release.

## PR checklist (CI enforces most of these)

- [ ] `pnpm lint` · `pnpm check` · `pnpm test` pass
- [ ] `pnpm knip` clean (no unused files/exports/deps)
- [ ] New user-facing strings exist in **all three** languages: the app's
      `src/app/i18n/{en,vi,ja}.json`, or the static pages'
      `src/i18n/static/{en,vi,ja}.ts` — and every app key has a literal
      `i18n.t('…')` caller, or the build fails (`docs/08 §3`). Legal texts stay
      EN + VI; Japanese links to the English ones (`docs/08 §5`)
- [ ] New log events use codes registered in `docs/12 §6`
- [ ] New dependency? Licence checked for GPL-3.0 compatibility. A
      **distributed** dependency also gets a row in
      `legal/THIRD-PARTY-NOTICES.md` (both languages); dev-only tooling does not
      (`docs/11 §5`)
- [ ] New network origin? CSP (`docs/09 §4`) + Privacy Policy updated in this PR
- [ ] A material change to any `legal/*.md`? Bump `TT_LEGAL_VERSION` in
      `src/lib/tt-legal-const.ts` in the same PR, so users are asked again —
      and batch legal changes, because every bump re-prompts everyone
- [ ] Behavior changes reflected in the relevant `docs/` chapter

## Reporting bugs

Use the bug template — it **requires** the browser console errors and (ideally)
the output of Settings → Diagnostics → **Copy Diagnostics**. Reports without
console output usually can't be diagnosed and will be sent back for info.

## Security

Never report a vulnerability in a public issue — see
[`.github/SECURITY.md`](.github/SECURITY.md) (security@poli0981.dev or private
vulnerability reporting).

## Community

Discussions happen on GitHub Issues. Be kind; EN and VI are both welcome.
