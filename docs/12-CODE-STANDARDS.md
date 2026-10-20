# 12 — Code Standards

Suite 2.0 · 2026-10-21

## 1. Naming

- Components: `Tt` prefix, PascalCase — `TtCountdown.svelte`, `TtQueuePanel.svelte`.
- TS modules: kebab-case — `tt-timer.ts`, `tt-yt-cause.ts`.
- Runes stores: `*.svelte.ts` in `src/app/state/` — export a single object
  (`session`, `settings`, `playback`, `yt`, `backdrop`, `i18n`).
- CSS custom props/tokens: `--color-tt-*`, `--font-*` only via Tailwind `@theme`.
- i18n keys: `feature.element.state` (`08 §3`). Log codes: `TT-AAA-nnn` (§6).
- Branches: `feat/*`, `fix/*`, `docs/*`, `chore/*`, `spike/*`.

## 2. TypeScript

`strict: true` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `verbatimModuleSyntax`. No `any` (lint error) — `unknown` +
narrowing. An engine's shared types live in its `types.ts`; a module may
export the types of its own API beside it (`tt-chime.ts`, `tt-dominant-hue.ts`),
and an engine with no shared types (`queue/`, `visuals/`) has no `types.ts`.

## 3. Architecture rules (enforced by review + lint where possible)

1. `src/app/engine/**` imports nothing from `svelte` or `src/app/components` —
   engines stay pure (ESLint `no-restricted-imports` zone rule).
2. Components never touch `AudioContext`/`Worker`/`YT.Player` directly — only via
   engine facades through state.
3. One-way data: components → actions on state → engines → events → state →
   components.
4. No default exports except Astro pages and the Worker, whose runtime
   requires `export default { fetch }` (`worker/index.ts`). Named exports
   everywhere else.

## 4. Banned patterns (lint-enforced)

| Pattern | Rule/why |
|---------|----------|
| `{@html …}` | `svelte/no-at-html-tags` — untrusted titles, `09 §5` |
| `eval` / `new Function` | CSP + `no-eval` |
| `setInterval` accumulation for time | grep-guard in review; time is derived (`04 §1`) |
| `localStorage` for structured data | Dexie only (settings schema versioned) |
| Direct `fetch` to youtube.com from client | oEmbed goes through `/api` (`06 §3`) |
| `console.log` in committed code | `no-console` (allow `warn`/`error` for the browser console). ⚠️ Console output does **not** reach the diagnostics buffer — global capture hooks only `error`/`unhandledrejection`. Anything a bug report needs goes through `ttLog` with a registered code; the timer's codes were console-only until v1.1 |

## 5. Quality gates (all must pass locally & in CI)

```bash
pnpm lint        # eslint 10 flat config + eslint-plugin-svelte + prettier check
pnpm check       # astro check + svelte-check + the Worker's own tsc program
pnpm knip        # unused files/exports/deps — FAILS the build (spec requirement)
pnpm test        # vitest
pnpm test:e2e    # playwright — CI runs all five projects on every PR (13 §3)
```

knip config lives in `knip.json`; false positives are fixed or explicitly
annotated with a comment justifying the ignore — never blanket-ignored.

## 6. Log code registry (single source of truth)

| Code | Meaning |
|------|---------|
| TT-IMP-001 | Rejected: unsupported format / canPlayType negative |
| TT-IMP-002 | Rejected: track > 10:02 |
| TT-IMP-003 | Rejected: playlist total would exceed 91:00 |
| TT-IMP-004 | Rejected: the mode's queue count cap would be exceeded (Single 1 / Playlist 95) |
| TT-IMP-005 | Skipped: duplicate (local key or videoId) |
| TT-IMP-006 | Metadata parse failed — imported with file-name title |
| TT-IMP-007 | Tag mojibake detected — file-name fallback |
| TT-IMP-008 | Rejected: dropped entry count exceeded the pre-scan cap (`02 §4` step 0) |
| TT-IMG-001 | Background picker: entry rejected, not an image |
| TT-IMG-002 | Background picker: entries dropped, over the `TT_MAX_BACKGROUND_IMAGES` cap (`03 §6`) |
| TT-PLY-100 | Playback blocked by the autoplay policy — awaiting a user gesture |
| TT-PLY-101 | Playback error on local track — skipped/removed |
| TT-PLY-102 | Playlist exhausted before countdown (repeat off) |
| TT-PLY-103 | End-behavior chime could not be scheduled (AudioContext not running) |
| TT-PLY-105 | `AudioContext.resume()` did not complete — no usable audio output; playback continues unreported rather than hanging |
| TT-PLY-106 | No crossfade for this track: its length is unknown, or too short to fade — a hard cut at `ended` instead (`05 §2`). Once per track. Registered v2.0 |
| TT-PLY-108 | The incoming track of a crossfade did not start — the outgoing one plays out and `ended` advances, once (`05 §2`). `NotAllowedError` reports TT-PLY-100 instead. Registered v2.0 |
| TT-USR-001 | Track removed by user |
| TT-USR-100 | Legal gate accepted (records the version) |
| TT-USR-101 | Settings reset to defaults by the user — the Dexie row is deleted, so `legalAccepted` goes with it and the gate re-blocks at next boot (`03 §6`) |
| TT-USR-102 | Finish notifications turned on or off by the user (`04 §2`). Turning them on asks the browser in the same click; a refusal leaves them off and the panel says why. v2.0 |
| TT-USR-103 | Settings exported to a file (`02 §3.4`). v2.0 |
| TT-USR-104 | Settings imported from a file — clamped like a stored row; `legalAccepted` kept as it was (`02 §3.4`). v2.0 |
| TT-USR-105 | A settings file was refused — message `unreadable` (not JSON) or `not-ours` (not a TickTune settings file); nothing changed (`02 §3.4`). v2.0 |
| TT-YT-001 | oEmbed pre-check network failure — kept pending |
| TT-YT-002 | Invalid YouTube URL / bad parameter |
| TT-YT-003 | Rejected: link count would exceed 50 |
| TT-YT-004 | oEmbed failed for a status nobody has classified — the honest bucket, so an unmeasured failure cannot borrow a confident wrong label from TT-YT-100 |
| TT-YT-005 | Player HTML5 error — skipped after 5 s like every player error (`06 §4`) |
| TT-YT-006 | A `pending` track was re-checked on Start and now resolves — promoted to `ok`, metadata filled (`02 §1`, `06 §8`) |
| TT-YT-007 | A `pending` track was re-checked on Start and the cause is now a property of the video — marked `error` and dropped from the order (`02 §6`) |
| TT-YT-008 | Link lengths unavailable from `/api/yt/durations` — no key on this deployment, quota spent, edge unreachable or rate-limited. Info: lengths stay `–` until the player backfills them (`06 §3`) |
| TT-YT-100 | Video unavailable (deleted/private) |
| TT-YT-101 / 150 | Embedding blocked (embed-off / age / region) |
| TT-SYS-201 | Wall-clock drift > 2 s re-anchored |
| TT-SYS-202 | Wake Lock unavailable/denied |
| TT-SYS-203 | Zero crossed during sleep — late finish fired |
| TT-SYS-204 | Settings row unreadable/corrupt — reset to defaults (`02 §3.2`) |
| TT-SYS-205 | **Retired in v2.0.** A stored setting named a capability the build did not ship and fell back (`singleLoopStyle: 'crossfade'` → `hard` while `15 §S4b` was open). S4b passed; nothing emits it. Kept so an old diagnostics paste still reads |
| TT-SYS-206 | Audio unlock failed at the gesture — playback will retry on Start (`05 §1`). Registered P7 slice B, when desktop WebKit found that a browser with no `AudioContext` trapped the user at the Legal Gate forever: `acceptLegal` called `unlock()` **before** recording consent, and a synchronous throw skipped the rest. Consent must never depend on the audio stack |
| TT-SYS-207 | The timer worker could not start or raised `error` — a main-thread interval took over the authoritative tick (`04 §2`). Registered v1.1: the worker was created lazily at the first Start, so a tab opened before a redeploy requested a chunk that no longer existed and, with no `error` listener, never reached `done` while visible |
| TT-SYS-208 | The timer worker reported `done` while the core still had time left and no re-anchor explained it — the deadline was re-sent (at most once a second, logged once per run; `04 §1`). Registered v1.1.1, beside the fix it backs up: a TT-SYS-201 re-anchor never reached the worker, whose stale deadline hit zero early, so a visible tab sat at 0.000 |
| TT-SYS-209 | The finish notification was shown by the PAGE, not the timer worker — this browser's workers have no `Notification` (Safari) or the worker is down (TT-SYS-207). Best-effort: the page may itself run late while hidden. Message: `shown by the page` / `could not be shown`. v2.0 |
| TT-SYS-210 | Finish notifications are on but the browser no longer allows them (permission denied or reset) — none is shown until it is allowed again. Once per session. v2.0 |
| TT-SYS-211 | The service worker could not be registered — the app works, but will not start offline (`10 §9`). Message: the error's name only. Registered v2.0 |
| TT-SYS-300 | Captured `window.onerror` (error **name** only — never its message, see the rule below) |
| TT-SYS-301 | Captured `unhandledrejection` (reason **type** only) |

New codes are added here first, then used in code (review checks the reverse).

TT-IMP-004 was worded "playlist count would exceed 95" until P2. Single mode has
a count cap too — exactly one track (`02 §1`) — and reusing a playlist-scoped
code for it without saying so here would be the code-before-registration
violation this section exists to prevent. The cap value stays per-mode; only the
code's scope widened.

**`TT-IMG-*` is a new family, not a widening of `TT-IMP-*`** (P5 slice 3). The
background picker rejects for the same two *shapes* of reason as the audio
importer — wrong type, over a cap — and it was briefly written using
TT-IMP-001/004 for exactly that reason. That is the violation above wearing a
convincing disguise: `TT-IMP-*` means the `02 §4` audio pipeline, whose codes
appear in the import summary toast keyed by code (`08 §3.1`), so a background
rejection would have surfaced as "Format not supported" in a toast about music.
Different pipeline, different family.

**Message content rule.** A log `message` carries its code plus non-identifying
context only — never a raw file name, tag value, track title, or any other user
string. `trackId` is an opaque generated id (`crypto.randomUUID`, `02 §2`) and is
safe; blob URLs are opaque UUIDs and are safe. This is what makes the bug template's "contains no personal files — feel
free to review it" assurance (`.github/ISSUE_TEMPLATE/bug_report.yml`) true by
construction rather than by diligence, and it is free if applied from the first
log call.

## 7. Commits & PRs

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `spike:`).
The PR checklist lives in `CONTRIBUTING.md` (there is no PR template): gates
pass, i18n keys in **both** dictionaries, log codes registered, licence and
notices for a new dependency, CSP + Privacy Policy for a new origin,
`TT_LEGAL_VERSION` for a legal change, docs updated if behaviour changed,
screenshots for UI PRs.

## 8. Formatting

Prettier owns style (no ESLint stylistic rules): 2-space, single quotes, 100-col,
`prettier-plugin-svelte` + `prettier-plugin-tailwindcss` (class sorting).
`.editorconfig` mirrors the basics.
