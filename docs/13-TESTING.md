# 13 — Testing Strategy

Suite 1.1 · 2026-10-20

Pyramid: heavy unit coverage on the pure engines (they're pure by design, `01 §3`),
targeted component tests, thin-but-real E2E, plus a manual matrix for the parts
that depend on YouTube's servers.

## 1. Unit (Vitest 4, `tests/unit/`)

| Area | Cases |
|------|-------|
| Timer (`04 §7`) | derived remaining under simulated throttle gaps; pause/resume exactness; single-fire `done`; drift re-anchor (TT-SYS-201); sleep-across-zero (TT-SYS-203); format table incl. 3 600 000 / 60 000 / 59 999 / 0 |
| Importer | every rejection path TT-IMP-001…005 with exact boundary values (602 000 ms; 5 460 000 ms totals; 95th vs 96th file; 50th vs 51st link); dedupe keys; summary counts |
| YT URL parser | watch/youtu.be/shorts/live/embed/music.youtube + junk lines; 11-char id property test |
| Metadata mapping | tag→TtTrack mapping; `N/A`/`–` fallback rules; the `onlyV1` non-ASCII rule and the retained U+FFFD check (TT-IMP-007); pure-ASCII ID3v1 **kept** (`05 §5`) |
| Log | ring-buffer wrap at 500; level filter; diagnostics payload shape |
| Crossfade math | equal-power curve endpoints/midpoint (`out² + in² = 1`). Trigger scheduling is **not** tested — it is what spike S4b has to measure first (`15 §S4`) |
| Drop pre-scan | depth-first flattening; deterministic `Intl.Collator` order; the entry cap → TT-IMP-008 (`02 §4` step 0) |
| Object-URL ledger | `acquire` idempotent per key; double release is a no-op; the ≤2-media + ≤queueLength-cover bound under a random add/remove property test (`05 §3`) |
| Playback order (`02 §5.1`) | Fisher–Yates over an injected `rand` — a permutation, nothing lost or duplicated, one draw per element; the no-immediate-repeat swap at lengths 1 and 2 (the real boundary); `reconcile` under random add/remove; `nextInOrder` at the last element and for a cursor whose track is gone |
| Session store | The tier the engines **cannot** fail: that `allowDuplicates` reaches the importer from settings rather than as a literal; that a playlist import appends while a Single import replaces and releases; that removing the current track advances before the queue is mutated; that a mode switch keeps the queue; that `moveTrack` leaves a stored shuffle permutation alone (`02 §5.1` rule 1); and **both sides** of the import-progress threshold — a fast batch must render nothing |
| Audio graph | `createMediaElementSource` called exactly twice across many loads and deck swaps; a rejected `play()` logs one TT-PLY-100 and never reports "playing"; hard-loop wrap detection vs a user seek |
| End behavior | plan immutability once `done` has fired; `endFadeMs: 0` emits a single `setValueAtTime` and **never** a zero-duration curve (which throws `RangeError`); a volume write mid-fade leaves the fade automation untouched; all three `endAction` values |
| Late finish | `overshootMs` at 1 999 / 2 000 / 2 001 (strict `>`); a latch-fired `done` with a 300 ms overshoot renders the **normal** screen; the `now − overshootMs` reconstruction (`04 §2`) |
| i18n guard | `en.json` vs `vi.json` key-set diff = ∅ (build-failing) — from P5, when the dictionaries exist (`08 §3.1`) |

**A store test is only worth writing if it fails under the bug it names.** The
two above were checked by mutation, not by inspection: restoring
`allowDuplicates: false` at the call site fails exactly one, and moving the queue
filter ahead of the advance in `removeTrack` fails exactly one other. Applying
that check costs a minute and is the only thing separating this tier from
decoration — which matters here more than usual, because both bugs that reached
the live site were invisible to every tier that existed.

Coverage target: **≥ 85% lines on `src/app/engine/**`** — enforced in
`vitest.config.ts` and wired into `pnpm test`, so it fails the run rather than
printing a report nobody reads. No global vanity target elsewhere.

**Scope carve-out.** Two file patterns inside `engine/**` are excluded:
`*.worker.ts` and `*-driver.ts`. They are the impure boundary the pure core
exists to keep small — they own `Worker`, `requestAnimationFrame`,
`visibilitychange` and Wake Lock, cannot execute in Node, and "unit testing"
them would mean mocking every browser API and then asserting the mocks. They are
covered where they actually run: Playwright (`§3`) and spike S2, which drives
the real driver for 30–90 minutes across hidden, minimised and suspended states
(`15 §S2`). The threshold therefore applies to the pure core, which is what
`01 §3`'s "engines are pure by design" reasoning meant.

Measured 2026-07-21 on the timer engine: **98.9% lines, 95.5% statements**
(`tt-format.ts` 100%, `tt-timer.ts` 98.4%).

**Build-dependent suites.** `tt-csp-assets.test.ts` (no font inlined as `data:`,
no off-policy origin in built CSS) and `tt-notices.test.ts` (the generated
attribution, including Dexie's Apache `NOTICE`) read `dist/`. They skip locally
when there is no build, and **fail under `CI`** if `dist/` is missing — which is
why `ci.yml` builds before it tests (`14 §1`). Until v1.1 the order was reversed
and both suites skipped on every CI run while claiming CI was their gate.

## 2. Component (Vitest + @testing-library/svelte + happy-dom, `tests/component/`)

Five components have their own suites — TtFinished, TtQueuePanel, TtSettings,
TtBackdrop and TtYouTubeRail. Setup, the bottom bar, the track-info modal, the
toast and the legal gate are covered end to end instead (`§3`), where their
wiring is what fails; the suite 1.0 plan listed component tests for them that
were never written, and this list no longer pretends otherwise.

TtFinished (**both variants** — normal below the threshold, and the late variant
rendering a clock time and elapsed phrase with no bare present-tense claim;
digits hold `0.000` in both) · **TtQueuePanel** (now-playing highlight on exactly one
row and none before Start, an errored row struck through rather than hidden, the
totals footer rendering `–` when any duration is unknown, the context menu
resolving to the row that was targeted, all four `02 §8` items with the
end-of-list move disabled, `Esc` closing without acting, `Alt+↑/↓` moving the
focused row and announcing where it landed, and rows carrying **no**
`draggable` attribute — see `§3`) · **TtSettings** (every control patches the
field it names; the two-step reset; Diagnostics rendering, filtering, copying
parseable JSON and clearing; About rendering `__TT_VERSION__`; all nine groups
present; the crossfade slider and loop-style pair writing their fields — they
were asserted **absent** while spike S4b was open, the guard against shipping a
control with no feature under it, and turned present with the engine in v2.0) · TtBackdrop (every
background field genuinely read, one picture shown at a time, the scrim never
below the user's floor, scanlines suppressed under reduced motion without
rewriting the setting, Focus's dim layer) · TtYouTubeRail (the slot reserved at
exactly 384×216 px, no collapse control, the player kept and the queue dropped
in Focus, the typed card rendered inside the player area).

⚠️ The tier needs `resolve.conditions: ['browser']` in `vitest.config.ts`
(`11 §3`). TtCountdown was listed here from the start and never had a test; it is
covered by the format truth table in `§1` and by E2E, so it is dropped from this
list rather than left reading as an outstanding gap.

## 3. E2E (Playwright, `tests/e2e/`)

Fixtures: `scripts/make-fixtures.ts` generates ~5 s tones in seven containers
(mp3, flac, opus, m4a, oga, webm, wav) + one 11-min silent mp3 (for TT-IMP-002) +
one truncated `corrupt.mp3` that passes `canPlayType` and fails at decode (the
only way to reach TT-PLY-101 from a test — `wiring.spec.ts` finally uses it, in
v1.1) + `rejected.aiff`, `with-cover.mp3`, five Vietnamese tag fixtures and two
background PNGs — committed, tiny, self-made (no rights issues).

Five projects run over the whole `testDir` with no per-project `testMatch`, so
every spec that needs the island carries `test.skip(({ isMobile }) => !!isMobile)`
— on a blocked viewport the island never mounts (`07 §6`). `analytics.spec.ts`
deliberately does not: the beacon is on every page, blocked ones included. Specs that navigate away from a
non-empty queue must also handle the `beforeunload` guard (`02 §3`) or they hang.

🔴 **The harness serves `dist/`, and does not build it.** `webServer` runs
`astro preview`, which is deliberate — the mobile-gate assertions are about
which bundles the browser actually requests — but it means **a local
edit-then-test loop measures the previous build**. CI is safe (it builds before
the E2E job); a developer is not. Found in P6 slice B while mutation-testing the
legal footer: the injected bug produced a fully green suite, because the bug had
never been compiled.

The general form is worth more than the instance: **a mutation that fails to
turn anything red is a claim about the harness before it is a claim about the
code.** Rebuild, then re-run, before concluding a test is weak. Run
`pnpm build && pnpm test:e2e`, never `pnpm test:e2e` alone.

### Desktop WebKit — added P7 slice B, and what it found

`docs/16`'s P7 row asked for a "cross-browser sweep incl. WebKit" from the
beginning. The only WebKit project was `iPhone 14`, which every spec skips via
`test.skip(isMobile)` — so WebKit had exercised the mobile gate and nothing else,
while the roadmap read as though Safari were covered.

**The first run failed 130 of 166 specs, all on one line**, and the cause was a
product defect rather than a browser difference. Playwright's WebKit build
exposes **no `AudioContext` at all**, and `playback.unlock()` reaches `#ensure()`
**synchronously**, so a bare `void playback.unlock()` threw past the rest of its
handler. `void` discards a promise, not a synchronous throw. Three call sites,
three failures, each killing something that had nothing to do with audio:

| Site | What died |
|---|---|
| Legal gate | `session.gateAccepted()` never ran — the user was **trapped at the consent screen**, permanently, on every reload |
| Start, YouTube mode | `yt.load()`/`yt.play()` never ran — **no player**, in the mode whose player the ToS requires to be visible, and which uses no Web Audio at all |
| Start, local modes | `playback.load()` never ran |

All three now go through one guarded `unlockAudio()` (`try` for the throw,
`.catch` for the rejection), logging **TT-SYS-206**. Audio at these sites is
opportunistic and retried later; consent and playback are not.

A fourth defect surfaced once the app could run: **the zero milestone
announcement was racing `onDone`.** It fired from the tick, and
`announceMilestone` bails once state leaves `playing` — so it needed a tick to
land exactly at 0 first. Chromium won that race, WebKit did not, and a 12 s
countdown announced "ten seconds" and then nothing. Now announced from `onDone`,
which is the authoritative zero. Mutation-verified.

### Skip on the capability, never on a proxy for it

`skipWithoutAudio()` first skipped on `browserName === 'webkit'`, stating that
"Playwright's WebKit build exposes no `AudioContext`". That is true on **Windows**
— it is how 130 of 166 specs failed above — and **false on the Linux CI runner**,
which has it.

🔴 **`harness-assumptions.spec.ts` caught that on the first CI run after it was
written.** The guard was added on the theory that "a future Playwright build
might gain `AudioContext`"; what it found was that the assumption was **already
false on another platform**, one day later. A skip is a claim, and this one was
wrong about the machine that matters most.

The fix was not to make the guard platform-aware. It was to stop guessing:
the helper now **feature-tests** `AudioContext` and skips on the capability. A
feature test cannot drift from the platform, so the thing being guarded no longer
needs guarding — and the spec was repurposed to assert the check is
**load-bearing**, i.e. that Chromium really does expose `AudioContext`. A suite
where every audio test skips everywhere reports green and proves nothing.

Firefox stays name-based, and that asymmetry is the point: its constructor
**exists and lies** — `resume()` hangs on a runner with no output device — so
there is nothing to feature-test. Skip on a capability where one is detectable;
name a browser only where the failure is invisible to detection.

The same rule found the next one, in v1.1. **Playwright's headless Firefox
hides every scrollbar itself**, so `scrollbar-width` computes to `none` whatever
the page says — the hide-scrollbars spec failed there with
`data-tt-scrollbars="styled"` sitting correctly in the trace. It now gates its
computed check on a probe element carrying an inline `thin`, and asserts the
attribute flip and the persistence — the parts the app controls — everywhere.

⚠️ Audible **output** is asserted by Chromium and by desktop WebKit wherever it
exposes `AudioContext` (Linux CI does; Playwright's WebKit on Windows does not),
never by Firefox CI. Say that rather than implying full coverage.

⚠️ **`astro preview` is also more permissive than the deployed host, so some
things are unassertable here by construction.** Measured in P6 slice B: with
`build.format: 'directory'`, Cloudflare answers `/legal/eula` with a **307** to
`/legal/eula/`, while `astro preview` serves *both* with a plain 200. A missing
trailing slash therefore costs a redirect hop on every link in production and is
**invisible to this suite at any status assertion**. What guards it instead is an
exact-href equality assertion (the value, not the response) plus a `curl` block
in the live checklist. Before writing a guard, ask whether the harness can even
produce the failure — otherwise it is a test that can only pass.

| Flow | Assertions |
|------|------------|
| Gate → Setup → Single | accept unlocks; fixture plays — asserted as **`dataset.ttAudio === 'running'` and peak Analyser RMS > 0**, because "no error thrown" passes identically on a silent app; loop counter increments across a wrap; countdown reaches <60 s regime (short timer) and shows `SS.mmm`; Finished screen; **chime ran**, observed via `data-tt-chime-count` (the chime is synthesised, so there is no request to observe — and counting the run is the stronger assertion anyway, `05 §7`) |
| Hidden finish (`16 §P2`) | a second page fronted so `document.hidden` is genuinely true; on return the fade completed, the chime ran exactly once, media is paused and the Finished screen is correct. Asserts the **outcome**, never which path fired |
| Object-URL canary (`05 §3`) | under `?ttdebug=1`: import → play → replace → clear leaves the ledger at 0 and never exceeds the bound. ⚠️ **This row described a spec that did not exist until v1.1.1**, and it could not have passed: the panel read the count through a plain getter nothing reactive depended on, so it showed the number from its first render. The ledger now pushes every change (`wiring.spec.ts`, shown red on the old code) |
| Playlist limits | 11-min file rejected with toast; duplicate skipped; totals footer math; **a 95-file batch imports and the 96th is refused with TT-IMP-004**. The batch is one fixture buffer restaged under 95 distinct **names** — the dedupe key is `name::size::duration` (`02 §4` step 5), so passing the same path 95 times would add one row and 94 TT-IMP-005s, and the test would be green, fast, and about dedupe. ⚠️ TT-IMP-003 (91:00) is **not reachable from E2E**: the only long fixture exists to be rejected by TT-IMP-002, and reaching the aggregate cap needs a ~10:00 *legal* fixture nobody has generated. Its exact boundary keeps unit coverage |
| Queue reorder | **Both routes**, because they have different failure modes: `Alt+↑/↓` from a focused handle (with the `aria-live` position announcement), and a real pointer drag driven by `mouse.down`/`move`/`up`. The drag half is only assertable because reorder is built on **pointer events rather than the HTML5 DnD API** — `_helpers.ts` already records that Playwright cannot synthesise a native drag, so a `draggable` implementation would have shipped with no end-to-end coverage at all. Verified by mutation: deleting the `pointermove` handler fails this spec |
| Playlist playback (`02 §5.1`) | Three ~5 s fixtures play in sequence with **no click between them** — asserted as peak Analyser RMS > 0 both **before and after** the advance, because one that moved the highlight while loading a dead deck would pass on the highlight alone. Repeat off at exhaustion: media stops, "Đã hết danh sách" shows, and the countdown **keeps running** (`04 §5`). Removing the playing row advances rather than restarting. Shuffle mid-run leaves the current track playing. Right-click opens the info modal for the row that was targeted, not for track 1 |
| **Crossfade** (`05 §2`, v2.0) | `crossfade.spec.ts`, seven specs, each shown red against the mutation its comment names. Recorded **in the page**, on the page's clock: `data-tt-xfade-active` (curves scheduled → outgoing deck stopped), the current row as it changes (a 50 ms sampler missed one under load), and `tt-rms-now`, `tt-live-urls` and `tt-media-pos` every 50 ms; durations are asserted only where the media clock keeps real time (below). A→B→C: two ~2 s fades, the row moves **at** each fade's start and once, the level never falls below half of one track's alone, at most two live media URLs, TT-PLY-102 once. 0 s: a cut at `ended` onto the armed deck, and that deck is heard. 1 s → 3 s mid-run: the next fade is 2.5 s (half the track). Pause mid-fade: silent, and resume runs the **rest** of the curve. ⏭ mid-fade: lands once, still heard past where the abandoned fade would have ended. Single loop: fades into itself on one URL. Zero just before a transition: nothing starts under the end fade |
| Hotkeys | Space/M/F/H/]/S behave; disabled while typing. Satisfied in two parts: P2 shipped `Space`/`↑↓`/`M`/`Esc` with the Player screen; **P5 slice 2 completed the set** — `S` opens the panel and returns focus to ⚙, `H` hides Z4–Z7 and grows the digits, `]` collapses a local rail, and all of them are inert while the legal gate is up or the panel is open |
| Settings panel (`03 §6`) | `countdownSize` is **genuinely read** — the computed `font-size` is strictly ordered S < M < L and survives a reload; `glowIntensity` changes the rendered `text-shadow` (compared, never pattern-matched: Chromium serialises `color-mix` as `color(srgb …)` and Firefox as `rgba(…)`); `endAction: 'restart'` re-runs the countdown exactly once and `endFlash` fires; Diagnostics shows the real TT-USR-100 the gate logged; reset needs two presses and lands back on the gate |
| Visualizer + a11y (`05 §6`, `03 §8`) | Its own file. Each style **paints real pixels** — sampled from the canvas rather than asserted as "the element mounted", because a canvas that draws nothing looks identical to one working on a quiet passage. The tally pulse is asserted **at `Visualizer: off`**, which is where a beat published from inside the draw path would silently die. Reduced motion removes canvas *and* pulse while leaving the stored style untouched. The five milestones are driven by a **real** 12-second countdown — `page.clock` does not reach the timer worker, so a fast-forward would prove only that the component has an `if` — and the spec asserts exactly two announcements fire, which is what catches a spurious one from a stale baseline. Audio-dependent assertions skip on Firefox **per assertion, with the real reason** |
| **YouTube visibility** (`06 §1.2`, `03 §2`) | Its own file, `yt-visibility.spec.ts`, because the P4 suite could not express it: the countdown is swept across 1920→1024 px **in the ≥ 1 h regime**, which is 4.48 em wide against `MM:SS`'s 3.46 and is the regime every other YouTube spec skips. Asserts the player box ≥ 200×200, computed opacity exactly `1`, fully inside the viewport, no horizontal scroll, and **nothing painted over it** — sampled on a 5×5 grid, because a centre-only probe stayed green while the digits overlapped the player's left edge by 79 px. Covers Focus, `]`, the settings sheet and the info modal. ⚠️ Never `checkVisibility({checkOpacity:true})`: S1 measured it `true` at opacity 0.06 |
| i18n | toggle EN↔VI swaps visible strings without reload |
| Mobile gate (`07 §6`) | mobile project: overlay visible, **zero component/framework chunks** in the network log (the ≈200 B guard chunk is expected and is not the app bundle — `01 §3`); desktop project: island mounts |
| Offline | context.setOffline → banner; YT mode blocked panel |
| Late finish (`04 §2`) | drive a real countdown past its deadline with Playwright's `page.clock` and assert the Finished screen states the actual finish time; below the threshold assert the normal screen is unchanged. **Not** a shipped `?ttovershoot=` hook — a production affordance that lets any URL render a false finish time would prove only that the component has an `if`.<br>Verified 2026-07-21 on `@playwright/test@1.61.1`: `clock.fastForward` moves `Date.now()` and `performance.now()` in step (skew 0), so `04 §1`'s drift rule correctly does **not** re-anchor, and an 8-minute fast-forward on a 5-minute countdown produced a 390 001 ms overshoot. Note it fires with `late: false` and **no TT-SYS-203** — the worker keeps ticking on the real clock because `page.clock` does not reach the worker realm — so the threshold, not the latch, is what this spec exercises |
| 404 | unknown path serves styled 404 |
| Legal pages (`03 §3`, `08 §1.1`) | `legal.spec.ts`, P6 slice B. Every case is driven off `TT_LEGAL_DOCS`, so a fifth document extends the suite instead of quietly going uncovered: all 8 routes 200 with their heading and `TT_LEGAL_VERSION`; the canonical banner picks `canonicalEn` vs `canonicalVi` — **asserted against the dictionaries, not against English prose**, because the failure worth catching is the two being swapped, whereas a hardcoded substring just fails on the VI page for being in Vietnamese; no rendered legal href ends in `.md`; the EULA's cross-links stay in their own language. 🔴 **The load-bearing case is the landing footer**, checked on `/en/` as well as `/`: `TtFooter.astro` is the one legal-link call site with no runtime `i18n.lang`, so dropping its `lang` prop yields four valid links that all 200 in the wrong language. **Mutation-verified** — that revert turns exactly this test red and no other |
| Landing (`03 §3`, `08 §1`) | `landing.spec.ts`, P6 slice A. **hreflang asserted as RECIPROCITY, not presence** — both pages must advertise the same pair, because a page that merely has alternates can still point them somewhere wrong, and that is the failure Search Console reports weeks later. Plus: each page canonicalises to itself; the FAQ carries the `04 §2` item 6 countdown promise **in both languages**; the CTA reaches `/app/`; the GPL source-offer link is present with `rel=noopener`; the hero is the real capture, same-origin; `/app/` is `noindex` while the landing is not. The `docs/07 §5` crawler-content assertion in `mobile-gate.spec.ts` now covers `/en/` too |

Browsers: CI runs Chromium, Firefox and desktop WebKit on every PR, plus the two
mobile projects (`mobile-chromium`, `mobile-webkit`) that assert hard invariant 6.
(This line said "WebKit on the release branch" until v1.1; it was never true.)
Real Safari audio quirks are still a manual pass.

**CSP.** `astro preview` sends no headers, so every spec runs without a policy.
`e2e.yml`'s last step serves `dist/` through `wrangler dev` and runs
`scripts/verify-csp.mjs`, which fails on any CSP violation — the only automated
check of the policy the site actually ships (`14 §1`). `tests/unit/tt-headers.test.ts`
covers the file itself: every directive, the security headers, the cache rules,
and that `09 §4` — the policy's authoritative copy — matches what ships.

⚠️ **Audio in automation — measured 2026-07-21, and the conclusion is not the
obvious one.** On the Linux CI runner, headless Firefox's
`AudioContext.resume()` **never settles**: it does not reject, it hangs. That is
the signature of no audio output device, not of an autoplay policy — an autoplay
block rejects or leaves the context suspended immediately. Two remedies were
tried and neither helped, because both addressed the wrong cause:
`firefoxUserPrefs: { 'media.autoplay.default': 0 }` (kept, it is still correct
for media elements) and re-checking the gesture chain (which was already sound).

Consequences, all deliberate:

- **Only the assertions that need AUDIBLE output are skipped on Firefox** —
  single-mode playback, the loop counter, the chime tests and the playlist tests
  that wait for a real `ended`, each through `skipWithoutAudio()`. Everything
  else runs there, including the whole import pipeline and the Finished
  screens. Chromium runs all of them, and each phase's
  `tests/manual/p*-live-checklist.md` carries a real-Firefox item.

  **Skip only for the stated reason.** A playlist test that asserts a highlight,
  a disabled control or a bar title reads no Analyser, so skipping it "because
  audio" would record a reason that is false, understate the matrix, and hide
  any Firefox-only regression in the parts that do work there. Four such skips
  were written and removed in the same session — the temptation is to skip a
  whole file, and the file is the wrong unit.
- **Chromium is permissive too** (`--autoplay-policy=no-user-gesture-required`
  by default), so neither desktop project can catch a genuine "playback started
  without a gesture" regression. That is a unit test against a rejecting fake.
- **The environment exposed a real product bug**, which is the part worth
  keeping: a hung `resume()` meant `play()` was awaited forever, so the app sat
  there having "started" with no sound, no error and no log. Any desktop with a
  disabled sound device reaches the same state. Now bounded by a timeout and
  reported as **TT-PLY-105** (`12 §6`), with playback still attempted.

**Firefox audio has never been verified outside CI.** The dev box cannot launch
Playwright's Firefox at all (`spawn UNKNOWN`), so the real-browser gesture →
`resume()` chain on Firefox is a **manual live-site item**, not a covered one.

### Measuring a fade by its level — v2.0

`tt-peak-rms` holds the maximum, so it can only prove that something was heard
once. "Silent while paused" and "no gap through a fade" are claims about *now*:
`tt-rms-now` (`?ttdebug=1`) reads the analyser — after `fadeGain`, so it is what
a listener hears — every 50 ms, whatever state the run is in.

⚠️ **The fixtures had to differ in pitch.** An equal-power fade keeps the summed
power flat only for signals that do not correlate. Two copies of one tone do: at
the midpoint both gains are 0.707 and the sum's amplitude is `√(1 + cos φ)` for
whatever phase offset the decks happen to have — anything from silence to 1.41×,
a gap that is not there or a bump that is not either. So the spec fades
440 → 523 → 440 Hz (two of the committed tones, one renamed past the dedupe key),
and the Single-loop spec, which can only fade a track into itself, asserts the
level after the fade rather than through it.

⚠️ **CI's Linux WebKit does not keep real time.** With no audio device its media
clock runs fast against the page's: 5 s tracks ended every ~4.05 s, and
`currentTime` read up to ~1.5× ahead, so the trigger fired late in the track and
a 2 s fade measured 1.65 s (#92's first CI run). That is the browser on that
runner, not the engine — the same fades measure 2.0 s in Chromium, and S4b
measured them in a real Edge. So the spec measures the rate in **every run**,
from `tt-media-pos` (the active deck's position, `?ttdebug=1`) against the page
clock, and where it is off by more than 10 % it skips only the assertions about
how long something took, records the rate as an annotation, and still asserts
every piece of wiring — the capability, measured, never the browser's name. The
zero-before-a-transition spec runs a 1 s countdown for the same reason: at 2 s,
that clock reached A's trigger before zero did.

### Visual regression — v2.0 (`tests/visual/`)

The specs above assert what an element **is**; `tests/visual/screens.spec.ts`
asserts what the page **looks like**, which is where a token typo, a z-index
slip or a theme that misses one surface shows and nothing else does. Twelve
screens at 1440×900, DPR 1, `vi-VN`: the landing (VI, EN), a legal page and the
404, then — in **both themes** — the legal gate, Setup, the settings sheet and
the paused player. `toHaveScreenshot` with `animations: 'disabled'`, the caret
hidden, reduced motion (the hero video becomes its still) and
`maxDiffPixelRatio: 0.001`. What differs between two identical runs is kept
out: the running digits by a screenshot-only stylesheet
(`tests/visual/screenshot.css` — a mask left the tops of DSEG7's overflowing
glyphs showing), the transport bar, whose clock runs and which fades when
idle, by a mask.

**Baselines exist for one image only.** A screenshot compares only against one
taken with the same fonts, rasteriser and browser build, so baselines are made
— and the `visual` job in `quality.yml` compares them — inside
`mcr.microsoft.com/playwright:v1.64.1-noble`, **pinned by digest**.
`pnpm test:visual:docker` checks and `pnpm test:visual:docker --update`
rewrites: `scripts/visual-docker.ts` tars the working tree into the container,
installs and builds **there** (a Linux `node_modules` must never land in the
checkout) and tars the screenshots back. A run anywhere else says nothing about
the app. Bumping Playwright means a new digest in both files and every baseline
regenerated in the same PR.

**A PR that changes how a screen looks updates its baselines**, and the new
PNGs are reviewed in the diff like code. The job is informative, not required,
until a few weeks of runs show it does not flake (`14 §1`).

The wrapper's own first bug is the instance worth keeping: it waited for `tar`
from inside docker's exit handler, missed it whenever `tar` finished first, and
**exited 0 over eight failed screenshots**. It now waits for both and exits
with the container's code — a gate that cannot fail is the S4b lesson again
(`15 §S4`).

## 4. YouTube — semi-manual matrix (network-dependent, not in CI)

Curated list maintained in `tests/manual/yt-matrix.md` from **Spike S1**: one
normal video, one deleted id, one embed-disabled, one age-restricted, one
region-blocked (VN-visible vs not). Run before each release: assert each maps to
the documented overlay + log code (`06 §4`). CI mocks `/api/yt/oembed` responses
for the import-pipeline E2E instead of hitting YouTube, and `/api/yt/durations`
the same way (`mockDurations`, v2.0) — but only in the specs about lengths:
under `astro preview` that route is a 404, which is exactly "no key on this
deployment", and every spec written before v2.0 asserts what that looks like.
The real key is checked once per release on the PR's Version URL (`06 §3`).

## 5. Performance budget (checked in P7)

- `/app/` interactive bundle (pre-YT) ≤ 250 KB gz; IFrame API loaded only on
  YT-mode entry.
- Visualizer steady-state: no long tasks > 50 ms while playing (Performance
  panel spot-check); adaptive degrade path exercised by forcing 6× CPU throttle.
- **The per-frame countdown (v2.0, `pnpm perf:render`):** in the `SS.mmm`
  regime, at 1440p and 4K, 1× and 6× CPU, visualizer off/bars/ring — **no long
  task, and the main thread within the visualizer's own 20 ms degrade budget
  every frame**, with or without a GPU. `tests/perf/render-cost.spec.ts`
  asserts both; `TT_PERF_SOFTWARE=1` runs it with the GPU disabled.

### The render-cost probe — v2.0, closing the audit's last technical item

The audit asked whether the one element re-rastered every frame — the digits
under a minute, with their glow, the ghost segments, the display window and the
scanlines — could break the frame rate, and named the mitigations to reach for
if the text paint dominated. Measured 2026-10-21 on the dev box (Edge 155,
Windows 11, 240 Hz display), 8 s per configuration after a 2 s warm-up:

| | With the GPU (RTX 5080) | Without (SwiftShader) |
|---|---|---|
| Countdown alone, any size, 6× CPU | 240 fps; main thread 2.2 ms a frame | ≥ 212 fps; ≤ 3.9 ms |
| + visualizer, 1440p, 6× CPU | 240 fps; 2.6 ms | 57 fps; 17.6 ms |
| + visualizer, 4K, 6× CPU | 239 fps; 2.6 ms | **31 fps; 32.9 ms → 57 fps; 17.5 ms** with the pixel cap |
| + visualizer, 4K, 1× CPU | 240 fps; 0.4 ms | 130 fps → 81 fps with the pixel cap |

- **The text paint does not dominate.** The countdown alone holds 212 fps or
  more even rastered on the CPU at 4K — none of the mitigations the audit
  listed is needed.
- **The visualizer did, without a GPU, and the degrade could not see it.** It
  drew every frame while the main thread spent 33 ms on each: the cost is in
  getting a full 4K canvas to the screen, after the draw calls the degrade
  times. Its backing store is now capped at 1440p's pixel count
  (`backingScale()`, `05 §6`), which puts 4K back where 1440p is. The cost of
  the cap is honest too: with a fast CPU and no GPU, 4K falls from 130 to
  81 fps, because the compositor now scales the smaller canvas up on the CPU —
  still above 60, and off the main thread.
- A strong GPU hides all of it, so the table's right column is the one to
  re-run when the countdown or the visualizer changes.

**Lighthouse ≥ 95 was P6's gate and was checked by hand** — against the
Cloudflare PR preview, desktop, on `/` and `/en/`, all four categories. Its SEO
category validates canonical + hreflang + robots + meta-description, so it
doubles as the "hreflang correct" exit check. The **bundle-size number** below
stays P7's.

**Since v2.0 it runs on every PR** — `lighthouserc.json`, `@lhci/cli` 0.15.1
(dev-only), the `lighthouse` job in `quality.yml`: the landing in each language
and a legal page, desktop preset, three runs a page, the analytics beacon
blocked so CI never counts a visit. Performance must reach **0.90** — a shared
runner's CPU swings more than the page does — and accessibility, best practices
and SEO **0.95**. The reports are a workflow artifact; nothing is uploaded to
Google's public storage. Measured locally 2026-10-21: **100 / 100 / 100 / 100**
on every page, after the two fixes it pointed at:

- **CLS 0.197 on the legal pages**, from two late fonts. The version number's
  DSEG7 face overflows `line-height: 1`, so its line grew 14 px when the face
  arrived and pushed the whole document down — it is now an inline-block one em
  tall. And Be Vietnam Pro and Chakra Petch swapped in after first paint and
  re-wrapped the prose — their latin and vietnamese 400 and latin 600 files,
  what the first screen of any page uses, are preloaded by `TtBase`. Together:
  **0.005**.
- **The hero video's cache lifetime.** From `public/demo/` it got the platform's
  `max-age=0` and was revalidated on every visit — on the LCP element. Imported
  by `TtHero`, it is content-hashed under `/_astro/` and served `immutable`.

Two suggestions stay unfixed on purpose: DSEG7's `font-display: block` (a
fallback face would show wrong digits for a moment — `03 §1`), and the analytics
beacon counted as unused JavaScript.

**P7, confirmed 2026-07-24.** `16`'s P5 exit row used to read "perf budget met"
and contradicted this heading; the roadmap was corrected rather than this
chapter. A budget is only meaningful against the finished surface — P6 adds the
landing pages and P7 the polish — so a number fixed in P5 would have to be
re-measured anyway.

What **P5 owes** is separate and is a behaviour rather than a number: the
visualizer must *have* the adaptive-degrade path (`05 §6`), and slice 4 ships it
with a unit test over the decision. Whether the frame budget is actually met on
real hardware is what P7 measures.

## 6. Accessibility pass — ✅ **built in P7 slice B**

Keyboard-only full journey; axe scan on Landing/Setup/Player/Settings; reduced-
motion mode visual check; contrast spot-checks under brightest background preset.

`tests/e2e/a11y.spec.ts` owns the first two; reduced motion is already covered in
`backgrounds.spec.ts` and is not duplicated. `@axe-core/playwright` is **MPL-2.0**
(GPL-3.0 compatible) and test-only, so it gets no notices row — and
`make-notices.ts` proves that rather than asserting it: the generated artifact is
built from the client bundle, and axe does not appear in it.

🔴 **The `wcag*` tags alone are narrower than "accessible", and the gap is
invisible.** The first version scanned `wcag2a/2aa/21a/21aa` and reported zero
violations across seven surfaces — a clean result that was **wrong by omission**.
Demoting the landing's `<h1>` to `<h4>` produced no finding at all, because
heading rules are `best-practice` rather than a success criterion. With
`best-practice` added, the scan immediately found that **Setup and the Player had
no `<h1>` at all**: the Legal Gate has one and so does Finished, so every state a
user passes *through* was named while the two they spend their time in were not.
Fixed with a visually-hidden `h1` in the shell.

⚠️ **Verify an a11y scan by mutation like any other guard**, and rebuild first —
one attempt here "passed" against a stale `dist/` because a `grep -c` returning 0
broke the `&&` chain before `pnpm build` ran. Confirmed working by removing an
`alt`: exit 1, `image-alt`, on both landings.

**axe is only half of it.** It cannot tell you whether the app is *operable* — a
page can be perfectly labelled and still trap a keyboard user at the first
dialog, which is precisely what the `AudioContext` defect above did to the legal
gate. The keyboard-only specs are that half, and they locate controls **by
accessible label** (`getByLabel`, `getByRole`) rather than by testid, so they fail
for the same reason a real user would.

## 7. Live-site smoke checklist (spec: "test directly on the live site")

After every production deploy:

- [ ] Landing VI + `/en/` render; the hero plays (silent, looping)
- [ ] Gate appears on fresh profile; Accept persists across reload
- [ ] Single mode with a real MP3: plays, countdown accurate vs phone stopwatch over 10 min (±1 s) — **tab visible**, which is the only case that bound applies to (`04 §2`)
- [ ] Playlist: 3 files, shuffle + repeat, right-click info modal fields
- [ ] YouTube: 2 links play sequentially in visible player; one dead link → gone-overlay
- [ ] `<60 s` ms display smooth
- [ ] Finished + chime fire after a **hidden** run — and if it was late by more
      than 2 s, the screen states the actual finish time rather than implying
      "now" (`04 §2` option 3). Late is expected here, not a defect
- [ ] Headers/CSP live (`10 §11`), `/api` 429 after burst
- [ ] Real Android phone + touch-only iPad: gate shows, no bundle download
- [ ] Copy Diagnostics → paste parses as JSON

## 8. Build-time guards — the checks that are not tests

Four things are asserted by `pnpm build` and CI rather than by a spec, because
each one guards a property no test can observe from inside a browser.

| Guard | Fails when | Added |
|---|---|---|
| `inject-csp-hash.ts` | the site has more than one distinct inline script (`10 §7`) | P1 |
| `make-notices.ts` | a package in the shipped bundle has no licence text to reproduce (`11 §5`) | P7 slice A |
| `check-budget.ts` | the `/app/` boot bundle exceeds `§5`'s 250 KB gz | P7 slice B |
| `check-doc-refs.ts` | an `NN §M` citation resolves to a section that does not exist | P7 slice B |

All four are **mutation-verified**: each was made to fail on purpose, reading the
real exit code rather than a piped `tail`'s.

### The doc-reference resolver, and the mistake worth keeping

The suite carries **701** `NN §M` citations. They rot silently — renumbering a
section invalidates every citation of it everywhere else and nothing fails —
which is why `AUDIT-BACKLOG` had two findings about wrong cross-references, found
by hand.

🔴 **The first version of the resolver reported 23 broken references, and 21 of
them were correct.** It only understood markdown headings, and most subsections
in this suite are **numbered list items**: `06 §1.2` is item 2 of
`## 1. Compliance rules` — the always-visible player rule — and `12 §3.1` is item
1 of `## 3. Architecture rules`. Both resolve exactly as their citers intend.

Acting on that output would have rewritten twenty-one working pointers to satisfy
a linter that did not model the thing it was checking. **A guard that
misunderstands its subject manufactures work and calls it quality.** Ask what a
failing result would make you *do* before trusting it.

The two real findings were typos on one line of `AUDIT-BACKLOG.md` — ~~`03 §64`~~
and ~~`05 §86`~~ — corrected from **content**, not from arithmetic: the blurred
thumbnail they describe is in `03 §2`'s zone table and `05 §6`'s visualizer
section.

⚠️ Those two are struck through because the guard caught this very paragraph.
Quoting a broken reference to document it is indistinguishable, to a resolver,
from making one — so `~~…~~` marks a citation as **history rather than a live
pointer**, and the linter skips any line containing it. Without that escape the
only way to write about a bad reference would be to not write about it.
