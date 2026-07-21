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
  of the current digit color at decreasing alpha. Ghost segments: render "888:88:88"
  behind the live digits at 6% opacity (authentic LED look, also fixes width jitter).
- **Scanline overlay**: full-screen repeating-linear-gradient, 3% opacity, disabled
  by `prefers-reduced-motion` and toggleable in Settings.
- **Tally light**: 10 px dot, top-left next to the wordmark. Idle: `tt-muted`.
  Playing: `tt-danger`, pulsing to the beat (Analyser energy) in local modes;
  steady in YouTube mode. This is the beat-reactive element that survives even
  when the visualizer is off.
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
│ Z7 ─ Song Title — Artist ─ 03:12 / 06:40 ─ ▂▂▂▂▂▂▂▂▂▂▂▂▂──  │
└──────────────────────────────────────────────────────────────┘
```

| Zone | Content | Behavior |
|------|---------|----------|
| Z1 | Background stack per Settings | Crossfades 400 ms between slideshow images; scrim auto-raises if contrast sampling under digits < 4.5:1 |
| Z2 | Visualizer canvas | Styles: bars / wave / ring around the clock; hidden in YouTube mode (no audio data cross-origin) — replaced by blurred video thumbnail + slow animated gradient |
| Z3 | Countdown | `≥ 60 s`: `H:MM:SS`, 1 Hz aligned. `< 60 s`: `SS.mmm` via rAF, color → `tt-danger`. Format details in `04 §4` |
| Z4 | **Right rail — mode dependent** (below) | Collapsible (`]` hotkey); auto-collapses in Focus mode |
| Z5 | Tally light + wordmark | Always visible except Focus mode |
| Z6 | Settings ⚙, language, fullscreen | Icon buttons, 40 px hit area |
| Z7 | Bottom bar: Title — Artist — elapsed/duration + thin progress | **Auto-hide** after 4 s idle; reappears on mouse move/any key; transport controls (⏮ ⏯ ⏭ 🔊) fade in with it |

### Z4 right rail by mode

| Mode | Rail content |
|------|--------------|
| Single | Mode badge, loop counter ("Loop ×7"), loop-style toggle (hard / crossfade) |
| Playlist | Queue list: drag-to-reorder, now-playing highlight, per-row duration, right-click → context menu (`02 §8`), shuffle/repeat toggles, totals footer "12 tracks · 48:31 / 91:00" |
| YouTube | **Embedded player 384×216** (ToS ≥ 200×200, controls fully visible, nothing may overlap it) + queue list beneath + loop/shuffle toggles |

## 3. Screens inventory

1. **Landing** (`/`, `/en/`) — hero with looping demo capture (placeholder asset
   until core is done, per spec), feature grid, mode explainer, limits table, FAQ,
   legal links, "Open TickTune →" CTA. Static, indexable (07 §3).
2. **Legal Gate** — first run at `/app/`: blocking modal, summary of
   EULA/Disclaimer/Privacy + links to `/legal/*` and GitHub; single checkbox +
   Accept. Accept = autoplay-unlock gesture (`02 §1`). Re-shown if legal version
   bumps.
3. **Setup** — mode tabs (Playlist default), countdown input `H:MM:SS` + presets
   (5/10/15/25/30/45/60/90) + "Match queue length" button, drop zone / link
   textarea, live limits meter, Start.
4. **Player** — layout above.
5. **Finished** — "TIME'S UP" in DSEG14-style caps (rendered in UI font with glow),
   session summary (tracks played, duration), Restart / Back to setup.
6. **Error overlays** — YouTube typed overlays (`06 §4`), offline banner, import
   toasts.
7. **Mobile gate** — `07-MOBILE-GATE.md` full-screen block.
8. **404** — static Astro page, On Air styled ("Channel not found").

## 4. Focus mode

`F` toggles fullscreen; `H` toggles **Focus**: hides Z4–Z7, dims Z1 further,
countdown scales up ~20%. Any pointer/key shows a 3 s hint chip "H to exit focus".

## 5. Auto-theme (enhancement)

On track change (local): sample the embedded cover art via a 16×16 canvas
median-cut → derive one dominant hue → tint the gradient background and digit glow
(never the digit core color; legibility first). Toggle in Settings, default ON.
Skipped when no cover art or in YouTube mode (thumbnail hue used instead).

## 6. Settings (⚙ panel, grouped)

| Group | Controls |
|-------|----------|
| General | Language EN/VI · reopen legal pages · reset app (clears Dexie) |
| Display | Background: Solid / Gradient (6 presets + custom) / Image / Slideshow (multi-upload, interval 5–60 s, fade or Ken Burns) / Cover-art blur · scrim strength · scanlines on/off |
| Countdown | Glow intensity · size (S/M/L) · **End Behavior**: fade-out duration 0–5 s (default 2), chime on/off, flash screen, silence-only, auto-restart, loop countdown |
| Visualizer | Style bars/wave/ring · sensitivity · off |
| Audio | Volume · mute · crossfade 0–5 s (default 2) · single-mode loop style |
| Playback | Shuffle · Repeat playlist (default ON) · behavior when playlist ends early (silence / loop) · allow duplicates (default OFF) |
| Hotkeys | Read-only reference list |
| Diagnostics | Log viewer · Copy Diagnostics · clear log |
| About | Version, license, GitHub, third-party notices |

## 7. Hotkeys

`Space` play/pause · `←/→` prev/next · `↑/↓` volume ±5 · `M` mute · `F` fullscreen
· `H` focus mode · `S` settings · `]` toggle rail · `Esc` close modal/panel.
Disabled while typing in inputs.

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
