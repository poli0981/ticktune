# 14 — CI/CD

Suite 1.0 · 2026-07-21

TickTune follows the portfolio convention: thin **caller stubs** in this repo
invoke **reusable workflows** in `poli0981/.github`. Because of the known
permissions-inheritance bug (callers silently get `permissions: none`), **every
caller stub declares an explicit `permissions:` block** — this is mandatory,
matching the May 2026 portfolio-wide fix.

> ✅ **Catalog checked 2026-07-21.** Most filenames this chapter assumed do not
> exist. `poli0981/.github` has `reusable-codeql.yml` and
> `reusable-web-react.yml`, but **no** `reusable-web-ci.yml`,
> `reusable-playwright.yml`, `reusable-audit.yml`, `reusable-cf-deploy.yml` or
> `reusable-notify.yml`. The inventory below is what actually ships.

## 1. Workflow inventory (`.github/workflows/`)

| Stub | Trigger | Implementation | Purpose |
|------|---------|----------------|---------|
| `ci.yml` | PR + push main | **self-contained** | corpus guard → install → lint → check → knip → tests → build |
| `e2e.yml` | PR to main | **self-contained** | Playwright chromium + firefox + webkit, report artifact |
| `codeql.yml` | push main + weekly cron | caller → `reusable-codeql.yml` | `javascript-typescript` |
| `audit.yml` | weekly cron + PR touching lockfile/package.json | **self-contained** | `pnpm audit --prod --audit-level high` |
| `deploy.yml` | push tag `v*` (+ manual dispatch) | **self-contained** | build (incl. CSP-hash injection) + `wrangler deploy` |
| `notify.yml` | — | **deferred** | see below |

Why self-contained rather than callers:

- `reusable-web-react.yml` does support pnpm + Node 24 + custom build/test
  commands, but it has **no knip step** — and knip is build-failing here
  (`12 §5`) — and its deploy path targets GitHub Pages, not Cloudflare Workers.
  Using it would mean bending a workflow shared with other repos to suit this one.
- CI green on `main` must never depend on another repository. A caller stub whose
  target does not resolve is a red X nobody can fix from this repo.

`codeql.yml` **is** a caller, because that workflow genuinely exists and fits.
Two things `§2`'s original example got wrong: its input is a **JSON array
string** (`'["javascript-typescript"]'`) because it runs `fromJSON()` on the
value, and it requires repo Settings → Advanced Security → CodeQL **Default
setup to be DISABLED**, or the advanced-setup SARIF upload is rejected.

`notify.yml` is deferred: the catalog offers `announce-release.yml`,
`notify-release-pipeline.yml` and `notify-deploy.yml`, and choosing needs their
input contracts read. Release fan-out is a P7 concern (`16 §P7`); nothing before
then depends on it.

Dependabot: `.github/dependabot.yml`, npm + github-actions, weekly, grouped
minor/patch — majors arrive individually so each gets its written
breaking-change and license re-check (`11 §5`).

**Corpus guard.** `ci.yml` runs `scripts/guard-no-corpus.mjs` as its **first**
step, before install, and `.githooks/pre-commit` runs it against the index.
`.gitignore` does nothing against `git add -f` and nothing in CI, so this is the
actual enforcement keeping the ~651 MB `test/` corpus out of history. Enable the
hook once per clone: `git config core.hooksPath .githooks`.

## 2. Caller stub examples (explicit permissions!)

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:            # explicit — do NOT rely on inheritance
  contents: read
jobs:
  ci:
    uses: poli0981/.github/.github/workflows/reusable-web-ci.yml@main
    with:
      node-version: "24"
      package-manager: pnpm
      run-knip: true
```

```yaml
# .github/workflows/codeql.yml
name: CodeQL
on:
  push: { branches: [main] }
  schedule: [{ cron: "0 3 * * 1" }]
permissions:            # CodeQL caller matrix (portfolio standard)
  actions: read
  contents: read
  security-events: write
jobs:
  codeql:
    uses: poli0981/.github/.github/workflows/reusable-codeql.yml@main
    with:
      languages: javascript-typescript
```

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push: { tags: ["v*"] }
  workflow_dispatch:
permissions:
  contents: read
jobs:
  deploy:
    uses: poli0981/.github/.github/workflows/reusable-cf-deploy.yml@main
    with:
      build-command: pnpm build
      deploy-command: pnpm wrangler deploy
    secrets:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

```yaml
# .github/workflows/notify.yml
name: Notify
on:
  release: { types: [published] }
permissions:            # notify caller matrix (portfolio standard)
  contents: read
  actions: read
jobs:
  notify:
    uses: poli0981/.github/.github/workflows/reusable-notify.yml@main
    secrets: inherit
```

## 3. Permissions matrix (recorded here for review)

| Caller | permissions |
|--------|-------------|
| ci / e2e / audit | `contents: read` |
| codeql | `actions: read` · `contents: read` · `security-events: write` |
| deploy | `contents: read` (+ CF secrets) |
| notify | `contents: read` · `actions: read` |

Rule of thumb: nothing gets `write` except `security-events` for CodeQL. Deploy
authenticates to Cloudflare via secret token, not GitHub permissions.

## 4. Secrets

| Secret | Scope |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | Custom token: Account → Workers Scripts: Edit; Zone → Workers Routes: Edit (only) |
| `CLOUDFLARE_ACCOUNT_ID` | Account id (not sensitive but kept as secret for stub uniformity) |

## 5. Release flow

1. `main` green (ci + e2e + codeql + audit).
2. Bump version in `package.json`; the app's About panel reads it at build time.
3. Tag `vX.Y.Z` → `deploy.yml` builds, runs `scripts/inject-csp-hash.ts`
   (`10 §7`), deploys, then GitHub Release with generated notes → `notify.yml`
   fans out.
4. Post-deploy: run the live-site smoke checklist (`13 §7`).
5. First production deploy ships CSP as Report-Only; the switch to enforcing CSP
   is its own tagged release during P7 (`09 §4`).
