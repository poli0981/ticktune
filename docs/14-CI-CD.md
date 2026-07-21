# 14 — CI/CD

Suite 1.0 · 2026-07-21

TickTune follows the portfolio convention: thin **caller stubs** in this repo
invoke **reusable workflows** in `poli0981/.github`. Because of the known
permissions-inheritance bug (callers silently get `permissions: none`), **every
caller stub declares an explicit `permissions:` block** — this is mandatory,
matching the May 2026 portfolio-wide fix.

> ⚠️ Reusable-workflow filenames below (`reusable-web-ci.yml`, etc.) follow the
> catalog's naming style but must be **confirmed against `poli0981/.github`**
> before committing — the July 2026 suite (13 reusable workflows) is the source
> of truth. Adjust `uses:` paths accordingly.

## 1. Workflow inventory (caller stubs in `.github/workflows/`)

| Stub | Trigger | Reusable target | Purpose |
|------|---------|-----------------|---------|
| `ci.yml` | PR + push main | `reusable-web-ci.yml` | install → lint → check → knip → unit/component tests → build |
| `e2e.yml` | PR to main | `reusable-playwright.yml` (or job in web-ci) | Playwright chromium+firefox |
| `codeql.yml` | push main + weekly cron | `reusable-codeql.yml` | `javascript-typescript` |
| `audit.yml` | weekly cron + PR touching lockfile | `reusable-audit.yml` | `pnpm audit --prod`, fail ≥ high |
| `deploy.yml` | push tag `v*` (+ manual dispatch) | `reusable-cf-deploy.yml` | build + `wrangler deploy` |
| `notify.yml` | release published | `reusable-notify.yml` | community fan-out |

Dependabot: `.github/dependabot.yml`, npm weekly, grouped minor/patch.

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
