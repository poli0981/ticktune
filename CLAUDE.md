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
   GPL-compat license check + entry in `legal/THIRD-PARTY-NOTICES.md`.
8. **Security:** `{@html}` is banned; CSP in `docs/09 §4` is authoritative — any
   new origin requires updating CSP + privacy policy in the same PR.

## Conventions

- Components `Tt*.svelte`; TS modules kebab-case; state in `*.svelte.ts` runes
  stores; engines in `src/app/engine/**` are pure TS (no svelte imports).
- i18n keys `feature.element.state`, added to **both** `en.json` and `vi.json`
  (CI diff-guard fails otherwise). Log codes `TT-AAA-nnn`, registered in
  `docs/12 §6` before use.
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
(`docs/15 §Scope rule`). S1 gates P4 (YouTube) · S3 + S4 gate P2 (audio) ·
S2 measures the P1 timer engine directly, on the shipping countdown page under
`?ttdebug=1`, because S2's own method requires "the real `tt-timer` core".
P1 (scaffold, mobile gate, timer, countdown, settings/Dexie, log) touches no
spike-covered area except the timer. **No audio-engine, importer or YouTube code
before S1/S3/S4 pass.**

## Current status

P1 scope **complete (8/8)** as of 2026-07-21 — see the exit review in `docs/16`.
89 unit tests, 22 E2E, five gates green. The phase is not closed: S2 blocks P2.

🔴 **S2 failed, and its documented remedy failed too** (`docs/04 §2`). Hidden +
silent: `done` fired 2 m 57 s late. Control run with the keep-alive oscillator
**ON**: still **52.4 s late**, 105× the ±500 ms bound, again fired by the
visibility latch rather than the worker. Audibility does not protect the timer,
and the stall is in main-thread message processing — so no worker-side code
routes around it.

**Do not build a keep-alive source into the P2 audio engine.** It was tried and
withdrawn. P2 opens with a product decision instead — three options in
`docs/04 §2`; option 3 changes what the Finished screen says, so it must be
settled before the End Behavior is written.

The countdown is **correct but late** when hidden: derived time means the value
on return is exact, and the visibility/focus latch is the only reason it
finishes at all. Keep that latch whatever is decided.

Resolved: TypeScript pinned `~5.9` — TS 7 crashes svelte-check (`docs/11 §4`).
DSEG7 Classic tag confirmed **v0.46** stable (`docs/11 §2`). Island mount
mechanism measured — hand-mount wins (`docs/01 §3`).

Open items, in the order they block things:

1. **Decide the S2 question** (`docs/04 §2`) — the only thing between here and P2.
2. Cloudflare dashboard, all zone-side: disable **Web Analytics auto-injection**
   (it injects a beacon the CSP blocks — `docs/10 §10`), set **HSTS** to
   `max-age=15552000` (currently `max-age=0`, i.e. off), and disable **CodeQL
   Default setup** (`codeql.yml` is `startup_failure` until then).
3. Spikes still open: **S1** player half — embed-off, age-restricted,
   **region-blocked needs confirming from Vietnam** (`tests/manual/yt-matrix.md`);
   **S4** overlap-timing ±150 ms and the 0/1/2/5 s sweep (audible check passed
   by ear).
4. `docs/AUDIT-BACKLOG.md` — 26 open findings, 1 release blocker (generated
   third-party notices).

`test/` is a **local-only, git-ignored** ~651 MB audio corpus for spikes S3/S4.
Never commit it, never reference it from shipped code, never assume it exists in
CI. `scripts/guard-no-corpus.mjs` enforces this beyond `.gitignore`.
