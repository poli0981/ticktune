# P7 slice A live checklist — compliance and the 1.0 legal set

Filtered to what slice A ships: the generated attribution artifact, three privacy
corrections, the YouTube attribution duties, and the promotion of the whole legal
set from `1.1-draft` to **`1.0`**.

Run on a **desktop** browser against the **live deployment, before the merge**.

🔴 **This release re-prompts every existing user**, because `TT_LEGAL_VERSION`
changed. That is deliberate and it is the *second* time in two releases — which
is exactly why every legal change in P7 was batched into this one slice instead
of trickling out. There should be no third.

## Blocking — the attribution artifact

- [ ] **`/THIRD-PARTY-NOTICES.txt` loads** and is plain text, not a 404.
- [ ] It opens with the TickTune GPL-3.0 line and says **19 components follow**.
- [ ] **Spot-check three licence texts are really there**, not just names — pick
      `svelte`, `dexie` (Apache-2.0, so it should be long) and
      `@fontsource/be-vietnam-pro` (should contain `SIL OPEN FONT LICENSE`).
- [ ] **`/legal/third-party` links to it**, in both languages, under the curated
      table. The link text should read as an invitation, not as fine print.
- [ ] ⚠️ **The generated file does NOT list build tools.** `astro`, `wrangler`,
      `vitest`, `playwright` must be absent — they never reach a browser, and
      attributing them would mean the collector picked up the server build. If
      you see one, stop: that is a real bug, not a cosmetic one.

## Blocking — read the privacy corrections

Both languages. These are the third and fourth corrections to this document in
two releases, all of the same kind: it described something the code does not do.

- [ ] **`§0` (new)** — who runs TickTune, `contact@ticktune.net`, what is
      retained and for how long. Read it as a stranger: does it answer "who is
      this and what do they have on me" in the first ten seconds?
- [ ] 🔴 **`contact@ticktune.net` actually receives mail.** Send one test message.
      A privacy policy naming a dead contact address is worse than naming none.
- [ ] **`§2`** now says IndexedDB and explicitly denies `localStorage` /
      `sessionStorage`. It named `localStorage` until today, and the app has
      never called it.
- [ ] **`§4`** now names **both** Google origins — the API script from
      `www.youtube.com`, the player on `youtube-nocookie.com`. Check this reads
      as an honest disclosure rather than as a confession.
- [ ] **`§7`'s changelog** explains the `1.0` promotion and lists the three
      corrections, in both languages.

## Blocking — the 1.0 promotion

- [ ] **Every page reads `Version 1.0` / `Phiên bản 1.0`**, all eight, with a
      **space** between label and number. ⚠️ It rendered `Version1.0` from P6
      slice B until today — Astro collapses whitespace between adjacent
      expressions and `toContainText` could not see it. Look at the characters.
- [ ] **No document title says "(Draft)" or "(Bản nháp)"** any more.
- [ ] 🔴 **The gate re-appears for a returning user** and accepting sticks across
      a reload. Second time in two releases; if it fails, `1.0` is not shippable.

## Non-blocking

- [ ] Lighthouse ≥ 95 on `/legal/privacy` — the page grew a `§0` and `§4.1`.
- [ ] The generated notices file is ~48 KB; confirm it does not feel slow to open.

## Known-absent — do not report

| Missing | Why |
|---------|-----|
| A named country / jurisdiction | Deliberate, decided 2026-07-24. The project collects no personal data, so naming the operator's country would disclose something private without adding an obligation |
| A lawyer's review | Still developer-written. `1.0` means "no longer a draft", not "reviewed by counsel" |
| The real demo capture | **P7 slice C** |
| axe scan, perf number, desktop WebKit | **P7 slice B** |
| A GitHub Release | **P7 slice C** — none has ever existed |

## Production re-check — after the tag deploys to `ticktune.net`

🔴 Do not tick before `v0.11.0` exists. The version number alone cannot prove the
tag deployed — the bump ships inside the PR, so the branch deploy already serves
it.

```bash
gh run list --workflow=deploy.yml --limit 3 --json headBranch,status,conclusion,createdAt
```

- [ ] `deploy.yml` has a **successful run whose `headBranch` is `v0.11.0`**.
- [ ] `ticktune.net/THIRD-PARTY-NOTICES.txt` serves.
- [ ] `ticktune.net/app/` → ⚙ → Giới thiệu reads **0.11.0**.
- [ ] Headers unchanged (`10 §11`), still exactly one inline script whose hash
      equals the `script-src` hash.
