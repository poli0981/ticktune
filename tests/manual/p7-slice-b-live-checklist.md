# P7 slice B live checklist — hardening

Filtered to what slice B ships: the accessibility pass, the bundle budget, the
desktop WebKit sweep, and the four defects that sweep uncovered.

Run on a **desktop** browser against the **live deployment, before the merge**.

⚠️ **Most of this slice is machine-checked, and that is the point.** Four
build-time guards and two new spec files now assert what a human used to be
asked to eyeball. The lines below are the ones a machine genuinely cannot answer
— chiefly *"does this work with a real screen reader"* and *"does Safari behave
like the harness says it does"*.

## Blocking — the three defects that reached production

All three shipped and were live until this release. Each is a one-minute check.

- [ ] 🔴 **Safari: the legal gate can be accepted.** Open `/app/` in **real
      Safari** (or any WebKit browser), tick the box, press Accept. The gate must
      close. Until this release, a browser whose `AudioContext` construction
      threw left the user **trapped at the consent screen permanently, on every
      reload** — `session.gateAccepted()` never ran because a bare
      `void playback.unlock()` threw ahead of it.
      ⚠️ Real Safari has had `AudioContext` since 14.1, so this most likely never
      affected a real user. It was found because Playwright's WebKit has none.
      Verify anyway: the claim "no real browser hits this" is exactly the sort
      that goes unchecked.
- [ ] 🔴 **Safari: a YouTube link plays and the player is visible.** Same
      failure, worse consequence — `yt.load()` and `yt.play()` never ran, so the
      **player never mounted at all**, in the one mode whose player YouTube's
      terms require to be visible.
- [ ] 🔴 **Safari: drag a file onto the drop zone and it imports.** Drag from
      Finder/Explorer — not the file picker, which takes a different code path.
      **No automated test can cover this**: a synthetic `DataTransfer` cannot
      produce a filesystem-backed entry, and WebKit (unlike Chromium) takes the
      entry-walking path for dropped items, where `.file()` then fails with
      `NotFoundError` for want of a real path. Real Safari supplies real paths,
      so this should work — but "should" is the whole reason the line exists.
      Try a **folder** too, if you have one with audio in it.
- [ ] 🔴 **A short countdown announces zero.** With a screen reader on
      (NVDA/VoiceOver), run a **12-second** countdown. It must say the ten-second
      milestone **and** "Hết giờ" / "Time is up". Before this release the zero
      announcement raced `onDone` and lost on WebKit: the run ended in silence.
- [ ] **A returning user's End Behavior still fires** — chime, flash, and the
      configured `endAction`. The unlock guard touches that path.

## Blocking — accessibility, the half no scan can do

axe reports zero violations on seven surfaces under WCAG 2.1 AA **plus**
best-practice. What it cannot tell you is whether the app is *usable*.

- [ ] **Drive the whole app with the keyboard only.** Hands off the mouse: gate →
      import a file → set a duration → Start → open ⚙ → Escape → Stop. Anything
      that needs a mouse is a finding.
- [ ] **Focus is always visible.** At every step above you should be able to see
      where you are. A focus ring that disappears is a failure even when every
      element is reachable.
- [ ] **A screen reader announces the app's name on `/app/`.** New this release:
      Setup and the Player had **no `<h1>` at all** — the gate had one and the
      Finished screen had one, so every state you pass *through* was named while
      the two you live in were not.
- [ ] **The Vietnamese reads correctly to a screen reader**, particularly the
      milestone announcements. A synthesised voice mangling the diacritics is
      worth knowing about even though it is not our bug.

## Non-blocking

- [ ] Lighthouse ≥ 95 on `/` — the shell gained a hidden `h1`; nothing should
      move, but this is the release that touched the app shell.
- [ ] `/app/` still feels immediate on a cold load. The boot bundle is **107.5 KB
      gz** against a 250 KB budget, now asserted at build time, so a regression
      fails CI rather than reaching here — but the number is not the experience.
- [ ] Real Firefox: one full run. It cannot launch on the dev box, so CI is the
      only automated coverage.

## Known-absent — do not report

| Missing | Why |
|---------|-----|
| The real demo capture | **Slice C.** The hero is still the labelled placeholder |
| A GitHub Release | **Slice C.** None has ever existed |
| The Cloudflare branch-deploy fix | **Slice C**, deliberately last: it removes the surface these checklists run on, so it ships with the re-point or not at all |
| Audio assertions on Firefox in CI | Its `AudioContext` constructor exists and lies — `resume()` hangs with no output device — so it is skipped by name. Chromium alone asserts audible output |
| Audio assertions on WebKit | Skipped **only where the capability is genuinely absent**, feature-tested per build rather than assumed: Playwright's WebKit has no `AudioContext` on Windows and does have it on the Linux CI runner. `harness-assumptions.spec.ts` asserts the check is load-bearing, so the tier cannot silently skip everywhere |
| A CSP Report-Only period | It never happened and the release it promised was a no-op — the policy has been enforcing since day one (`09 §4`) |

## Production re-check — after the tag deploys to `ticktune.net`

🔴 Do not tick before `v0.12.0` exists. The version number cannot prove the tag
deployed — the bump ships inside the PR, so the branch deploy already serves it.

```bash
gh run list --workflow=deploy.yml --limit 3 --json headBranch,status,conclusion,createdAt
```

- [ ] `deploy.yml` has a **successful run whose `headBranch` is `v0.12.0`**.
- [ ] `ticktune.net/app/` → ⚙ → Giới thiệu reads **0.12.0**.
- [ ] Headers unchanged (`10 §11`), still exactly one inline script whose hash
      equals the `script-src` hash.
