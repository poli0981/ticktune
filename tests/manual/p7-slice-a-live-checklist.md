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

**Run 2026-07-24 against the live deployment. All measured from the shell, so
each tick names its evidence rather than resting on someone's eye.**

- [x] **`/THIRD-PARTY-NOTICES.txt` loads** and is plain text, not a 404 —
      `200`, `text/plain`, 48 483 bytes.
- [x] It opens with the TickTune GPL-3.0 line and says **19 components follow**.
- [x] **Spot-check three licence texts are really there**, not just names —
      `SIL OPEN FONT LICENSE` ×2 (both font families) and `Apache License` ×4.
- [x] **`/legal/third-party` links to it**, in both languages, under the curated
      table.
- [x] ⚠️ **The generated file does NOT list build tools.** `astro`, `wrangler`,
      `vitest`, `playwright`: **0 matches**. This is the check that catches the
      collector picking up the server build, which it did on the first attempt.

## Blocking — read the privacy corrections

Both languages. These are the third and fourth corrections to this document in
two releases, all of the same kind: it described something the code does not do.

- [x] **`§0` (new)** — who runs TickTune, `contact@ticktune.net`, what is
      retained and for how long. Read by the owner in both languages.
- [x] 🔴 **`contact@ticktune.net` actually receives mail.** Cloudflare Email
      Routing configured and a test message sent and received, 2026-07-24. The
      policy names this as *the* private contact point, so a dead address would
      have been a worse defect than the one `§0` was added to fix.
- [x] **`§2`** now says IndexedDB and explicitly denies `localStorage` /
      `sessionStorage`.
- [x] **`§4`** now names **both** Google origins — the API script from
      `www.youtube.com`, the player on `youtube-nocookie.com`.
- [x] **`§7`'s changelog** explains the `1.0` promotion and lists the three
      corrections, in both languages.

## Blocking — the 1.0 promotion

- [x] **Every page reads `Version 1.0` / `Phiên bản 1.0`**, all eight, with a
      **space** between label and number. Measured on the live pages:
      `Phiên bản 1.0` and `Version 1.0`. ⚠️ It rendered `Version1.0` from P6
      slice B until today — Astro collapses whitespace between adjacent
      expressions and `toContainText` could not see it.
- [x] **No document title says "(Draft)" or "(Bản nháp)"** any more. Swept all
      eight live routes: **0** title markers. The one remaining occurrence of the
      word, on both EULAs, is the deliberate sentence *"Version 1.0 means it is
      no longer a draft — it does not mean it has been reviewed by counsel."*
      ⚠️ That sentence exists because the promotion **missed the body prose**:
      the title lost "(Draft)" while paragraph two still read "This draft is
      written by the developer". Found by grepping the deployed pages, not the
      source. A mechanical rename cannot see prose.
- [x] 🔴 **The gate re-appears for a returning user** and accepting sticks across
      a reload. ⚠️ **Ticked on the E2E, not by hand** — `legal-gate.spec.ts`'s
      "a `TT_LEGAL_VERSION` bump re-shows it" rewrites a stored acceptance to an
      older version and asserts the gate returns, which is exactly a returning
      user's row. 5/5 pass. Said plainly so nobody later reads this tick as a
      human having watched it happen.

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
