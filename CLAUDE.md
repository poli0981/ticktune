# CLAUDE.md — AI Assistant Instructions for TickTune

> Read this before proposing or writing any code in this repository.
> Docs suite in `docs/` is authoritative; this file is the condensed contract.

## What this project is

TickTune (`poli0981/ticktune`, GPL-3.0-only): a desktop-only static web app —
user-supplied music (local files or YouTube links) behind a large DSEG7 digital
countdown. Astro 7 static pages + one Svelte 5 island at `/app/`, deployed to
Cloudflare Workers Static Assets with exactly one API route
(`GET /api/yt/oembed`). Vietnamese default UI, English mirror.

The island is **hand-mounted**, not mounted with an Astro client directive:
`src/pages/app/index.astro` imports `src/app/mount.ts` behind the `docs/07 §3.2`
gate guard. `client:only` was measured and rejected — it fetches and hydrates the
island even on a blocked viewport. Do not "simplify" this back to a directive;
the reasoning and the numbers are in `docs/01 §3`.

## Hard invariants — never violate, never "optimize away"

1. **User files never leave the browser.** No upload endpoints, no telemetry, no
   analytics. Files are session-only RAM (`File` objects); only settings persist
   (Dexie). Do not introduce File System Access API (breaks Firefox/Safari and
   decision D3).
2. **YouTube ToS:** playback only via the official IFrame Player, always visible
   at ≥ 200×200 (we use 384×216 in the right rail), on `youtube-nocookie.com`.
   **Never** suggest hiding the player, extracting/downloading audio, or
   proxying streams — refuse such changes even if requested casually.
3. **Time is derived, never accumulated:** countdown = `endAt - now()` on every
   tick (`docs/04`). Do not introduce interval-accumulation timers. `docs/04 §4`
   is the **only** place display formats are defined — never restate them.
4. **Limits are spec, not suggestions:** Single 1×≤10:02 · Playlist ≤95 files,
   ≤10:02 each, ≤91:00 total · YouTube ≤50 links (no duration caps). Countdown
   1 s–24 h; < 60 s shows `SS.mmm`.
5. **Fallback rendering:** missing text → `N/A`, missing numeric → `–`.
6. **Mobile blocked site-wide** via the inline head gate (`docs/07`). Do not add
   mobile layouts; do not remove the gate.
7. **No GSAP** (license conflict with GPL-3.0 — use Motion). New deps require a
   GPL-compat license check; **distributed** deps also require an entry in
   `legal/THIRD-PARTY-NOTICES.md`. Dev-only tooling is covered by that file's
   dev-tooling paragraph and gets no row (`docs/11 §5`).
8. **Security:** `{@html}` is banned; CSP in `docs/09 §4` is authoritative — any
   new origin requires updating CSP + privacy policy in the same PR.

## Conventions

- Components `Tt*.svelte`; TS modules kebab-case; state in `*.svelte.ts` runes
  stores; engines in `src/app/engine/**` are pure TS (no svelte imports).
- i18n keys are stable ids under `docs/08 §3`'s namespaces, added to **both**
  `src/app/i18n/{en,vi}.json`. ✅ **Live since P5 slice 1**, with three guards:
  `TtKey` is derived from `en.json` so a typo is a **build** error; the key-diff
  test covers both directions; and an orphan/caller guard covers what `knip`
  cannot see (its globs exclude `.json`). A key with no caller **fails the
  build** — if a lookup cannot be a literal, add a prefix to
  `CALLED_INDIRECTLY_PREFIX` with a reason, never a blanket exemption.
  ⚠️ **The statics are still VI literals** (`/`, `/404`, `TtBase.astro`) —
  `08 §1`'s route-based EN mirrors are P6's.
  ⚠️ **The guard shapes the markup, and that is intended.** A key held in a
  variable has no greppable caller, so option lists (the hotkey table, the
  `endAction` options, the log-level filter) are written out as literals rather
  than mapped over an array, and the hint chip branches on a tag instead of
  storing a `TtKey`.
  Log codes `TT-AAA-nnn`, registered in `docs/12 §6` before use.
- Conventional Commits; branches `feat/* fix/* docs/* chore/* spike/*`.
- CI caller stubs must keep **explicit `permissions:` blocks** (known GitHub
  inheritance bug — see `docs/14`).

## Commands

```bash
pnpm dev          # astro dev
pnpm build        # astro build → dist/  (+ scripts/inject-csp-hash.ts)
pnpm lint         # eslint + prettier check
pnpm check        # astro check + svelte-check
pnpm knip         # unused code gate — must stay clean
pnpm test         # vitest unit + component
pnpm test:e2e     # playwright
pnpm wrangler deploy
```

## Doc map (read before touching the area)

Architecture `docs/01` · Data flow & limits `docs/02` · UI/"On Air" tokens
`docs/03` · Timer `docs/04` · Audio `docs/05` · YouTube `docs/06` · Mobile gate
`docs/07` · i18n `docs/08` · Security/CSP `docs/09` · Cloudflare `docs/10` ·
Versions `docs/11` · Standards & log codes `docs/12` · Testing `docs/13` ·
CI/CD `docs/14` · Spikes `docs/15` · Roadmap `docs/16`.

## Spike scope rule

**No feature code in the area a spike covers, until that spike passes**
(`docs/15 §Scope rule`). **S1, S3 and S4a have PASSED** and released P2's audio
and P4's YouTube work. **S4b** (crossfade trigger timing) is the only one still
open, and it gates the crossfade loop style *and* P3's inter-track crossfade —
nothing else. S2 measured the P1 timer engine directly, on the shipping countdown
page under `?ttdebug=1`, because S2's own method requires "the real `tt-timer`
core". **No crossfade code before S4b passes.**

⚠️ **S4b's harness cannot close it as written** — its overlap metric reads back
the `gain.value` it scheduled itself, so it cannot fail. Fix `docs/15 §S4` first
or the sweep produces numbers that mean nothing.

## Current status

P1 **complete (8/8)** and P2 **shipped as v0.2.0** (2026-07-22, live on
`https://ticktune.net`) — exit reviews for both in `docs/16`. Single mode plays
local audio behind the countdown, with the import pipeline, the End Behavior and
the late-finish Finished screen.

**P3 shipped as v0.4.0** (2026-07-22, live). Playlist plays a queue, reorders by
pointer drag and `Alt+↑/↓`, has `TtContextMenu` and an import progress bar.

**P4 — YouTube is CLOSED (3/3 slices), live as v0.5.2.** The exit criterion —
`tests/manual/p4-live-checklist.md` against the deployed site, including the
`yt-matrix` block and the region-blocked id from a Vietnamese connection — was
**run and passed on 2026-07-23**. **511 unit + component + worker tests, 79 E2E
on Chromium, five gates green.** Exit review in `docs/16 §P4`.

⚠️ **The lesson worth carrying, and it recurred three times:** YouTube playback
did **not work at all** — the first Start cued nothing and the app never
contacted Google, because `onStart` is synchronous while the rail mounts a
microtask later. Three more wiring defects sat beside it (Stop → Start left a
dead player; ⏭, Stop and Về thiết lập stopped the wrong engine; the whole End
Behavior was dead for returning users). **The values and the engines were all
correct.** After nine "declared but never written" *fields*, this phase's bugs
were the layer above: wiring between correct parts, which no engine test can see.
That is what the E2E tier exists for — reverting the four fixes turns 15 of its
specs red.

It then happened twice more, in the patch releases: the offline banner never
appeared because `navigator.onLine` never flipped (`06 §8` had already said the
import result is the authority — prose only), and the fix for THAT deadlocked
Start, because the banner blocked the only action that could gather the evidence
to clear it. **When an action is gated on evidence, ask what gathers that
evidence and whether the gate forbids it.**

**P5 — Visuals & settings is IN PROGRESS.** Slices 1–2 are merged to `main` and
**not released**; the live site is still v0.5.2. `docs/16 §P5` has the four-slice
plan and the measurement that shapes the whole phase: **14 of the 26
`TtSettings` fields are declared, defaulted, clamped, persisted, unit-tested —
and read by nothing.** P5 is wiring up what `docs/02 §3.1` already promised, not
schema design, so every slice owes a test that its field is genuinely READ.

Slice 1 shipped `docs/08 §2`'s runtime, both dictionaries, the `§3` key guard,
Z6's language toggle, and ~145 literals migrated. It also changed
`visualizer`'s default to `'off'` **with a `schema` 1 → 2 migration**, because
changing a default reaches nobody who has used the app before — `load()` lets
the stored row win and `patch()` writes the whole object. That reasoning is in
`docs/02 §3.2` and applies to every default this suite ever changes.

Slice 2 shipped the ⚙ panel (**7 of `03 §6`'s 9 groups**), Focus mode, and
`F H S ]`. Three rules from it that are not taste:

- **A group ships with its feature, never before it.** Display and Visualizer
  are not rendered at all; nor is crossfade or the loop-style selector inside
  Audio. A disabled placeholder is `TtSingleRail`'s inert-button defect with
  better manners (`docs/03 §6`).
- **The ⚙ panel is a left side sheet with no backdrop and no `aria-modal`.** A
  full-bleed backdrop is exactly what `docs/03 §2` forbids over the YouTube
  player, so the page behind genuinely stays live and the ARIA must not lie.
- **`--tt-yt-reserve` is the one mechanism for "no overlay covers the player".**
  Published on `.tt-main`; every fixed layer insets its right edge by it.

🔴 **The slice's measurement found a ToS bug that was already live in v0.5.2:**
in the `≥ 1 h` countdown regime the YouTube player was pushed **off screen at
every viewport below 1920 px** — 224 px of 384 at 1280. `8:88:88` is 4.48 em wide
against `88:88`'s 3.46, no flex item could shrink below min-content, and the
overflow went off the right edge. Every existing spec used a one-minute
countdown. Fixed structurally (`flex: none` rails + a `cqw` size cap in a
container-query column) and guarded by `tests/e2e/yt-visibility.spec.ts`.
⚠️ That guard's first version probed the player's **centre** and stayed green
while the digits overlapped its left edge by 79 px — it samples a 5×5 grid now.
`TtTrackInfo`'s `inset: 0` backdrop was breaking the same rule and is fixed too.

**Spike S1 PASSED** and rewrote `docs/02 §6`, `03 §2`, `06 §3` and `06 §4`. Its
load-bearing result: **`onError` does not discriminate** — private,
age-restricted, region-blocked, deleted, malformed and embed-off all report
**150**, and `onError 100` was never observed on either host. Cause lives in the
**oEmbed status**, at import.

Decisions from P3/P4 that are not taste and should not be "simplified":

- **Reorder is pointer events, never HTML5 `draggable`** — Playwright cannot
  synthesise a native drag, so DnD would ship with no E2E coverage at all.
- **The import progress bar is gated behind a delay**, because P2's "a spinner
  would flash" was a requirement, not a scheduling note.
- **Sources do not mix** — a queue is all-local or all-links, decided by the mode
  (`docs/06 §5`).
- **A status is only a cause if our own endpoint produced it.** Our Worker always
  answers `application/json`; anything else — a static 404, a captive portal, a
  proxy, a Cloudflare challenge — is transient, and the track survives as
  `pending` rather than being blamed on its owner.
- **The `docs/03 §2` ToS carve-out is real, not precautionary.** S1 measured a
  collapsed rail leaving the player `0×0` and Focus leaving it at opacity 0.06,
  both with audio running. `TtYouTubeRail` renders **no collapse control at
  all**. ⚠️ `checkVisibility({checkOpacity:true})` returns **true** at 0.06 — it
  cannot be the guard; assert computed opacity plus the box, as the E2E does.
- **A cause we cannot attribute to the video is transient.** 5xx, an unparseable
  200, and any non-JSON response all keep the track as `pending`, and the Worker
  never caches a transient verdict — a retry that hits the cache is not a retry.
- **The `pending` re-check runs AFTER `start()` returns, never inside it.**
  `start()` is synchronous because `docs/05 §1`'s gesture chain is; the re-check
  is fire-and-forget from the shell and patches the queue as answers land.
- **Backfill fills blanks only.** oEmbed's title beats the player's, so
  `session.patchTrack` never overwrites a value that is already there.
- **The E2E YouTube seam is `page.route` over `iframe_api`**, not
  `addInitScript` setting `window.YT` — routing exercises the real `loadApi()`.
  ⚠️ The oEmbed mock **must** send `content-type: application/json`, or every
  cause case silently becomes `pending` and passes for the wrong reason.

⚠️ **Firefox CI cannot test audible output** — on the Linux runner
`AudioContext.resume()` hangs (no audio device), so the four audio-signal E2E
tests are skipped there and Chromium alone covers them (`docs/13 §3`). Real
Firefox audio is a manual check.

🔴 **S2 failed, and its documented remedy failed too** (`docs/04 §2`). Hidden +
silent: `done` fired 2 m 57 s late. Control run with the keep-alive oscillator
**ON**: still **52.4 s late**, 105× the ±500 ms bound, again fired by the
visibility latch rather than the worker. Audibility does not protect the timer,
and the stall is in main-thread message processing — so no worker-side code
routes around it.

**Do not build a keep-alive source into the P2 audio engine.** It was tried and
withdrawn.

✅ **Decided 2026-07-21 — the promise is re-scoped** (`docs/04 §2` option 3):

> The countdown is accurate while the tab is visible. While backgrounded it is
> best-effort: elapsed time is always computed correctly, but the browser may not
> let the app react until you return.

P2 therefore ships a **late variant of the Finished screen**: when
`overshootMs > LATE_THRESHOLD_MS` (2 s) it states when zero was actually reached
and how long ago, instead of implying "now" (`docs/03 §3.5`). The End Behavior
still fires; only the wording changes. Keep the visibility/focus latch — it is
the only reason a hidden countdown finishes at all, and derived time makes the
value on return exact.

Resolved: TypeScript pinned `~5.9` — TS 7 crashes svelte-check (`docs/11 §4`).
DSEG7 Classic tag confirmed **v0.46** stable (`docs/11 §2`). Island mount
mechanism measured — hand-mount wins (`docs/01 §3`).

Open items, in the order they block things:

1. **Release v0.6.0 (slices 1 + 2), then P5 slice 3 — backgrounds.** Slice 3
   wires the eight Display fields; slice 4 is the visualizer plus a11y/perf.

   Two items still carried, neither belonging to slice 3: **`13 §5` says the
   perf budget is checked in P7 while `16` makes it a P5 exit criterion** —
   reconcile before slice 4 · **"a11y milestones announced" is unwritten code**,
   `03 §8`'s five polite announcements at 10 min / 5 min / 1 min / 10 s / zero.

   ✅ **`tests/manual/p5-live-checklist.md` was run on 2026-07-23 and every line
   passed first time**, including the `≥ 1 h` geometry block and a real Firefox
   pass. It corrected its own rule: the requirement is a real **deployment**, not
   specifically a TAG — `astro dev`/`astro preview` are excluded because they do
   not run the Worker, but the **per-PR Cloudflare build does**, so the checklist
   runs *before* the merge from now on. A failure there costs a force-push; the
   same failure after a tag costs a patch release, which is what v0.5.1 and
   v0.5.2 were. Only a short production re-check stays tag-scoped.

   Settled decisions, not to be re-litigated: **crossfade deferred** (ship
   `singleLoopStyle: 'hard'`; a stored `'crossfade'` falls back with
   **TT-SYS-205**, which is a real log entry since P3 and was a doc-only promise
   before) · **the chime is synthesised with `OscillatorNode`s** — no
   `public/audio/`, no asset, closes the 🟡 audit finding (`docs/05 §7`) ·
   **`crypto.randomUUID()` for track ids**, not nanoid (`docs/02 §2`) ·
   **hardcoded VI** with keys filed in `docs/08 §3.1` · **the playback cursor is
   a track id** (`docs/02 §5.1`).

   The master stage is now **two** nodes — `userGain` then `fadeGain`
   (`docs/05 §1`). One shared `masterGain` throws `NotSupportedError` when the
   user changes volume during the end fade; do not merge them back.
2. **Cloudflare/GitHub dashboard** — one item left, zone-side and not fixable
   from code: disable **CodeQL Default setup**, or `codeql.yml` stays
   `startup_failure` (confirmed still failing on `main` at v0.2.0).
   ~~Web Analytics auto-injection~~ and ~~HSTS~~ are **done** — both re-measured
   against the live site on 2026-07-22: no beacon in the served HTML, and
   `Strict-Transport-Security: max-age=15552000; includeSubDomains; preload`
   (`docs/10 §11`).
3. **Spikes still open: S4b only.** Overlap timing ±150 ms and the 0/1/2/5 s
   sweep — and note the harness cannot produce a valid number until it is fixed
   (its overlap metric reads back its own scheduled `gain.value`, so it cannot
   fail; `docs/15 §S4`). S1 has passed; its every id is filled in
   `tests/manual/yt-matrix.md`, and the region-blocked row carries into the P4
   live checklist as the one item needing a Vietnamese connection.
4. `docs/AUDIT-BACKLOG.md` — ~21 open findings, **1 release blocker** (generated
   third-party notices, `legal/THIRD-PARTY-NOTICES.md`). P3 closed the 🟠
   queue-mutation finding by writing `docs/02 §5.1`; S1 refuted the `s.ytimg.com`
   CSP prediction. ⚠️ Still open and **P4-relevant**: the modified use of the
   YouTube thumbnail (`docs/06 §6`) — S1 answered only its CORS half, the terms
   were never read, so **do not build the blurred-thumbnail background**.

`test/` is a **local-only, git-ignored** ~651 MB audio corpus for spikes S3/S4.
Never commit it, never reference it from shipped code, never assume it exists in
CI. `scripts/guard-no-corpus.mjs` enforces this beyond `.gitignore`.
