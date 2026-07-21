# 12 — Code Standards

Suite 1.0 · 2026-07-21

## 1. Naming

- Components: `Tt` prefix, PascalCase — `TtCountdown.svelte`, `TtQueuePanel.svelte`.
- TS modules: kebab-case — `tt-timer.ts`, `yt-error-map.ts`.
- Runes stores: `*.svelte.ts` in `src/app/state/` — export a single object
  (`session`, `settings`, `playback`).
- CSS custom props/tokens: `--color-tt-*`, `--font-*` only via Tailwind `@theme`.
- i18n keys: `feature.element.state` (`08 §3`). Log codes: `TT-AAA-nnn` (§6).
- Branches: `feat/*`, `fix/*`, `docs/*`, `chore/*`, `spike/*`.

## 2. TypeScript

`strict: true` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `verbatimModuleSyntax`. No `any` (lint error) — `unknown` +
narrowing. Engines export types from a single `types.ts` per engine.

## 3. Architecture rules (enforced by review + lint where possible)

1. `src/app/engine/**` imports nothing from `svelte` or `src/app/components` —
   engines stay pure (ESLint `no-restricted-imports` zone rule).
2. Components never touch `AudioContext`/`Worker`/`YT.Player` directly — only via
   engine facades through state.
3. One-way data: components → actions on state → engines → events → state →
   components.
4. No default exports except Astro pages. Named exports everywhere else.

## 4. Banned patterns (lint-enforced)

| Pattern | Rule/why |
|---------|----------|
| `{@html …}` | `svelte/no-at-html-tags` — untrusted titles, `09 §5` |
| `eval` / `new Function` | CSP + `no-eval` |
| `setInterval` accumulation for time | grep-guard in review; time is derived (`04 §1`) |
| `localStorage` for structured data | Dexie only (settings schema versioned) |
| Direct `fetch` to youtube.com from client | oEmbed goes through `/api` (`06 §3`) |
| `console.log` in committed code | `no-console` (allow `warn`/`error`, which also feed the diagnostics buffer) |

## 5. Quality gates (all must pass locally & in CI)

```bash
pnpm lint        # eslint 10 flat config + eslint-plugin-svelte + prettier check
pnpm check       # astro check + svelte-check (TS in templates)
pnpm knip        # unused files/exports/deps — FAILS the build (spec requirement)
pnpm test        # vitest
pnpm test:e2e    # playwright (CI: chromium+firefox; full matrix pre-release)
```

knip config lives in `knip.json`; false positives are fixed or explicitly
annotated with a comment justifying the ignore — never blanket-ignored.

## 6. Log code registry (single source of truth)

| Code | Meaning |
|------|---------|
| TT-IMP-001 | Rejected: unsupported format / canPlayType negative |
| TT-IMP-002 | Rejected: track > 10:02 |
| TT-IMP-003 | Rejected: playlist total would exceed 91:00 |
| TT-IMP-004 | Rejected: playlist count would exceed 95 |
| TT-IMP-005 | Skipped: duplicate (local key or videoId) |
| TT-IMP-006 | Metadata parse failed — imported with file-name title |
| TT-IMP-007 | Tag mojibake detected — file-name fallback |
| TT-PLY-101 | Playback error on local track — skipped/removed |
| TT-PLY-102 | Playlist exhausted before countdown (repeat off) |
| TT-USR-001 | Track removed by user |
| TT-YT-001 | oEmbed pre-check network failure — kept pending |
| TT-YT-002 | Invalid YouTube URL / bad parameter |
| TT-YT-003 | Rejected: link count would exceed 50 |
| TT-YT-005 | Player HTML5 error — retried/skipped |
| TT-YT-100 | Video unavailable (deleted/private) |
| TT-YT-101 / 150 | Embedding blocked (embed-off / age / region) |
| TT-SYS-201 | Wall-clock drift > 2 s re-anchored |
| TT-SYS-202 | Wake Lock unavailable/denied |
| TT-SYS-203 | Zero crossed during sleep — late finish fired |
| TT-SYS-204 | Settings row unreadable/corrupt — reset to defaults (`02 §3.2`) |
| TT-SYS-3xx | Captured window.onerror / unhandledrejection |

New codes are added here first, then used in code (review checks the reverse).

**Message content rule.** A log `message` carries its code plus non-identifying
context only — never a raw file name, tag value, track title, or any other user
string. `trackId` is a nanoid and is safe; blob URLs are opaque UUIDs and are
safe. This is what makes the bug template's "contains no personal files — feel
free to review it" assurance (`.github/ISSUE_TEMPLATE/bug_report.yml`) true by
construction rather than by diligence, and it is free if applied from the first
log call.

## 7. Commits & PRs

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `spike:`).
PR template checklist: gates pass, i18n keys added to **both** dictionaries,
log codes registered, docs updated if behavior changed, screenshots for UI PRs.

## 8. Formatting

Prettier owns style (no ESLint stylistic rules): 2-space, single quotes, 100-col,
`prettier-plugin-svelte` + `prettier-plugin-tailwindcss` (class sorting).
`.editorconfig` mirrors the basics.
