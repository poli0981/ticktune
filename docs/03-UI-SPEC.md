# 03 — UI Spec · "On Air" Design System

Suite 1.0 · 2026-07-21

Goal (spec): modern, eye-catching, **not** generic. The identity is a late-night
broadcast studio: a glowing seven-segment clock on a dark stage, a pulsing tally
light, faint scanlines. Distinct from the portfolio's other systems (RepoLens
"phosphor terminal", poli0981.dev "Phòng đọc lúc nửa đêm").

## 1. Design tokens

```css
@theme {                       /* Tailwind 4 @theme, styles/global.css */
  --color-tt-void:    #08090C;  /* page background */
  --color-tt-surface: #10131A;  /* panels, rails */
  --color-tt-line:    #1D2330;  /* borders, dividers */
  --color-tt-signal:  #4FD1FF;  /* primary accent — signal cyan */
  --color-tt-warn:    #FFB454;  /* secondary accent, warnings */
  --color-tt-danger:  #FF5D5D;  /* countdown < 60 s, destructive */
  --color-tt-text:    #E7EBF2;
  --color-tt-muted:   #8A93A3;
  --font-digit: "DSEG7 Classic", "JetBrains Mono", monospace;
  --font-ui:    "Be Vietnam Pro", system-ui, sans-serif;
  --font-mono:  "JetBrains Mono", monospace;
}
```

- **Digit glow** (signature): layered `text-shadow: 0 0 8px, 0 0 24px, 0 0 64px`
  of the current digit color at decreasing alpha; the three alphas scale with
  `settings.glowIntensity` (`02 §3.1`).
- **Ghost segments**: the all-lit state rendered behind the live digits at 6%
  opacity (authentic LED look, and it is what removes width jitter). The ghost
  string is **derived from the active format, not hardcoded** — the formats in
  `04 §4` are 7, 5 and 6 glyphs wide, so a fixed `888:88:88` would be wrong for
  two of the three regimes and would reintroduce exactly the layout shift the
  ghost exists to prevent:

  | Regime (`04 §4`) | Live | Ghost |
  |------------------|------|-------|
  | ≥ 1 h | `1:24:07` | `8:88:88` |
  | 60 s – 1 h | `09:41` | `88:88` |
  | < 60 s | `42.183` | `88.888` |

  `tt-format.ts` exports the ghost pattern alongside the formatted value, so the
  two can never drift apart.
- **Scanline overlay**: full-screen repeating-linear-gradient, 3% opacity, disabled
  by `prefers-reduced-motion` and toggleable in Settings.
- **Tally light**: 10 px dot, top-left next to the wordmark. Idle: `tt-muted`.
  Playing: `tt-danger`, pulsing to the beat (Analyser energy) in local modes;
  steady in YouTube mode. This is the beat-reactive element that survives even
  when the visualizer is off. **The pulse ships with the visualizer in P5**
  (`05 §6`); P2 ships the two-state dot, steady in both states.
- Fonts are **self-hosted** (privacy §09): `@fontsource/be-vietnam-pro`,
  `@fontsource/jetbrains-mono`; DSEG7 Classic vendored in `public/fonts/dseg7/`
  with its OFL license file. DSEG covers digits + `:` `.` `-` only — exactly what
  the countdown needs; all prose uses `--font-ui` (full Vietnamese diacritics).

## 2. Layout zones — Player screen

```
┌──────────────────────────────────────────────────────────────┐
│ Z5 ● TickTune                                   ⚙ 文A ⤢  Z6 │
│                                                              │
│  Z1 background stack (full-bleed, bottom → top):             │
│     solid / gradient  →  image | slideshow (Ken Burns)       │
│     →  cover-art blur + dark scrim (adaptive 35–60%)         │
│     →  Z2 visualizer canvas (local modes only)               │
│                                                   ┌────────┐ │
│              Z3   1:24:07                         │  Z4    │ │
│              (DSEG7, clamp(96px, 18vw, 280px))    │ right  │ │
│              < 60 s → 42.183  in tt-danger        │ rail   │ │
│                                                   └────────┘ │
│ Z7 ─ Song Title — Artist ─ 3:12 / 6:40 ─ ▂▂▂▂▂▂▂▂▂▂▂▂▂▂──  │
└──────────────────────────────────────────────────────────────┘
```

| Zone | Content | Behavior |
|------|---------|----------|
| Z1 | Background stack per Settings | Crossfades 400 ms between slideshow images; scrim auto-raises if contrast sampling under digits < 4.5:1 |
| Z2 | Visualizer canvas | Styles: bars / wave / ring around the clock; hidden in YouTube mode (no audio data cross-origin) — replaced by blurred video thumbnail + slow animated gradient |
| Z3 | Countdown | Formats and update rates are **defined solely by `04 §4`** — not restated here. Below 60 s the digit color switches to `tt-danger` |
| Z4 | **Right rail — mode dependent** (below) | Collapsible (`]` hotkey); auto-collapses in Focus mode — **except in YouTube mode**, see the carve-out below |
| Z5 | Tally light + wordmark | Always visible except Focus mode |
| Z6 | Settings ⚙, language, fullscreen | Icon buttons, 40 px hit area |
| Z7 | Bottom bar: Title — Artist — elapsed/duration + thin progress | **Auto-hide** after 4 s idle; reappears on mouse move/any key; transport controls (⏮ ⏯ ⏭ 🔊) fade in with it. ⏮/⏭ are **disabled in Single mode** — there is nowhere to go |

**Z7 media position format:** `M:SS` below ten minutes, `MM:SS` at or above it —
minutes are not zero-padded. This is a **media position, not a countdown**:
`04 §4` owns countdown formats and nothing here restates them. (The diagram above
read `03:12` until P2, which contradicted the very rule it illustrates.)

**Z7 owns Stop (⏹) as well.** `02 §1`'s `playing/paused → setup` edge needs a
control and no chapter gave it one. It goes here rather than in a second row
beside the countdown, because a duplicate row would put two buttons with the
same accessible name on screen at once — an ambiguity for a screen reader, not
just for a test. Transport lives in one place.

### Z4 right rail by mode

| Mode | Rail content |
|------|--------------|
| Single | Mode badge, loop counter ("Loop ×7"), loop-style toggle (hard / crossfade), **now-playing card** |
| Playlist | Queue list: drag-to-reorder, now-playing highlight, per-row duration, right-click → context menu (`02 §8`), shuffle/repeat toggles, totals footer "12 tracks · 48:31 / 91:00" — see the fallback below |
| YouTube | **Embedded player 384×216** (ToS ≥ 200×200, controls fully visible, nothing may overlap it) + queue list beneath + loop/shuffle toggles |

The Single rail's **now-playing card** is the `contextmenu` target for the track
info modal (`02 §8`). It exists because that modal is P2 scope while the Playlist
queue rows that would otherwise host it are P3 — without it the modal would have
no trigger for a whole phase.

**Totals footer, when a duration is unknown.** The literal form above assumes
every track's `durationMs` is known, and one file with unreadable tags is enough
to break that across a 95-track queue. The elapsed half then renders `–` per the
standing numeric-fallback rule (`§3` item 3 / `02 §2`) — `"12 tracks · – / 91:00"`
— never a sum over the known subset, which would understate the total while
looking authoritative. The same condition already disables "Match queue length"
(`§3`), and that button must state **why** rather than merely appearing dead.

**"Loop ×N"** is the current playthrough index: ×1 on the first pass, incremented
on each wrap. Because `element.loop = true` emits no `ended` event, the wrap is
detected from a `currentTime` regression (`05 §2`), not from an event.

### ⚠️ YouTube visibility carve-out (ToS, non-negotiable)

`06 §1.2` and `CLAUDE.md` invariant 2 require the player to be **visible and
unobscured whenever a YouTube track is playing**. Two affordances in this chapter
would otherwise violate that — the `]` rail toggle (`§7`) and Focus mode (`§4`)
both hide Z4, which is where the player lives. Therefore, while
`mode === 'youtube'` **and** a video is loaded:

| Affordance | Behavior in YouTube mode |
|------------|--------------------------|
| `]` collapse rail | **Disabled.** The key is a no-op and the collapse control is not rendered; a 3 s hint chip explains why ("Player must stay visible — YouTube terms") |
| Focus mode (`H`) | Hides Z5–Z7 and dims Z1 as usual, but the **rail stays**, reduced to the player alone (queue list hidden). The countdown still scales up |
| Fullscreen (`F`) | Unaffected — the rail scales with the layout |
| Any overlay / modal | Must not cover the player rect. Typed YT error cards (`06 §4`) render *inside* the player area, which is the same rule |

This is enforced in the component, not left to layout discipline: the rail's
collapse state derives from `mode`, so no future CSS change can silently hide it.

## 3. Screens inventory

1. **Landing** (`/`, `/en/`) — hero with looping demo capture (placeholder asset
   until core is done, per spec), feature grid, mode explainer, limits table, FAQ,
   legal links, "Open TickTune →" CTA. Static, indexable (07 §3).
2. **Legal Gate** — first run at `/app/`: blocking modal, summary of
   EULA/Disclaimer/Privacy + links to `/legal/*` and GitHub; single checkbox +
   Accept. Accept = autoplay-unlock gesture (`02 §1`). Re-shown if legal version
   bumps.
3. **Setup** — mode tabs (Playlist default), countdown input `H:MM:SS` + presets
   **in minutes** (5/10/15/25/30/45/60/90) + "Match queue length" button, drop
   zone / link textarea, live limits meter, Start.

   **"Match queue length"** sets the countdown to
   `clamp(ceil(Σ durationMs / 1000) · 1000, 1 s, 24 h)`. It is **disabled** when
   the queue is empty, when any queued track's `durationMs` is `null`, and in
   YouTube mode (where durations stay `null` until player backfill, `06 §5`).
   It is **one-shot**: it does not re-compute when the queue changes afterwards,
   because a user who then edits the countdown by hand must not have that
   silently overwritten.

   **Mode tabs.** All three render. **P3 unlocked Playlist**; YouTube stays
   `aria-disabled` with a "P4" hint. `lastMode` is written only when the user
   picks an **enabled** tab — which is why a profile carrying the
   `TT_DEFAULT_SETTINGS.lastMode = 'playlist'` default (`02 §3.1`) survived P2
   with its real preference intact and P3 only had to unlock a tab rather than
   repair a value P2 had clobbered.

   **Switching mode with a queue already staged does not touch the queue.**
   Playlist → Single with more than one track leaves every track in place and
   simply disables Start with its reason shown, because `02 §1` makes readiness a
   predicate: a queue that stops being valid re-disables the button and nothing
   else. Truncating to the first track would silently discard user work, and
   blocking the tab would strand someone mid-decision.
4. **Player** — layout above.
5. **Finished** — "TIME'S UP" in DSEG14-style caps (rendered in UI font with glow),
   session summary (tracks played, duration), Restart / Back to setup.

   **Late variant (`04 §2`, decided 2026-07-21).** When `overshootMs` exceeds
   `LATE_THRESHOLD_MS` (2 s) the screen must **not** imply the moment is now. It
   states when zero was actually reached and how long ago:

   > **HẾT GIỜ** · *lúc 14:32 — 2 phút 57 giây trước*

   **This chapter owns that wording.** `04 §2` item 1 quotes a paraphrase and
   defers here; the two disagreed on lead-in and separator until P2, and a UI
   string belongs in the UI spec.

   The countdown itself still holds `0.000` (`04 §4`). Below the threshold the
   normal screen renders unchanged, so the common case is untouched.

   The trigger is **`overshootMs > LATE_THRESHOLD_MS` alone** — never the `late`
   flag on the timer's `done` payload. They are different questions: `late` means
   the visibility/focus latch fired the event rather than the worker, which
   routinely happens with a sub-second overshoot on a tab the user simply clicked
   back to. Keying the screen on it would announce a discrepancy that does not
   exist.

   The relative phrase ("2 phút 57 giây trước") recomputes at 1 Hz from the
   stored zero instant — derived, never accumulated (`04 §1`) — so it does not
   go stale while the user reads it. The absolute clock time is the primary
   element; the relative phrase supports it.

   This exists because a backgrounded tab can be throttled for minutes: the
   elapsed time stays exact, but the app cannot react until the user returns. A
   screen that just said "TIME'S UP" would be quietly lying about *when*.
6. **Error overlays** — YouTube typed overlays (`06 §4`), offline banner, import
   toasts.
7. **Mobile gate** — `07-MOBILE-GATE.md` full-screen block.
8. **404** — static Astro page, On Air styled ("Channel not found").

## 4. Focus mode

`F` toggles fullscreen; `H` toggles **Focus**: hides Z4–Z7, dims Z1 further,
countdown scales up ~20%. Any pointer/key shows a 3 s hint chip "H to exit focus".

**In YouTube mode, Focus keeps the player visible** — Z4 is reduced to the player
alone rather than hidden. See the YouTube visibility carve-out in `§2`; it is a
ToS requirement (`06 §1.2`), not a preference.

## 5. Auto-theme (enhancement)

On track change (local): sample the embedded cover art via a 16×16 canvas
median-cut → derive one dominant hue → tint the gradient background and digit glow
(never the digit core color; legibility first). Toggle in Settings, default ON.
Skipped when no cover art or in YouTube mode (thumbnail hue used instead).

## 6. Settings (⚙ panel, grouped)

This table is the **UI grouping only**. Field names, types, ranges and defaults
live in `02 §3.1` (`TtSettings` / `TT_DEFAULT_SETTINGS`) — the single source of
truth. Do not restate a default here; it will drift.

| Group | Controls | `TtSettings` fields |
|-------|----------|---------------------|
| General | Language EN/VI · reopen legal pages · reset app (clears Dexie) | `lang` |
| Display | Background: Solid / Gradient (6 presets + custom) / Image / Slideshow (multi-upload, interval, fade or Ken Burns) / Cover-art blur · scrim strength · scanlines | `background`, `gradientPreset`, `gradientCustom`, `slideshowIntervalMs`, `slideshowTransition`, `scrimStrength`, `scrimAuto`, `scanlines`, `autoTheme` |
| Countdown | Glow intensity · size (S/M/L) · **End Behavior**: fade-out duration, chime, flash, and what happens at zero (stay / restart / loop — see `02 §3.3`) | `glowIntensity`, `countdownSize`, `endFadeMs`, `endChime`, `endFlash`, `endAction` |
| Visualizer | Style off/bars/wave/ring · sensitivity | `visualizer`, `visualizerSensitivity` |
| Audio | Volume · mute · crossfade · single-mode loop style | `volume`, `muted`, `crossfadeMs`, `singleLoopStyle` |
| Playback | Shuffle · Repeat playlist · allow duplicates | `shuffle`, `repeatPlaylist`, `allowDuplicates` |
| Hotkeys | Read-only reference list | — |
| Diagnostics | Log viewer · Copy Diagnostics · clear log | — |
| About | Version, license, GitHub, third-party notices | — |

**`endFlash`, defined.** The setting existed in `02 §3.1` with no visual
specified anywhere, which is how a shipped affordance gets invented at
implementation time. It is: **two 120 ms opacity pulses of `tt-signal` over Z1,
peaking at 20% opacity, 400 ms in total**, fired at zero alongside the chime. It
never touches the digits — Z3 holds `0.000` (`04 §4`) — and it is **suppressed
entirely** under `prefers-reduced-motion` (`§8`), where it is decoration, not
content. Default OFF (`02 §3.1`).

Two controls listed in earlier revisions are gone, not forgotten:
**"behavior when playlist ends early (silence / loop)"** was redundant with
`repeatPlaylist`, and **"silence-only"** was redundant with
`endChime: false` + `endFadeMs: 0`. Both resolutions are in `02 §3.3`.

## 7. Hotkeys

`Space` play/pause · `←/→` prev/next · `↑/↓` volume ±5 · `M` mute · `F` fullscreen
· `H` focus mode · `S` settings · `]` toggle rail · `Esc` close modal/panel.
Disabled while typing in inputs.

**`Alt+↑` / `Alt+↓` move the focused queue row** up or down one position — the
keyboard equivalent of a drag, and the binding `13 §6`'s keyboard-only journey
targets. It is `Alt`-modified because bare `↑/↓` are already volume, and it is
specified here rather than left to the drag implementation because `02 §5.1`
exists precisely to stop the first implementation becoming the spec. The same two
moves appear in the row's context menu (`02 §8`), so the affordance is reachable
without knowing the hotkey.

`]` is a **no-op in YouTube mode** while a video is loaded — the rail holds the
player and the player may never be hidden (`§2` carve-out, `06 §1.2`).

## 8. Motion & accessibility

- Duration tokens 150/250/400 ms; ease `cubic-bezier(.2,.8,.2,1)`. Digits do **not**
  animate per tick (LED authenticity); state changes use opacity/scale only.
- `prefers-reduced-motion`: disables Ken Burns, scanlines, visualizer, tally pulse,
  Motion-driven effects — countdown still updates (content, not decoration).
- Contrast: all text ≥ 4.5:1 against effective background (scrim guarantees it);
  `tt-muted` used only ≥ 14 px.
- Countdown `aria-live`: **off** for per-second ticks (screen-reader spam);
  polite announcements at 10 min / 5 min / 1 min / 10 s / zero.
- Full keyboard support: queue rows focusable, context-menu equivalent via `Menu`
  key / `Shift+F10`, visible focus ring (`tt-signal`, 2 px offset).
- Language of parts: `lang` attribute switches with i18n so screen readers use the
  right voice.
