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
| `deploy.yml` | push tag `v*` (+ manual dispatch) | **self-contained** | build (incl. CSP-hash injection) + `wrangler deploy` + GitHub Release (P7 slice C) |
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

⚠️ If you deliberately test the guard: `git add -f` writes the blob into
`.git/objects` before any hook runs, and blocking the commit does not remove it.
The object stays unreachable — never pushed, never in history — but auto-gc will
pack it, which is how a 14 KB repo briefly grew a 31 MB local pack during this
guard's own verification. Reclaim with
`git reflog expire --expire-unreachable=now --all && git gc --prune=now`.

### First live run — 2026-07-21

Both notable results were the system behaving correctly:

- **CodeQL: `startup_failure`.** Expected. The advanced-setup workflow is
  rejected while repo Settings → Advanced Security → **CodeQL "Default setup"**
  is enabled; the reusable workflow's own header documents this. One-off repo
  setting, not a code fix.
- **Dependabot immediately proposed `typescript 5.9.3 → 7.0.2`, and `ci.yml`
  failed it** on exactly the documented breakage (`typescript-estree` blowing up
  against the TS 7 runtime). The `11 §4` decision is therefore enforced by CI,
  not just written down. A major-version `ignore` for `typescript` was added to
  `dependabot.yml` so the same PR does not reappear weekly — the ignore is the
  noise fix; the gate is the actual protection, and it stays.

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
| deploy | `contents: **write**` (+ CF secrets) — raised in P7 slice C for `gh release create`, and for nothing else |
| notify | `contents: read` · `actions: read` |

Rule of thumb: nothing gets `write` except `security-events` for CodeQL and
`contents` on deploy, which publishes the Release. Deploy authenticates to
Cloudflare via a secret token, not via GitHub permissions.

## 4. Secrets

| Secret | Scope |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | Custom token: Account → Workers Scripts: Edit; Zone → Workers Routes: Edit (only) |
| `CLOUDFLARE_ACCOUNT_ID` | Account id (not sensitive but kept as secret for stub uniformity) |

## 5. Release flow

1. `main` green (ci + e2e + codeql + audit).
2. Bump version in `package.json`; the app's About panel reads it at build time.
3. Tag `vX.Y.Z` → `deploy.yml` builds, runs `scripts/inject-csp-hash.ts`
   (`10 §7`) and deploys.

   ✅ **The GitHub Release exists from P7 slice C** — see the section at the end
   of this chapter. The fan-out does **not**, deliberately.

   ⚠️ It was missing for **twelve tagged releases**, and the reason is worth
   keeping: this step read "then GitHub Release with generated notes →
   `notify.yml` fans out" from suite 1.0, while `deploy.yml` had only a Build and
   a Deploy step and no `notify.yml` ever existed. `gh release list` was empty
   after v0.2.0, v0.3.0 — and still at v0.12.0. **Nobody noticed because a deploy
   that works looks identical either way**: the site updates, the workflow is
   green, and the missing artifact is one nobody goes looking for. That is the
   same shape as every other claim this suite has had to measure.

   **Tags are signed** (`git tag -s`), and the signature is worth verifying
   rather than assuming: `tag.gpgsign = true` was already set when **v0.2.0 was
   created unsigned**, so the config proves nothing. `git tag -v vX.Y.Z` must
   print `Good signature`. Note git uses `gpg.program`, which on the dev box is
   the Windows GnuPG — a different keyring from the `gpg` on Git Bash's `PATH`,
   which reports "No secret key" and means nothing.
4. Post-deploy: run the live-site smoke checklist (`13 §7`).
5. ~~First production deploy ships CSP as Report-Only; the switch to enforcing
   CSP is its own tagged release during P7.~~ **Deleted in P7 slice B: it never
   happened and the release it promised was a no-op.** The CSP has been
   **enforcing since the first deploy** — `public/_headers` has always said
   `Content-Security-Policy:`, and the live site answers with that header name.
   `09 §4` carries the reasoning and why the enforcing-first choice was the right
   one anyway.

### The GitHub Release — added P7 slice C

`16`'s P7 row asked for a "notify fan-out" and **nothing was ever behind it**: no
`notify.yml` has existed at any point, and `gh release list` was empty as late as
v0.12.0. Twelve tagged releases had produced no release page.

Rather than build a broadcast pipeline for an audience that does not exist, the
deploy workflow now publishes the one artifact a release genuinely needs:

```yaml
gh release create "$GITHUB_REF_NAME" --verify-tag --notes-from-tag
```

Two flags carry the reasoning.

**`--verify-tag`** is the point of the step. GitHub's rebase-merge produces
**unsigned** commits on `main` (`§3`), so the *tag* is the only signed artifact a
release has — publishing a release for a tag that is missing or has drifted would
launder that guarantee away silently.

**`--notes-from-tag`** rather than auto-generated notes. The annotated tag message
is written by hand at release time and says why the release exists; a generated
commit list says what changed and not what it means. The project already invests
in those messages, so the release should carry them rather than replace them.

⚠️ `permissions:` moves to `contents: write` for this step and this step only.
The block stays **explicit** — never inherited — for the reason in `§2`.
