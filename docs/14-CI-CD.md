# 14 — CI/CD

Suite 2.0 · 2026-10-21

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
| `ci.yml` | PR + push main | corpus guard → install → lint → check → knip → doc refs → **build → tests**; then `sonar` (the SonarQube Cloud scan of the same commit, reading `ci`'s coverage report, not required); plus `ci-node26` (install → build → tests on Node 26, not required) |
| `e2e.yml` | PR to main | Playwright chromium + firefox + webkit + 2 mobile projects, then **`verify-csp` under `wrangler dev`** |
| `audit.yml` | weekly cron + PR touching lockfile/manifests | `pnpm audit --prod --audit-level high`, then the whole tree at `critical` |
| `deploy.yml` | push tag `v*` **only** | verify (signature, ancestry, gates) → deploy → GitHub Release (`§5`) |
| `quality.yml` | PR to main | `lighthouse` (Lighthouse CI on the static pages) and `visual` (screenshots in the pinned Playwright image) — v2.0, **not required** |

**Build before test, and the order is load-bearing.** `tests/unit/tt-csp-assets.test.ts`
and `tt-notices.test.ts` read `dist/`. Until v1.1 `ci.yml` ran the tests first,
so both suites skipped on every CI run while their headers claimed CI was the
gate; under `CI` a missing `dist/` is now a failure, not a skip.

**CSP in a real browser.** `astro preview` sends no headers, so the whole E2E
suite runs without a policy. The last step of `e2e.yml` serves `dist/` through
`wrangler dev` — the same Workers Static Assets layer that applies `_headers`,
locally, without Cloudflare credentials — and `scripts/verify-csp.mjs` asserts
zero CSP violations. It was a manual script until v1.1.

**Quality gates (v2.0).** `quality.yml` runs two jobs that report rather than
block: `lighthouse` asserts the category floors in `lighthouserc.json` and keeps
the reports as an artifact, and `visual` compares `tests/visual/` against the
baselines inside `mcr.microsoft.com/playwright:v1.64.1-noble`, the same image —
same digest — that `pnpm test:visual:docker` makes them in (`13 §3`, `13 §5`).
Neither is in the `main` ruleset yet: a required check that flakes teaches
everyone to re-run it, so each earns its place with a few weeks of stable runs
first.

**CodeQL** runs as GitHub **default setup** (checks "Analyze
(javascript-typescript)" and "Analyze (actions)"). The advanced-setup
`codeql.yml` that earlier revisions of this chapter described was deleted after
1.0; keep default setup **enabled** — the old instruction to disable it applied
only while that file existed.

**SonarQube Cloud** has been **CI-based** since 2026-10-23: the `sonar` job in
`ci.yml`, on the official `SonarSource/sonarqube-scan-action` (v8.3.0, running
SonarScanner CLI 8.2.0.6438 — pinned ahead of v8.3.0's own default until the
action's next release catches up; delete the `scannerVersion` input with that
Dependabot bump). Automatic Analysis is **off and must stay off** — SonarQube
Cloud refuses a CI analysis while it is on. Switching was what made the gate
whole: Automatic Analysis could import no coverage, so "Sonar way"'s
*coverage on new code ≥ 80%* condition was never evaluated, and with no
`node_modules` its TypeScript analysis guessed at every imported type.

- **One report, two readers.** `ci` runs `pnpm test` and keeps
  `coverage/lcov.info` as an artifact; `sonar` downloads it and runs no tests of
  its own. The report spans all of `src/` and `worker/`, because Sonar counts a
  file missing from it as 0% covered, not as unknown — and the carve-outs are
  one list kept in two files, `vitest.config.ts` and `sonar-project.properties`,
  which `tt-coverage-scope.test.ts` holds together (`13 §1`).
- **Scope** (`sonar-project.properties`): `src`, `worker`, `scripts`,
  `astro.config.mjs` and `.github`. The workflows are back in scope for the
  GitHub Actions rules — `githubactions:S7637` asked for the SHA pins below —
  which scoping Automatic Analysis had quietly dropped. `tests/` is test code,
  judged by test rules. The parallel static dictionaries (`src/i18n/static/`)
  stay out of copy/paste detection: same keys, translated values, so CPD read
  them as one long copy and failed a PR's duplication gate for three new keys.
  `sonar.typescript.tsconfigPaths` names both programs, so `worker/` is analysed
  with the Workers types rather than as an orphan file.
- **New code** is "previous version", and the job passes `package.json`'s
  version as `sonar.projectVersion`, so the period resets at each release. Every
  Automatic Analysis was version "not provided", which left the period running
  from the first analysis (2026-09-27) for good.
- **What is analysed:** pushes to `main` and pull requests from this
  repository. A fork's PR receives no secrets, and Dependabot's runs read
  Dependabot's own secret store, which holds no `SONAR_TOKEN`; both skip, and
  `main`'s analysis covers what they change. To analyse Dependabot's PRs as
  well, add the token to Dependabot's secrets and drop the actor clause from
  the job's `if`.
- **Not a required check.** `ci` is, and an outage on SonarSource's side must
  not block a merge; the quality gate reports on the PR as SonarQube Cloud's own
  check, which a merge waits for (`§5`). The job checks out with
  `fetch-depth: 0`: blame is what tells new code from old, and on a shallow
  clone every line would be new.

**Snyk** reports a PR status check from its GitHub integration.

**Dependabot**: `.github/dependabot.yml`, npm + github-actions, weekly, grouped
minor/patch with a 3-day **cooldown** (pnpm 11's `minimumReleaseAge` otherwise
fails a release-day PR at install). Majors arrive individually so each gets its
written breaking-change and licence re-check (`11 §5`). `typescript` and
`@types/node` majors are ignored on evidence (`11 §4`). `engines` is
`>=24 <27`: `.nvmrc` pins Node 24 for every job and for Workers Builds, and the
`ci-node26` job runs build and tests on Node 26 ahead of its LTS date
(2026-10-28), so the switch is a one-line pin once it lands.

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

- **Explicit `permissions:` in every workflow, granted per job.** The workflow
  level is `permissions: {}` and each job states `contents: read`; only
  `deploy.yml`'s `release` job widens it (`§3`). Moved down from the workflow
  level on 2026-10-23, with `.github/` back in SonarQube's scope: its
  `githubactions:S8264` flags a read grant at the workflow level, and all five
  workflows had one. A grant made there reaches every job, one added later
  included, and `{}` there means a job that forgets its block gets no token
  rights at all rather than the repository default.
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
| ci (`ci`, `sonar`, `ci-node26`) · e2e · audit · quality | `contents: read`, on each job; `{}` at the workflow level |
| deploy → `verify`, `deploy` | `contents: read` (+ Cloudflare secrets in `deploy` only) |
| deploy → `release` | `contents: **write**` — for `gh release create`, and it runs no build tooling |

**Signing.** Commits and tags are GPG-signed locally, but GitHub's
**rebase-merge** writes new, unsigned commits onto `main`. The **tag** is therefore
the only signed artifact of a release, and `deploy.yml` verifies it against the
keys GitHub publishes for the owner (`https://github.com/poli0981.gpg`) before
anything else runs. Those keys are fetched HTTPS-only, redirects included
(`curl --proto '=https'`): with `-L` alone a redirect could have downgraded the
download the whole gate trusts (`githubactions:S6506`, 2026-10-23). `gh release create --verify-tag` only checks that a tag
exists; it was never a signature check. Locally, `git tag -v vX.Y.Z` must print
`Good signature` — git uses `gpg.program`, which on the dev box is the Windows
GnuPG, a different keyring from the `gpg` on Git Bash's `PATH`.

## 4. Secrets

| Secret | Scope |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | Custom token: Account → Workers Scripts: Edit; Zone → Workers Routes: Edit (only) |
| `CLOUDFLARE_ACCOUNT_ID` | Account id (not sensitive but kept as secret for uniformity) |
| `SONAR_TOKEN` | SonarQube Cloud analysis token for `poli0981_ticktune` (since 2026-10-23) |

The Cloudflare pair is used by `deploy.yml`'s `deploy` job only, and the
`production` environment holds them. `SONAR_TOKEN` is a repository secret read
by one step — `ci.yml`'s scan — never by a step that installs or runs the
project's dependencies; Dependabot's store does not have it (`§1`).

**The Worker's own secrets are not GitHub secrets.** `YT_DATA_API_KEY` (v2.0,
`10`, `06 §3`) lives on the Worker, so every version — previews included —
can read it. 🔴 **Setting a Worker secret can deploy.** `wrangler secret put`
and the dashboard's Variables & Secrets both create a version **and deploy
it**, which changes production outside the tag-only model below. Use
`wrangler versions secret put`: it uploads a version that serves nothing until
the next tagged deploy carries the secret with it.

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
   the SonarQube Cloud quality gate and Snyk are green. Run the slice's live checklist on the PR's
   **Version URL** before merging (`13 §7`).
2. Bump `version` in `package.json` in the release PR; the app's About panel and
   the diagnostics payload read it at build time.
3. `git tag -s --cleanup=whitespace vX.Y.Z` with a hand-written annotated
   message, then push the tag. **`--cleanup=whitespace`, always:** git's default
   `strip` deletes every message line that starts with `#`, so the Markdown
   headings of the release notes vanished from the tag, and with it from the
   GitHub Release (v1.1.0).
4. `deploy.yml`:
   - **verify** — the tag's signature against the owner's published keys; the
     tagged commit is an ancestor of `origin/main`; lint, check, knip, build,
     test on that exact commit;
   - **deploy** — `pnpm build` (CSP-hash injection, notices, budget — `10 §7`)
     and `wrangler deploy`;
   - **release** — `gh release create --verify-tag --notes-from-tag`.
5. Post-deploy: the production re-check block of the live checklist (`13 §7`).

### Repository rules (v2.0)

- **`main` ruleset:** pull requests only; the checks **`ci`** and **`e2e`** are
  required — the two that run on every PR (`audit` and CodeQL do not run on
  Dependabot's, and a required check that never reports blocks a PR forever);
  linear history; no force-push; no deletion; the owner may bypass.
  `strict` is off, so a green PR need not be rebased onto every newer `main` —
  which means a PR that depends on another's keys or strings is rebased by hand
  before it merges. v2.0 did that for the Japanese dictionary twice.
- **Tag ruleset `v*`:** no deletion, no update — a release tag is immutable.
- **Environment `production`:** deployable from `v*` tags only.
- **Merging:** rebase-merge only; branches are deleted on merge.

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
