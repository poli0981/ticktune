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
| Metadata mapping | tag→TtTrack mapping; `N/A`/`–` fallback rules; U+FFFD mojibake fallback (TT-IMP-007) |
| Log | ring-buffer wrap at 500; level filter; diagnostics payload shape |
| Crossfade math | equal-power curve endpoints/midpoint; trigger scheduling margins |
| i18n guard | `en.json` vs `vi.json` key-set diff = ∅ (build-failing) |

Coverage target: **≥ 85% lines on `src/app/engine/**`** (enforced), no global
vanity target elsewhere.

## 2. Component (Vitest + @testing-library/svelte + happy-dom, `tests/component/`)

TtCountdown (format/color regimes via injected state) · TtQueuePanel (reorder,
context menu opens, totals footer) · TtSetup (limits meter, preset buttons,
Match-queue-length) · TtSettings (End Behavior controls persist calls) ·
TtOverlay (typed variants render correct i18n keys) · TtLegalGate (Accept enables
only with checkbox).

## 3. E2E (Playwright, `tests/e2e/`)

Fixtures: `scripts/make-fixtures.ts` generates three ~5 s tones (mp3/flac/opus) +
one 11-min silent mp3 (for TT-IMP-002) — committed, tiny, self-made (no rights
issues).

| Flow | Assertions |
|------|------------|
| Gate → Setup → Single | accept unlocks; fixture plays; loop counter increments; countdown reaches <60 s regime (short timer) and shows `SS.mmm`; Finished screen; chime request observed |
| Playlist limits | 11-min file rejected with toast; duplicate skipped; totals footer math |
| Hotkeys | Space/M/F/H/] behave; disabled while typing |
| i18n | toggle EN↔VI swaps visible strings without reload |
| Mobile gate (`07 §6`) | mobile project: overlay visible, **no app-bundle request** in network log; desktop project: island mounts |
| Offline | context.setOffline → banner; YT mode blocked panel |
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
- [ ] Single mode with a real MP3: plays, countdown accurate vs phone stopwatch over 10 min (±1 s)
- [ ] Playlist: 3 files, shuffle + repeat, right-click info modal fields
- [ ] YouTube: 2 links play sequentially in visible player; one dead link → gone-overlay
- [ ] `<60 s` ms display smooth; Finished + chime fires with tab hidden
- [ ] Headers/CSP live (`10 §11`), `/api` 429 after burst
- [ ] Real Android phone + touch-only iPad: gate shows, no bundle download
- [ ] Copy Diagnostics → paste parses as JSON
