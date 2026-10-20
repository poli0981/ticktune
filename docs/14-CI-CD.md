# 14 — CI/CD

Suite 1.1 · 2026-10-20

Every workflow in this repo is **self-contained** and declares an **explicit
`permissions:` block**. The portfolio's reusable workflows were checked on
2026-07-21 and most of the ones this chapter once assumed (`reusable-web-ci.yml`,
`reusable-playwright.yml`, `reusable-audit.yml`, `reusable-cf-deploy.yml`,
`reusable-notify.yml`) do not exist; CI green on `main` must never depend on
another repository anyway. The explicit block is kept because callers of a
reusable workflow silently receive `permissions: none` under a known GitHub
inheritance bug, and the habit costs nothing.

## 1. Workflow inventory (`.github/workflows/`)

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PR + push main | corpus guard → install → lint → check → knip → doc refs → **build → tests** |
| `e2e.yml` | PR to main | Playwright chromium + firefox + webkit + 2 mobile projects, then **`verify-csp` under `wrangler dev`** |
| `audit.yml` | weekly cron + PR touching lockfile/manifests | `pnpm audit --prod --audit-level high`, then the whole tree at `critical` |
| `deploy.yml` | push tag `v*` **only** | verify (signature, ancestry, gates) → deploy → GitHub Release (`§5`) |

**Build before test, and the order is load-bearing.** `tests/unit/tt-csp-assets.test.ts`
and `tt-notices.test.ts` read `dist/`. Until v1.1 `ci.yml` ran the tests first,
so both suites skipped on every CI run while their headers claimed CI was the
gate; under `CI` a missing `dist/` is now a failure, not a skip.

**CSP in a real browser.** `astro preview` sends no headers, so the whole E2E
suite runs without a policy. The last step of `e2e.yml` serves `dist/` through
`wrangler dev` — the same Workers Static Assets layer that applies `_headers`,
locally, without Cloudflare credentials — and `scripts/verify-csp.mjs` asserts
zero CSP violations. It was a manual script until v1.1.

**CodeQL** runs as GitHub **default setup** (checks "Analyze
(javascript-typescript)" and "Analyze (actions)"). The advanced-setup
`codeql.yml` that earlier revisions of this chapter described was deleted after
1.0; keep default setup **enabled** — the old instruction to disable it applied
only while that file existed.

**SonarCloud** runs as Automatic Analysis; `.sonarcloud.properties` sets the
source/test split so test helpers are judged as test code. **Snyk** reports a PR
status check from its GitHub integration.

**Dependabot**: `.github/dependabot.yml`, npm + github-actions, weekly, grouped
minor/patch with a 3-day **cooldown** (pnpm 11's `minimumReleaseAge` otherwise
fails a release-day PR at install). Majors arrive individually so each gets its
written breaking-change and licence re-check (`11 §5`). `typescript` and
`@types/node` majors are ignored on evidence (`11 §4`; `engines` is Node 24).

**Corpus guard.** `ci.yml` runs `scripts/guard-no-corpus.mjs` as its **first**
step, before install, and `.githooks/pre-commit` runs it against the index.
`.gitignore` does nothing against `git add -f` and nothing in CI, so this is the
actual enforcement keeping the ~651 MB `test/` corpus out of history. Enable the
hook once per clone: `git config core.hooksPath .githooks`. It lists paths with
`-z`: without it git C-quotes non-ASCII names, and three corpus files with
CJK/Hangul titles passed every check until v1.1.

⚠️ If you deliberately test the guard: `git add -f` writes the blob into
`.git/objects` before any hook runs, and blocking the commit does not remove it.
The object stays unreachable — never pushed, never in history — but auto-gc will
pack it. Reclaim with
`git reflog expire --expire-unreachable=now --all && git gc --prune=now`.

## 2. Permissions and pinning

- **Explicit `permissions:` in every workflow**, `contents: read` by default. Only
  `deploy.yml`'s `release` job widens it (`§3`).
- **Actions pinned to full commit SHAs** with a `# vX.Y.Z` comment (SonarCloud
  `githubactions:S7637`). A tag can be moved; a SHA cannot. Dependabot updates
  both together, so the pin costs no maintenance.
- **`persist-credentials: false`** on every checkout. No workflow pushes, so the
  token has no reason to sit in `.git/config` while install scripts run.
- **No install-time downloads on runners.** `ffmpeg-static`'s postinstall fetched
  an unchecksummed binary in every workflow, including the one holding the
  Cloudflare token; `pnpm-workspace.yaml` now denies that build and the two local
  scripts that need ffmpeg install it on demand (`scripts/ensure-ffmpeg.ts`).

## 3. Permissions matrix and signing

| Workflow / job | permissions |
|----------------|-------------|
| ci · e2e · audit | `contents: read` |
| deploy → `verify`, `deploy` | `contents: read` (+ Cloudflare secrets in `deploy` only) |
| deploy → `release` | `contents: **write**` — for `gh release create`, and it runs no build tooling |

**Signing.** Commits and tags are GPG-signed locally, but GitHub's
**rebase-merge** writes new, unsigned commits onto `main`. The **tag** is therefore
the only signed artifact of a release, and `deploy.yml` verifies it against the
keys GitHub publishes for the owner (`https://github.com/poli0981.gpg`) before
anything else runs. `gh release create --verify-tag` only checks that a tag
exists; it was never a signature check. Locally, `git tag -v vX.Y.Z` must print
`Good signature` — git uses `gpg.program`, which on the dev box is the Windows
GnuPG, a different keyring from the `gpg` on Git Bash's `PATH`.

## 4. Secrets

| Secret | Scope |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | Custom token: Account → Workers Scripts: Edit; Zone → Workers Routes: Edit (only) |
| `CLOUDFLARE_ACCOUNT_ID` | Account id (not sensitive but kept as secret for uniformity) |

Used by `deploy.yml`'s `deploy` job only. The `production` environment holds them.

## 5. Release flow — tag-only

**Production changes only when a signed `vX.Y.Z` tag is pushed.**

Cloudflare **Workers Builds** (the Git integration on the `ticktune` Worker)
stays connected but is **upload-only**: Settings → Build sets both the deploy
command and the non-production command to `npx wrangler versions upload`.
Every push — each PR and `main` — therefore creates a Worker **version** with a
**Version URL** (`preview_urls: true` in `wrangler.jsonc`; `workers_dev` stays
false), and none of them takes traffic.

🔴 **Until v1.1 this section said "tag-only" while it was false.** Workers Builds
ran `wrangler deploy` on every pushed branch, so every PR — Dependabot's
included — went live at 100% the moment it was pushed, and a tagged release
deployed twice, racing `deploy.yml` (`16`, P6). On 2026-10-20 production was
serving an unmerged Dependabot branch. Verify the model, don't assume it:
after a push, `wrangler versions list` must show a new version and
`wrangler deployments list` must **not** show a new 100% deployment.

1. Merge PRs with **rebase-merge** once `ci`, `e2e`, `audit` (when triggered),
   SonarCloud and Snyk are green. Run the slice's live checklist on the PR's
   **Version URL** before merging (`13 §7`).
2. Bump `version` in `package.json` in the release PR; the app's About panel and
   the diagnostics payload read it at build time.
3. `git tag -s vX.Y.Z` with a hand-written annotated message, then push the tag.
4. `deploy.yml`:
   - **verify** — the tag's signature against the owner's published keys; the
     tagged commit is an ancestor of `origin/main`; lint, check, knip, build,
     test on that exact commit;
   - **deploy** — `pnpm build` (CSP-hash injection, notices, budget — `10 §7`)
     and `wrangler deploy`;
   - **release** — `gh release create --verify-tag --notes-from-tag`.
5. Post-deploy: the production re-check block of the live checklist (`13 §7`).

To redeploy a release, re-run that tag's `deploy.yml` run from the Actions tab.
There is deliberately no `workflow_dispatch`: it allowed deploying any branch by
hand, and the release step then failed — after production had already changed.

### The GitHub Release

`16`'s P7 row once asked for a "notify fan-out"; no `notify.yml` ever existed and
twelve tagged releases produced no release page. The deploy workflow publishes the
one artifact a release genuinely needs, carrying the **annotated tag's own
message** (`--notes-from-tag`) rather than a generated commit list: the message is
written by hand at release time and says why the release exists.

### History

- The CSP has been **enforcing since the first deploy**; the Report-Only rollout
  earlier revisions promised was deleted in P7 slice B as a no-op (`09 §4`).
- Dependabot proposed `typescript 7` on the first live run and `ci.yml` failed it
  on exactly the documented breakage — the `11 §4` decision is enforced by CI,
  and the `ignore` rule only removes the weekly noise.
