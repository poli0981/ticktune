# CLAUDE.md — AI Assistant Instructions for TickTune

> Read this before proposing or writing any code in this repository.
> Docs suite in `docs/` is authoritative; this file is the condensed contract.

## What this project is

TickTune (`poli0981/ticktune`, GPL-3.0-only): a desktop-only static web app —
user-supplied music (local files or YouTube links) behind a large DSEG7 digital
countdown, styled as broadcast rack hardware ("Rack Unit", `docs/03`). Astro 7
static pages + one Svelte 5 island at `/app/`, deployed to Cloudflare Workers
Static Assets with two API routes (`GET /api/yt/oembed`, and since v2.0
`GET /api/yt/durations`, which holds the Data API key as a Worker secret). Vietnamese
default UI, English mirror, and since v2.0 a Japanese app, landing and 404.

The island is **hand-mounted**, not mounted with an Astro client directive:
`src/pages/app/index.astro` imports `src/app/mount.ts` behind the `docs/07 §3.2`
gate guard. `client:only` was measured and rejected — it fetches and hydrates the
island even on a blocked viewport. Do not "simplify" this back to a directive;
the reasoning and the numbers are in `docs/01 §3`.

## Hard invariants — never violate, never "optimize away"

1. **User files never leave the browser.** No upload endpoints. Files are
   session-only RAM (`File` objects); only settings persist (Dexie). Do not
   introduce File System Access API (breaks Firefox/Safari and decision D3).
   The **only** telemetry is the Cloudflare Web Analytics beacon in `TtBase.astro`
   (decided 2026-10-20: page-level, cookieless, disclosed in the Privacy Policy
   and the Legal Gate). It must never read app state, and nothing else may be
   added without the same disclosure, CSP change and `TT_LEGAL_VERSION` bump.
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
7. **No GSAP** (licence conflict with GPL-3.0). Animation is CSS keyframes and
   transitions; if a library is ever needed, Motion (MIT) is the vetted one —
   none is installed. New deps require a GPL-compat license check;
   **distributed** deps also require an entry in `legal/THIRD-PARTY-NOTICES.md`.
   Dev-only tooling is covered by that file's dev-tooling paragraph and gets no
   row (`docs/11 §5`).
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
  The static pages have their own dictionaries, `src/i18n/static/{en,vi}.ts`
  (`/` is VI, `/en/` is EN), whose parity is a type error rather than a test.
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
pnpm build        # astro build → dist/ + CSP hash + notices + size budget
pnpm lint         # eslint + prettier check
pnpm check        # astro check + svelte-check + worker tsc
pnpm knip         # unused code gate — must stay clean
pnpm test         # vitest unit + component + worker, with coverage
pnpm test:e2e     # playwright: chromium, firefox, webkit + mobile gate
pnpm verify:csp   # the served CSP in a real browser, under wrangler dev
node scripts/check-doc-refs.ts   # every `NN §M` citation resolves
```

Never `wrangler deploy` by hand — production is a signed tag (`docs/14 §5`).

## Doc map (read before touching the area)

Architecture `docs/01` · Data flow & limits `docs/02` · UI/"Rack Unit" tokens
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

**v1.1.0** (2026-10-20) is the current release, live on `https://ticktune.net`.
P1–P7 are complete — v1.0.0 closed P7 — and every phase's exit review is in
`docs/16`. v1.1 was a full review rather than a phase: supply chain and CI, the
runtime wiring, Cloudflare Web Analytics with Legal 1.1, the "Rack Unit"
redesign with the hide-scrollbars setting, and this docs sync — `docs/16`'s
v1.1 section has the review.

**Releases are tag-only (decided 2026-10-20).** Workers Builds runs
`npx wrangler versions upload` for every push, so a branch gets a preview URL
and **never** production; production changes only when a signed `vX.Y.Z` tag is
pushed, and `deploy.yml` verifies the signature against
`https://github.com/poli0981.gpg` and that the tag is on `main` before it
deploys. Never `wrangler deploy` by hand. Until v1.1 every pushed branch —
Dependabot's included — went straight to 100% of production (`docs/14 §5`).

The live checklist for a release runs against the PR's **preview deployment**,
before the merge: `astro dev`/`astro preview` are excluded because they do not
run the Worker, but the preview version does. A failure there costs a
force-push; the same failure after a tag costs a patch release, which is what
v0.5.1 and v0.5.2 were.

### The lesson this project keeps relearning

**The engines are right and the wiring between them is wrong.** P4's YouTube
playback did not work at all — `onStart` is synchronous while the rail mounts a
microtask later — with every value and engine correct. P5's milestones announced
"one minute remaining" on a 12-second run because the shell passed the idle
preview's display value as the crossing baseline. v1.1's review found
seventeen runtime defects, most of that same shape: a fade timer that paused the
next run, a removed track that kept playing, a decode error nobody routed. No unit test of a
pure function can see the arguments its caller chooses; that is what
`tests/e2e/wiring.spec.ts` exists for, and each of its specs was shown red on
the old code.

Three habits that found the rest:

- **Grep for the READ, not the declaration.** 14 of 26 `TtSettings` fields were
  declared, defaulted, clamped, persisted, unit-tested — and read by nothing.
  The same search found the whole diagnostics API, `ttLog.subscribe` and
  `__TT_VERSION__` with no consumer. Every field now ships with a test that it
  is genuinely read.
- **Measure what a document promises.** Six claims failed that test in P7 alone
  (the CSP "rollout", the notify fan-out, `localStorage`, a second Google
  origin…), and v1.1 found that the bottom bar's "fade" had always been a cut:
  its idle class was the bare word `hidden`, which Tailwind compiles to its own
  `display: none` utility. **Never give a component class a bare utility name.**
- **When an action is gated on evidence, ask what gathers that evidence and
  whether the gate forbids it.** The offline banner blocked the only action
  that could clear it (v0.5.2).

### Decisions not to re-derive

**Data and settings**

- **Changing a default reaches nobody who has used the app** — `load()` lets the
  stored row win and `patch()` writes the whole object — so a default change
  ships with a `schema` migration (`docs/02 §3.2`); `visualizer: 'off'` was
  1 → 2. A **new** field needs none, and gets its long-term default on day one
  (`hideScrollbars: false`).
- **The playback cursor is a track id** (`docs/02 §5.1`). `crypto.randomUUID()`
  for track ids, not nanoid (`docs/02 §2`).
- **Backfill fills blanks only** — oEmbed's title beats the player's, so
  `session.patchTrack` never overwrites a value that is already there.

**Audio and time**

- **S2 failed, and so did its remedy** (`docs/04 §2`): hidden + silent, `done`
  fired 2 m 57 s late; with the keep-alive oscillator ON, still 52.4 s late —
  the stall is main-thread message processing. **Do not build a keep-alive
  source.** The promise is re-scoped: accurate while visible, best-effort while
  hidden, and the **late Finished screen** (`overshootMs > 2 s`) states when
  zero was actually reached. Keep the visibility/focus latch — it is the only
  reason a hidden countdown finishes at all.
- **Crossfade is deferred** until S4b passes: ship `singleLoopStyle: 'hard'`; a
  stored `'crossfade'` falls back with **TT-SYS-205**.
- **The chime is synthesised** with `OscillatorNode`s — no `public/audio/`.
- **The master stage is two nodes**, `userGain` then `fadeGain` (`docs/05 §1`).
  One shared node throws `NotSupportedError` when the volume changes mid-fade.
- **The beat is published BEFORE the style is consulted**, so `Visualizer: off`
  keeps the tally pulsing (`05 §6`); the E2E asserts the pulse at `off`.
- **Adaptive degrade measures the visualizer's own work**, never the gap
  between frames.
- **The timer worker is created eagerly** (the driver's constructor), and a
  worker error falls back to a main-thread interval with **TT-SYS-207** — a tab
  left open across a deploy used to 404 its worker chunk and never reach
  `done`.

**YouTube**

- **S1: `onError` does not discriminate** — private, age-restricted,
  region-blocked, deleted, malformed and embed-off all report **150**. The
  cause lives in the **oEmbed status**, at import.
- **A status is only a cause if our own endpoint produced it.** The Worker
  always answers `application/json`; anything else — a static 404, a captive
  portal, a challenge — is transient, the track stays `pending`, and the Worker
  never caches a transient verdict. Both fetches time out (client 10 s, Worker
  8 s) into that same transient branch. The route sends **no CORS headers**: it
  is called same-origin, and `ACAO: *` only made it a free proxy for others.
  **The cache key is versioned** (`CACHE_VERSION`): a hit is returned verbatim,
  headers included, so bump it whenever what is stored changes (`06 §3`).
- **The `pending` re-check runs AFTER `start()` returns**, never inside it —
  `start()` is synchronous because the gesture chain is.
- **Paused means silent.** ⏭/⏮/jump while paused **cue** rather than load
  (`cueVideoById`), and the autoplay intent survives the player becoming ready.
- **Sources do not mix** — a queue is all-local or all-links (`docs/06 §5`).
- **The ToS carve-out is real** (`docs/03 §2`): S1 measured a collapsed rail
  leaving the player `0×0` and Focus leaving it at opacity 0.06, audio running.
  `TtYouTubeRail` renders **no collapse control**. ⚠️
  `checkVisibility({checkOpacity:true})` returns **true** at 0.06 — assert
  computed opacity plus the box, as the E2E does.
- **`--tt-yt-reserve` is the one mechanism for "no overlay covers the player"**,
  published on `.tt-main`; **every** fixed layer insets its right edge by it —
  since v1.1 the bottom bar and the debug panel too. The context menu has no
  backdrop for the same reason: a capture-phase listener closes it instead.
- **The countdown cap `22.2cqw` is a ToS floor** (`docs/03 §4`): in the ≥ 1 h
  regime the player was once pushed off screen below 1920 px. The rails are
  `flex: none`; `tests/e2e/yt-visibility.spec.ts` samples a 5×5 grid, never the
  centre. The v1.1 display window behind the digits is a pseudo-element bleeding
  0.08em — the arithmetic that keeps it off the player is in `03 §4`.
- 🔴 **Nothing derived from the YouTube thumbnail** — no hue, no blurred
  background. S1 showed the canvas is not tainted, so the only objection left is
  the unread ToS, which makes building it a *decision* nobody has taken.
- **The E2E YouTube seam is `page.route` over `iframe_api`**, not a stubbed
  `window.YT`. ⚠️ The oEmbed mock **must** send `content-type: application/json`
  or every cause case silently becomes `pending` and passes for the wrong reason.

**UI**

- **The "Rack Unit" tokens live in `global.css` `@theme`, and their JS mirror in
  `src/lib/tt-palette.ts`** — the scrim maths, the visualizer fallback and the
  gradient presets read numbers; `tt-palette.test.ts` fails if the two disagree.
- **Primitives are in `@layer components`, and Svelte's scoped CSS is unlayered**
  — it beats them. A component adopting `.tt-key`/`.tt-seg`/`.tt-switch` must
  drop its own competing rules for that element.
- **A settings group ships with its feature, never before it** — no disabled
  placeholders (`docs/03 §6`). Crossfade and the loop-style selector are still
  absent from Audio.
- **The ⚙ panel is a left side sheet with no backdrop and no `aria-modal`** — a
  full-bleed backdrop is exactly what `03 §2` forbids over the player.
- **`scrimAuto` is solved arithmetic** that reports its 0.60 cap rather than
  exceeding it; **auto-theme is a `hue-rotate`**, never a rebuilt gradient.
- **Slideshow pictures are session-only**, and the panel says so; backgrounds
  use a second `TtUrlLedger` so `09 §5`'s leak canary stays meaningful.
- **Reorder is pointer events, never HTML5 `draggable`** — Playwright cannot
  synthesise a native drag. **The import progress bar is delay-gated**, because
  "a spinner would flash" was a requirement.
- **Fonts are `@fontsource` CSS imports, which knip cannot see** — all three
  families sit in `ignoreDependencies` and in `make-notices.ts` `CSS_ONLY`.
  Removing them restores the silent `system-ui` fallback.

**Static pages and legal**

- **Static key parity is a COMPILE error**: `vi.ts` is annotated against
  `typeof en`, and `en.ts` is deliberately not `as const`.
- **hreflang lives in the page, asserted as reciprocity**; `@astrojs/sitemap`'s
  i18n mode is unused because VI has no path prefix.
- **A material legal change bumps `TT_LEGAL_VERSION`** in the same PR, and
  legal changes are batched — every bump re-prompts every user. 1.1 carried the
  analytics disclosure, the 7-day log retention and the role addresses at once.
- **Contacts are role addresses on `poli0981.dev`**: privacy@, legal@,
  copyright@, security@, press@, collab@. `games@`, `dmca@`, `takedown@`,
  `code@` and `sponsor@` are deliberately unused — there is no hosted user
  content to take down.
- **The perf budget is P7's measurement**, fixed when the surface was final.

**Testing**

- **E2E specs import `test` from `tests/e2e/_fixtures.ts`**, never from
  `@playwright/test` (ESLint enforces it): its auto fixture stubs the analytics
  beacon, so CI never pollutes the real page-view numbers.
- **Firefox CI cannot test audible output** — `AudioContext.resume()` hangs on
  the runner, which has no audio device — so `skipWithoutAudio()` skips the
  audio-signal specs there. Everywhere else it checks the **capability**
  (`AudioContext` present), never a browser name: P7 found a skip that named
  WebKit for a reason that was not happening. Real Firefox audio is a manual
  check.
- **Build before test**: two unit suites read `dist/`, and under `CI` a missing
  `dist/` is a failure, not a skip.
- **Playwright's headless Firefox hides scrollbars itself** — `scrollbar-width`
  computes to `none` there whatever the page says — so a computed scrollbar
  check is gated on a probe, never asserted unconditionally (`13 §3`).

Resolved and pinned: TypeScript `~5.9` (TS 7 crashes svelte-check, `docs/11 §4`)
· DSEG7 Classic **v0.46** (`docs/11 §2`) · island mount by hand (`docs/01 §3`).

### Open items, in the order they block things

1. **Spike S4b** is the only open spike, and its harness must be fixed first: the
   overlap metric reads back the `gain.value` it scheduled itself, so it cannot
   fail (`docs/15 §S4`). Measure the overlap from the audio (an Analyser or an
   `OfflineAudioContext` render), then run the 0/1/2/5 s sweep — that unblocks
   the crossfade loop style and inter-track crossfade.
2. **Post-1.1 directions** are in `docs/16`'s backlog section.
3. `docs/AUDIT-BACKLOG.md` — see its header for the open count; no release
   blocker remains.

**CodeQL runs as GitHub default setup — keep it enabled.** The old instruction to
disable it applied only while the advanced `codeql.yml` existed; that file is
gone (`docs/14 §1`).

`test/` is a **local-only, git-ignored** ~651 MB audio corpus for spikes S3/S4.
Never commit it, never reference it from shipped code, never assume it exists in
CI. `scripts/guard-no-corpus.mjs` enforces this beyond `.gitignore`.
