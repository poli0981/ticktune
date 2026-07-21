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
| Audio graph | `createMediaElementSource` called exactly twice across many loads and deck swaps; a rejected `play()` logs one TT-PLY-100 and never reports "playing"; hard-loop wrap detection vs a user seek |
| End behavior | plan immutability once `done` has fired; `endFadeMs: 0` emits a single `setValueAtTime` and **never** a zero-duration curve (which throws `RangeError`); a volume write mid-fade leaves the fade automation untouched; all three `endAction` values |
| Late finish | `overshootMs` at 1 999 / 2 000 / 2 001 (strict `>`); a latch-fired `done` with a 300 ms overshoot renders the **normal** screen; the `now − overshootMs` reconstruction (`04 §2`) |
| i18n guard | `en.json` vs `vi.json` key-set diff = ∅ (build-failing) — from P5, when the dictionaries exist (`08 §3.1`) |

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
`data-tt-code` present) · TtQueuePanel (reorder, context menu opens, totals
footer) · TtSettings (End Behavior controls persist calls) · TtOverlay (typed
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
| Playlist limits | 11-min file rejected with toast; duplicate skipped; totals footer math |
| Hotkeys | Space/M/F/H/] behave; disabled while typing. Satisfied in two parts: P2 ships `Space`/`↑↓`/`M`/`Esc` with the Player screen; `F`/`H`/`]` arrive with Focus mode and the rail in P5 |
| i18n | toggle EN↔VI swaps visible strings without reload |
| Mobile gate (`07 §6`) | mobile project: overlay visible, **zero component/framework chunks** in the network log (the ≈200 B guard chunk is expected and is not the app bundle — `01 §3`); desktop project: island mounts |
| Offline | context.setOffline → banner; YT mode blocked panel |
| Late finish (`04 §2`) | drive a real countdown past its deadline with Playwright's `page.clock` and assert the Finished screen states the actual finish time; below the threshold assert the normal screen is unchanged. **Not** a shipped `?ttovershoot=` hook — a production affordance that lets any URL render a false finish time would prove only that the component has an `if`.<br>Verified 2026-07-21 on `@playwright/test@1.61.1`: `clock.fastForward` moves `Date.now()` and `performance.now()` in step (skew 0), so `04 §1`'s drift rule correctly does **not** re-anchor, and an 8-minute fast-forward on a 5-minute countdown produced a 390 001 ms overshoot. Note it fires with `late: false` and **no TT-SYS-203** — the worker keeps ticking on the real clock because `page.clock` does not reach the worker realm — so the threshold, not the latch, is what this spec exercises |
| 404 | unknown path serves styled 404 |

Browsers: CI on Chromium + Firefox every PR; WebKit added on the release branch
(Safari audio quirks are covered mainly by Spike S3/S4 + manual pass).

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
