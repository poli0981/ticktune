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
- i18n keys `feature.element.state`, added to **both** `en.json` and `vi.json`
  (CI diff-guard fails otherwise). ⚠️ **Neither the dictionaries nor the guard
  exist yet** — they land in P5 (`docs/13 §1`), and every shipped string is a
  hardcoded VI literal until then. Do not claim CI guards a new key. Log codes
  `TT-AAA-nnn`, registered in `docs/12 §6` before use.
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
(`docs/15 §Scope rule`). S1 gates P4 (YouTube) · S3 + **S4a** gated P2 and have
passed; **S4b** (crossfade trigger timing) is still open and gates only the
crossfade loop style ·
S2 measures the P1 timer engine directly, on the shipping countdown page under
`?ttdebug=1`, because S2's own method requires "the real `tt-timer` core".
**No YouTube code before S1 passes; no crossfade code before S4b does.**

## Current status

P1 **complete (8/8)** and P2 **shipped as v0.2.0** (2026-07-22, live on
`https://ticktune.net`) — exit reviews for both in `docs/16`. Single mode plays
local audio behind the countdown, with the import pipeline, the End Behavior and
the late-finish Finished screen. **233 unit + component tests, 76 E2E across
four browser projects, five gates green.**

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

1. **P2 — local audio + Single mode. Scope complete; all three exit criteria
   pass** — see the exit review in `docs/16`. 228 unit + component tests, 42
   E2E. What remains of P2 is the **crossfade loop style**,
   which `docs/15 §S4b` gates. S4 was split into **S4a**
   (graph + unlock, ✅ passed → P2's audio graph is cleared) and **S4b**
   (crossfade trigger timing, 🟡 open → gates only the crossfade loop style),
   `docs/15 §S4`. S3 passed, so the importer's metadata path is cleared.

   Four P2 decisions are settled and should not be re-litigated:
   **crossfade deferred** (ship `singleLoopStyle: 'hard'`) · **the chime is
   synthesised with `OscillatorNode`s** — no `public/audio/`, no asset, closes
   the 🟡 audit finding (`docs/05 §7`) · **`crypto.randomUUID()` for track ids**,
   not nanoid (`docs/02 §2`) · **hardcoded VI** with keys filed in
   `docs/08 §3.1`.

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
3. **Spikes still open:** **S1** player half — embed-off, age-restricted, and a
   **region-blocked case that can only be confirmed from Vietnam**
   (`tests/manual/yt-matrix.md`); **S4b** overlap timing ±150 ms and the
   0/1/2/5 s sweep — and note the harness cannot produce a valid number until it
   is fixed (its overlap metric reads back its own scheduled `gain.value`, so it
   cannot fail; `docs/15 §S4`).
4. `docs/AUDIT-BACKLOG.md` — 23 open findings, 1 release blocker (generated
   third-party notices, `legal/THIRD-PARTY-NOTICES.md`). P2's S1 slice closed
   the chime-codec finding, both countdown-preset findings, and the two halves of
   the import-pipeline finding that P2 owns.

`test/` is a **local-only, git-ignored** ~651 MB audio corpus for spikes S3/S4.
Never commit it, never reference it from shipped code, never assume it exists in
CI. `scripts/guard-no-corpus.mjs` enforces this beyond `.gitignore`.
