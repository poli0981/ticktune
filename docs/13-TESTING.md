# 13 — Testing Strategy

Suite 1.0 · 2026-07-21

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
| Crossfade math | equal-power curve endpoints/midpoint (`out² + in² = 1`); trigger scheduling margins |
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

## 2. Component (Vitest + @testing-library/svelte + happy-dom, `tests/component/`)

TtFinished (**both variants** — normal below the threshold, and the late variant
rendering a clock time and elapsed phrase with no bare present-tense claim;
digits hold `0.000` in both) · TtSetup (limits meter, preset buttons in minutes,
Match-queue-length disabled rules, Start gated by `isReady`) · TtBottomBar
(`N/A`/`–` fallbacks, 4 s auto-hide, ⏮/⏭ disabled in Single) · TtTrackInfo (every
`02 §8` field, focus trap, `Esc` restores focus) · TtToast (summary counts,
`data-tt-code` present) · **TtQueuePanel** (now-playing highlight on exactly one
row and none before Start, an errored row struck through rather than hidden, the
totals footer rendering `–` when any duration is unknown, the context menu
resolving to the row that was targeted, all four `02 §8` items with the
end-of-list move disabled, `Esc` closing without acting, `Alt+↑/↓` moving the
focused row and announcing where it landed, and rows carrying **no**
`draggable` attribute — see `§3`) · **TtSettings** (every control patches the
field it names; the two-step reset; Diagnostics rendering, filtering, copying
parseable JSON and clearing; About rendering `__TT_VERSION__`; and the
**absence** of the Display and Visualizer groups, which is the guard against
shipping a control with no feature under it) · TtOverlay (typed
variants render correct i18n keys) · TtLegalGate (Accept enables only with
checkbox).

⚠️ The tier needs `resolve.conditions: ['browser']` in `vitest.config.ts`
(`11 §3`). TtCountdown was listed here from the start and never had a test; it is
covered by the format truth table in `§1` and by E2E, so it is dropped from this
list rather than left reading as an outstanding gap.

## 3. E2E (Playwright, `tests/e2e/`)

Fixtures: `scripts/make-fixtures.ts` generates three ~5 s tones (mp3/flac/opus) +
one 11-min silent mp3 (for TT-IMP-002) + one truncated `corrupt.mp3` that passes
`canPlayType` and fails at decode (the only way to reach TT-PLY-101 from a test)
— committed, tiny, self-made (no rights issues).

Every spec carries `test.skip(({ isMobile }) => !!isMobile)`: four projects run
over the whole `testDir` with no per-project `testMatch`, and on a blocked
viewport the island never mounts (`07 §6`). Specs that navigate away from a
non-empty queue must also handle the `beforeunload` guard (`02 §3`) or they hang.

| Flow | Assertions |
|------|------------|
| Gate → Setup → Single | accept unlocks; fixture plays — asserted as **`dataset.ttAudio === 'running'` and peak Analyser RMS > 0**, because "no error thrown" passes identically on a silent app; loop counter increments across a wrap; countdown reaches <60 s regime (short timer) and shows `SS.mmm`; Finished screen; **chime ran**, observed via `data-tt-chime-count` (the chime is synthesised, so there is no request to observe — and counting the run is the stronger assertion anyway, `05 §7`) |
| Hidden finish (`16 §P2`) | a second page fronted so `document.hidden` is genuinely true; on return the fade completed, the chime ran exactly once, media is paused and the Finished screen is correct. Asserts the **outcome**, never which path fired |
| Object-URL canary (`05 §3`) | under `?ttdebug=1`: import → play → replace → clear leaves the ledger at 0 and never exceeds the bound |
| Playlist limits | 11-min file rejected with toast; duplicate skipped; totals footer math; **a 95-file batch imports and the 96th is refused with TT-IMP-004**. The batch is one fixture buffer restaged under 95 distinct **names** — the dedupe key is `name::size::duration` (`02 §4` step 5), so passing the same path 95 times would add one row and 94 TT-IMP-005s, and the test would be green, fast, and about dedupe. ⚠️ TT-IMP-003 (91:00) is **not reachable from E2E**: the only long fixture exists to be rejected by TT-IMP-002, and reaching the aggregate cap needs a ~10:00 *legal* fixture nobody has generated. Its exact boundary keeps unit coverage |
| Queue reorder | **Both routes**, because they have different failure modes: `Alt+↑/↓` from a focused handle (with the `aria-live` position announcement), and a real pointer drag driven by `mouse.down`/`move`/`up`. The drag half is only assertable because reorder is built on **pointer events rather than the HTML5 DnD API** — `_helpers.ts` already records that Playwright cannot synthesise a native drag, so a `draggable` implementation would have shipped with no end-to-end coverage at all. Verified by mutation: deleting the `pointermove` handler fails this spec |
| Playlist playback (`02 §5.1`) | Three ~5 s fixtures play in sequence with **no click between them** — asserted as peak Analyser RMS > 0 both **before and after** the advance, because one that moved the highlight while loading a dead deck would pass on the highlight alone. Repeat off at exhaustion: media stops, "Đã hết danh sách" shows, and the countdown **keeps running** (`04 §5`). Removing the playing row advances rather than restarting. Shuffle mid-run leaves the current track playing. Right-click opens the info modal for the row that was targeted, not for track 1 |
| Hotkeys | Space/M/F/H/]/S behave; disabled while typing. Satisfied in two parts: P2 shipped `Space`/`↑↓`/`M`/`Esc` with the Player screen; **P5 slice 2 completed the set** — `S` opens the panel and returns focus to ⚙, `H` hides Z4–Z7 and grows the digits, `]` collapses a local rail, and all of them are inert while the legal gate is up or the panel is open |
| Settings panel (`03 §6`) | `countdownSize` is **genuinely read** — the computed `font-size` is strictly ordered S < M < L and survives a reload; `glowIntensity` changes the rendered `text-shadow` (compared, never pattern-matched: Chromium serialises `color-mix` as `color(srgb …)` and Firefox as `rgba(…)`); `endAction: 'restart'` re-runs the countdown exactly once and `endFlash` fires; Diagnostics shows the real TT-USR-100 the gate logged; reset needs two presses and lands back on the gate |
| Visualizer + a11y (`05 §6`, `03 §8`) | Its own file. Each style **paints real pixels** — sampled from the canvas rather than asserted as "the element mounted", because a canvas that draws nothing looks identical to one working on a quiet passage. The tally pulse is asserted **at `Visualizer: off`**, which is where a beat published from inside the draw path would silently die. Reduced motion removes canvas *and* pulse while leaving the stored style untouched. The five milestones are driven by a **real** 12-second countdown — `page.clock` does not reach the timer worker, so a fast-forward would prove only that the component has an `if` — and the spec asserts exactly two announcements fire, which is what catches a spurious one from a stale baseline. Audio-dependent assertions skip on Firefox **per assertion, with the real reason** |
| **YouTube visibility** (`06 §1.2`, `03 §2`) | Its own file, `yt-visibility.spec.ts`, because the P4 suite could not express it: the countdown is swept across 1920→1024 px **in the ≥ 1 h regime**, which is 4.48 em wide against `MM:SS`'s 3.46 and is the regime every other YouTube spec skips. Asserts the player box ≥ 200×200, computed opacity exactly `1`, fully inside the viewport, no horizontal scroll, and **nothing painted over it** — sampled on a 5×5 grid, because a centre-only probe stayed green while the digits overlapped the player's left edge by 79 px. Covers Focus, `]`, the settings sheet and the info modal. ⚠️ Never `checkVisibility({checkOpacity:true})`: S1 measured it `true` at opacity 0.06 |
| i18n | toggle EN↔VI swaps visible strings without reload |
| Mobile gate (`07 §6`) | mobile project: overlay visible, **zero component/framework chunks** in the network log (the ≈200 B guard chunk is expected and is not the app bundle — `01 §3`); desktop project: island mounts |
| Offline | context.setOffline → banner; YT mode blocked panel |
| Late finish (`04 §2`) | drive a real countdown past its deadline with Playwright's `page.clock` and assert the Finished screen states the actual finish time; below the threshold assert the normal screen is unchanged. **Not** a shipped `?ttovershoot=` hook — a production affordance that lets any URL render a false finish time would prove only that the component has an `if`.<br>Verified 2026-07-21 on `@playwright/test@1.61.1`: `clock.fastForward` moves `Date.now()` and `performance.now()` in step (skew 0), so `04 §1`'s drift rule correctly does **not** re-anchor, and an 8-minute fast-forward on a 5-minute countdown produced a 390 001 ms overshoot. Note it fires with `late: false` and **no TT-SYS-203** — the worker keeps ticking on the real clock because `page.clock` does not reach the worker realm — so the threshold, not the latch, is what this spec exercises |
| 404 | unknown path serves styled 404 |
| Landing (`03 §3`, `08 §1`) | `landing.spec.ts`, P6 slice A. **hreflang asserted as RECIPROCITY, not presence** — both pages must advertise the same pair, because a page that merely has alternates can still point them somewhere wrong, and that is the failure Search Console reports weeks later. Plus: each page canonicalises to itself; the FAQ carries the `04 §2` item 6 countdown promise **in both languages**; the CTA reaches `/app/`; the GPL source-offer link is present with `rel=noopener`; the hero placeholder is same-origin and labelled; `/app/` is `noindex` while the landing is not. The `docs/07 §5` crawler-content assertion in `mobile-gate.spec.ts` now covers `/en/` too |

Browsers: CI on Chromium + Firefox every PR; WebKit added on the release branch
(Safari audio quirks are covered mainly by Spike S3/S4 + manual pass).

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
  single-mode playback, the loop counter, the two chime tests, and the one
  playlist test that waits for a real `ended`. Everything else runs there,
  including the whole import pipeline, the Finished screens, and seven of the
  nine playlist tests. Chromium runs all of them, and each phase's
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

## 4. YouTube — semi-manual matrix (network-dependent, not in CI)

Curated list maintained in `tests/manual/yt-matrix.md` from **Spike S1**: one
normal video, one deleted id, one embed-disabled, one age-restricted, one
region-blocked (VN-visible vs not). Run before each release: assert each maps to
the documented overlay + log code (`06 §4`). CI mocks `/api/yt/oembed` responses
for the import-pipeline E2E instead of hitting YouTube.

## 5. Performance budget (checked in P7)

- `/app/` interactive bundle (pre-YT) ≤ 250 KB gz; IFrame API loaded only on
  YT-mode entry.
- Visualizer steady-state: no long tasks > 50 ms while playing (Performance
  panel spot-check); adaptive degrade path exercised by forcing 6× CPU throttle.

**Lighthouse ≥ 95 is P6's gate and is checked by hand**, not in CI — against the
Cloudflare PR preview, desktop, on `/` and `/en/`, all four categories. Its SEO
category validates canonical + hreflang + robots + meta-description, so it
doubles as the "hreflang correct" exit check. The **bundle-size number** below
stays P7's.

**P7, confirmed 2026-07-24.** `16`'s P5 exit row used to read "perf budget met"
and contradicted this heading; the roadmap was corrected rather than this
chapter. A budget is only meaningful against the finished surface — P6 adds the
landing pages and P7 the polish — so a number fixed in P5 would have to be
re-measured anyway.

What **P5 owes** is separate and is a behaviour rather than a number: the
visualizer must *have* the adaptive-degrade path (`05 §6`), and slice 4 ships it
with a unit test over the decision. Whether the frame budget is actually met on
real hardware is what P7 measures.

## 6. Accessibility pass (P7)

Keyboard-only full journey; axe scan on Landing/Setup/Player/Settings; reduced-
motion mode visual check; contrast spot-checks under brightest background preset.

## 7. Live-site smoke checklist (spec: "test directly on the live site")

After every production deploy:

- [ ] Landing VI + `/en/` render; hero placeholder present (until real capture)
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
