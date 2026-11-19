# Contributing to TickTune

Thanks for your interest! TickTune is GPL-3.0-only; by contributing you agree
your contributions are licensed the same way.

## Maintenance mode — what is taken

Since v2.3.0 TickTune is **maintained, not extended**
([MAINTENANCE.md](MAINTENANCE.md)). Pull requests and issues are welcome for:

- bugs and UI/UX defects;
- accessibility barriers ([ACCESSIBILITY.md](ACCESSIBILITY.md));
- language fixes — Vietnamese, English or Japanese wording that is wrong, awkward
  or misleading (the **Wording is wrong or awkward** form);
- dependency, security and platform updates;
- a change that is genuinely necessary, or one already in `docs/16`'s backlog.

**New features are not taken.** A pull request from outside the project titled
`feat…` is closed automatically, and so is a feature request that answers
"Something new"; both are labelled `maintenance-mode`, and nothing is deleted.
If you think a change is necessary, open an issue first and say why. Ideas are
welcome in [Discussions › Ideas](https://github.com/poli0981/ticktune/discussions/categories/ideas).

## Setup

```bash
# Requirements: Node 26 LTS, pnpm 11 (npm install -g pnpm@11 — Node 26 ships no corepack)
git clone https://github.com/poli0981/ticktune
cd ticktune
pnpm install
pnpm dev            # http://localhost:4321
```

Optional: `pnpm wrangler dev` to exercise the `/api/yt/*` routes locally
(`/api/yt/durations` and `/api/yt/playlists` answer `not_configured` without
the Data API key, which lives only on the deployed Worker).
Enable the corpus guard once per clone: `git config core.hooksPath .githooks`.

## Before you code

- Read `CLAUDE.md` (condensed contract) and the relevant `docs/` chapter —
  especially the **hard invariants** (privacy, YouTube ToS, limits, mobile
  gate). PRs that violate an invariant are closed regardless of quality.
- For anything non-trivial, open an issue first to align on approach — in
  maintenance mode, that is what tells a fix from a feature.

## AI-assisted contributions

Welcome, on the terms this project holds itself to (the Disclaimer's §7):

- **Disclose it.** A commit made with an AI assistant ends with a
  `Co-Authored-By:` trailer naming the model, as every commit here does.
- **You are the author.** Review every line you submit; the invariants, the PR
  checklist and the tests apply exactly as they do to hand-written code.
- **Keep secrets and people out of it.** Never paste keys, tokens, a user's
  Copy Diagnostics output or anything from a private report into an AI tool.
- **Licence.** Contributions are GPL-3.0-only, AI-assisted ones included. Do not
  submit output you have reason to think reproduces someone else's code.

## Workflow

1. Branch from `main`: `feat/…`, `fix/…`, `docs/…`, `chore/…`, `spike/…`.
2. Conventional Commits (`fix: keep the hint chip's text after a resize`).
   A `feat:` title from outside the project is read as a feature request and
   closed (MAINTENANCE.md); use `fix:` for a fix.
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
- [ ] The SonarQube Cloud quality gate passes on the PR — no new issues, and
      new code at least 80% covered by the unit tier. A file kept out of
      coverage is kept out in both `vitest.config.ts` and
      `sonar-project.properties`, with where it is tested instead (`docs/13 §1`)
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
- [ ] UI changes meet [ACCESSIBILITY.md](ACCESSIBILITY.md)'s contributor
      expectations: keyboard only, a screen-reader spot check, forced colours
      and reduced motion checked, and a new screen scanned in
      `tests/e2e/a11y.spec.ts` (`docs/13 §6`)

## Reporting bugs

Use the bug template — it **requires** the browser console errors and (ideally)
the output of Settings → Diagnostics → **Copy Diagnostics**. Reports without
console output usually can't be diagnosed and will be sent back for info.

## Accessibility

A barrier — something hard or impossible to use with a keyboard, a screen
reader, zoom, contrast or motion settings — has its own issue form,
**Accessibility barrier**, or can be emailed to accessibility@poli0981.dev. What
is built in, what is known not to work and how reports are handled is in
[ACCESSIBILITY.md](ACCESSIBILITY.md).

## Security

Never report a vulnerability in a public issue — see
[`.github/SECURITY.md`](.github/SECURITY.md) (security@poli0981.dev or private
vulnerability reporting).

## Community

Ideas and questions go to [Discussions](https://github.com/poli0981/ticktune/discussions)
(Ideas, Q&A); issues are for the reports above. Be kind; EN and VI are both
welcome.
