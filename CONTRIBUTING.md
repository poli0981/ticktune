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

Optional: `pnpm wrangler dev` to exercise the `/api/yt/oembed` route locally.

## Before you code

- Read `CLAUDE.md` (condensed contract) and the relevant `docs/` chapter —
  especially the **hard invariants** (privacy, YouTube ToS, limits, mobile
  gate). PRs that violate an invariant are closed regardless of quality.
- For anything non-trivial, open an issue first to align on approach.

## Workflow

1. Branch from `main`: `feat/…`, `fix/…`, `docs/…`, `chore/…`, `spike/…`.
2. Conventional Commits (`feat: add ring visualizer sensitivity`).
3. Keep PRs focused; UI changes include a screenshot/clip.

## PR checklist (CI enforces most of these)

- [ ] `pnpm lint` · `pnpm check` · `pnpm test` pass
- [ ] `pnpm knip` clean (no unused files/exports/deps)
- [ ] New user-facing strings exist in **both** `en.json` and `vi.json`
- [ ] New log events use codes registered in `docs/12 §6`
- [ ] New dependency? License checked for GPL-3.0 compatibility + row added to
      `legal/THIRD-PARTY-NOTICES.md` (`docs/11 §5`)
- [ ] New network origin? CSP (`docs/09 §4`) + Privacy Policy updated in this PR
- [ ] Behavior changes reflected in the relevant `docs/` chapter

## Reporting bugs

Use the bug template — it **requires** the browser console errors and (ideally)
the output of Settings → Diagnostics → **Copy Diagnostics**. Reports without
console output usually can't be diagnosed and will be sent back for info.

## Community

Discussions happen on GitHub Issues and the project Discord (link in README).
Be kind; EN and VI are both welcome.
