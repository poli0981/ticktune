# P7 slice C live checklist — the 1.0 release

The last one before **v1.0.0**, so it is deliberately the longest: it runs the
full `docs/13 §7` smoke list rather than a filtered slice, because this is the
release that stops being a draft.

Run on a **desktop** browser against the **live deployment, before the merge**.

## Blocking — the hero, which is new

- [ ] **The hero plays, loops, and is silent.** It should start on its own with
      no sound. If it needs a click, `autoplay`/`muted` has been lost.
- [ ] **It looks like the product.** A countdown at `MM:SS`, the visualizer bars
      moving across the width, the track rail on the right. Watch a full loop —
      the seam should not be jarring.
- [ ] **It is the real app, not a mock-up.** Compare against `/app/`: the digits,
      the fonts and the layout should be recognisably the same thing.
- [ ] **Nothing jumps as it loads.** The poster paints first and the video takes
      the same box, so the page should not reflow. Any shift is a CLS finding.
- [ ] 🔴 **Reduced motion shows a still instead.** Turn on the OS setting
      (Windows: Settings → Accessibility → Visual effects → Animation effects
      off) and reload `/`. The looping video must be replaced by a static image.
      ⚠️ Test the **real OS setting**, not the browser devtools emulation — the
      E2E already covers the emulated case, so re-testing that proves nothing new.
- [ ] **Safari plays it.** The clip shipped briefly in a format WebKit stalled
      on; it is H.264 now for exactly that reason.

## Blocking — the full `13 §7` smoke list

- [ ] Landing VI + `/en/` render.
- [ ] Gate appears on a fresh profile; Accept persists across a reload.
- [ ] Single mode with a real MP3: plays, and the countdown tracks a phone
      stopwatch over 10 minutes (±1 s) — **tab visible**, the only case that
      bound applies to (`04 §2`).
- [ ] Playlist: 3 files, shuffle + repeat, right-click info modal fields.
- [ ] YouTube: 2 links play sequentially in a visible player; one dead link
      shows the gone-overlay.
- [ ] `< 60 s` millisecond display is smooth.
- [ ] Finished + chime fire after a **hidden** run — and if it was late by more
      than 2 s, the screen states the actual finish time rather than implying
      "now". **Late is expected here, not a defect** (`04 §2` option 3).
- [ ] Headers/CSP live (`10 §11`); `/api` returns 429 after a burst.
- [ ] Real Android phone **and** a touch-only iPad: the gate shows and no app
      bundle is downloaded.
- [ ] Copy Diagnostics → the paste parses as JSON.

## Blocking — read it as a stranger

This is the last chance to catch something embarrassing before 1.0.

- [ ] **The landing reads as a finished product**, not a work in progress. No
      "coming soon", no placeholder language, nothing that promises a feature
      that is not there.
- [ ] **The legal set says `Phiên bản 1.0`** on all eight pages and no longer
      calls itself a draft anywhere.
- [ ] **`/THIRD-PARTY-NOTICES.txt` loads** and lists 19 components.

## Non-blocking

- [ ] 🔴 **Lighthouse ≥ 95 on `/` and `/en/`** — desktop, all four categories.
      ⚠️ **This is the number most at risk in this release.** `/` scored 100 on
      Performance with a static SVG hero; it now carries a 119 KB autoplaying
      video as the LCP element. Report all four numbers even if they pass. If
      Performance drops below 95, the fix is a shorter or more compressed clip,
      **not** a lower bar.
- [ ] Real Firefox: one pass of `/` and `/app/`.

## Known-absent — do not report

| Missing | Why |
|---------|-----|
| The Cloudflare branch-deploy fix | Deliberately **not** in this release. It removes the surface these checklists run on, so it ships only once a preview URL is confirmed to work — doing it in the same release as 1.0 would destabilise the deploy path at the worst moment |
| A notify/announce fan-out | Not built. `deploy.yml` publishes a GitHub Release from the signed tag; a broadcast pipeline for an audience that does not exist yet is not a v1.0 requirement (`14 §5`) |
| CodeQL green | Zone-side: repo Settings → Advanced Security → **CodeQL Default setup** must be disabled or `codeql.yml` stays `startup_failure`. Cannot be fixed from this repository |
| Crossfade | Deferred as a feature; `singleLoopStyle: 'hard'` ships and a stored `'crossfade'` falls back with TT-SYS-205 |

## Production re-check — after the tag deploys to `ticktune.net`

🔴 Do not tick before `v1.0.0` exists. The version number cannot prove the tag
deployed — the bump ships inside the PR, so the branch deploy already serves it.

```bash
gh run list --workflow=deploy.yml --limit 3 --json headBranch,status,conclusion,createdAt
gh release list --limit 3
```

- [ ] `deploy.yml` has a **successful run whose `headBranch` is `v1.0.0`**.
- [ ] 🆕 **A GitHub Release exists for `v1.0.0`**, carrying the tag's own
      message. This is the first one this project has ever published — the step
      is new, so it is the most likely thing in this release to fail.
- [ ] `ticktune.net/app/` → ⚙ → Giới thiệu reads **1.0.0**.
- [ ] `ticktune.net/demo/hero.mp4` serves.
- [ ] Headers unchanged (`10 §11`), still exactly one inline script whose hash
      equals the `script-src` hash.
