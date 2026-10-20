# 03 — UI Spec · "Rack Unit" Design System

Suite 1.1 · 2026-10-20

Goal (spec): modern, eye-catching, **not** generic. The identity is a piece of
broadcast studio hardware: a rack-mounted seven-segment clock behind smoked
glass, an ON AIR tally lamp that pulses to the music, engraved panel labels,
keycaps and LED switches. Warm graphite, amber indicators, warm-white digits —
distinct from the portfolio's other systems (RepoLens "phosphor terminal",
poli0981.dev "Phòng đọc lúc nửa đêm"), which is why the digits are **not** amber
or green.

v1.1 replaced the v1.0 "On Air" palette (near-black, cyan signal) wholesale.
Token **names** were kept, so every `var(--color-tt-*)` reader kept working and
the redesign changed values, not call sites.

## 1. Design tokens

`src/styles/global.css` is the implementation; this block is the contract.

```css
@theme {                          /* Tailwind 4 @theme */
  --color-tt-void:      #0E0D0B;  /* chassis — page background */
  --color-tt-surface:   #171512;  /* panels, rails, sheets */
  --color-tt-surface-2: #1F1C18;  /* raised: keycaps, hover */
  --color-tt-line:      #2E2A24;  /* decorative seams and dividers only */
  --color-tt-outline:   #746A5C;  /* interactive boundaries — ≥ 3:1 */
  --color-tt-signal:    #FFB23F;  /* amber: LEDs, active, focus, primary */
  --color-tt-on-signal: #1A1206;  /* text on an amber fill */
  --color-tt-digit:     #F5EEDC;  /* the countdown's lit segments */
  --color-tt-warn:      #FF7A1A;  /* warnings, late finish */
  --color-tt-danger:    #FF3B30;  /* tally lamp, < 60 s, destructive */
  --color-tt-text:      #EDE6DA;  /* ink */
  --color-tt-muted:     #A39B8E;  /* engraved labels, secondary text */
  --font-digit:   "DSEG7 Classic", "JetBrains Mono", monospace;
  --font-display: "Chakra Petch", "Be Vietnam Pro", system-ui, sans-serif;
  --font-ui:      "Be Vietnam Pro", system-ui, sans-serif;
  --font-mono:    "JetBrains Mono", monospace;
}
```

**Contrast, measured** (WCAG relative luminance, worst surface of the three):
text 13.7 · digit 14.7 · signal 9.4 · warn 6.5 · muted 6.2 · danger 4.78 —
every text colour clears 4.5:1 on chassis, panel **and** keycap, so no colour
carries a "large text only" footnote. `outline` is 3.2:1 at worst: the WCAG
1.4.11 boundary for controls. `line` is decorative and never the only edge of
something clickable. Amber on its own fill (`on-signal`) is 10.3:1.

### The light theme — the same rack in LCD dress (v2.0)

`theme: 'light'` (`02 §3.1`) overrides every colour token under
`html[data-tt-theme='light']`, which only the `/app/` island sets — the landing
and the legal pages stay dark. The dark theme is an LED display: lit segments
behind smoked glass. The light one is an LCD: **dark segments on a reflective
panel**, so the digits lose their glow, the unlit segments stay faintly visible
(the ghost at 8 % instead of 6 %), and the display window is the same panel
recessed rather than tinted glass.

```css
html[data-tt-theme='light'] {
  --color-tt-void: #E8E4DA;  --color-tt-surface: #F4F1EA;  --color-tt-surface-2: #FBF9F4;
  --color-tt-line: #CDC6B8;  --color-tt-outline: #857B6C;  --color-tt-signal: #8F5200;
  --color-tt-on-signal: #FFFFFF;  --color-tt-digit: #1D1F1A;  --color-tt-warn: #A84800;
  --color-tt-danger: #B8241A;  --color-tt-text: #1C1A16;  --color-tt-muted: #5D564B;
}
```

The same rule as the dark palette, re-measured: every text colour holds 4.5:1
on chassis, panel and keycap (worst: warn 4.61, signal 4.90, danger 5.00),
`outline` 3.28:1, white on amber 6.22:1. Z1 follows: six pale presets mirror
the six dark ones (`TT_GRADIENT_PRESETS_LIGHT`), and the scrim turns **white**,
solved by `scrimForLight` — in sRGB, because a white scrim composited on gamma
values lifts less than linear arithmetic promises; the linear shortcut would
have stopped at 0.24 over black, where 4.5:1 needs 0.53.

### The clock face — DSEG7 or DSEG14 (v2.0)

`clockFace` picks DSEG7 Classic or DSEG14 Classic, the same family, release and
licence (`public/fonts/dseg14/PROVENANCE.md`). DSEG14 was measured before it was
offered: `8:88:88` at 4.48 × font-size and `88.888` at 4.08 ×, exactly DSEG7's
widths, so `§4`'s cap holds for both faces unchanged. Its all-segments glyph is
`~`, so the ghost maps `8 → ~` for it.

⚠️ **The JS copies.** The scrim's contrast maths, the visualizer's fallback
colour and the gradient presets need numbers, not `var()`s. They read
`src/lib/tt-palette.ts`, and `tests/unit/tt-palette.test.ts` parses the `@theme`
block and fails if the two disagree — a palette change made in CSS alone used to
leave the scrim protecting digits of a colour that no longer existed. Since
v2.0 it parses the light override against `TT_PALETTE_LIGHT` too, and fails if
any dark colour token has no light counterpart.

**Scales** (on `:root`, read through `var()` in scoped CSS):

| Scale | Values |
|-------|--------|
| Space (`--tt-space-1…9`) | 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 px |
| Radius (`--tt-radius-*`) | xs 2 · sm 4 · md 8 · lg 14 · pill — hardware is mostly square |
| Type (`--tt-text-*`) | 12 · 14 · 16 · 18 · 22 · 28 · 36 · 48 · 72 px — **UI text never below 12 px** |
| Stacking (`--tt-z-*`) | backdrop 0 · main 1 · chrome 10 · bar 20 · hint 30 · flash 40 · sheet 50 · popover 60 · modal 70 · debug 80 · gate 90 · mobile-gate 100 |

One named stacking scale replaced a dozen ad-hoc numbers. Everything from
`chrome` to `gate` lives inside `.tt-main`'s stacking context; only the backdrop
and the visualizer sit outside it, below.

**Primitives** — one implementation of each control, in `@layer components`, so
the Astro pages and the Svelte island share them:

| Class | What it is |
|-------|------------|
| `.tt-key` (+ `-primary` `-ghost` `-danger` `-icon` `-sm`) | The keycap. 40 px tall (32 px small), presses 1 px on `:active`; `aria-pressed="true"` lights it |
| `.tt-led` | A 6 px lamp inside a key; lit by the key's `aria-pressed`, or by `data-on="true"` |
| `.tt-seg` | A strip of joined keys for one-of-many; reads `aria-pressed`/`aria-selected` on its buttons |
| `.tt-switch` | `<input type="checkbox">` drawn as a hardware toggle — still a checkbox to assistive tech |
| `.tt-fader` | `<input type="range">` drawn as a mixing-desk fader, always paired with `.tt-readout` |
| `.tt-panel` · `.tt-label` · `.tt-field` | The inset module, the engraved small-caps label, the recessed input |

⚠️ Svelte's scoped CSS is **unlayered**, so it beats anything in
`@layer components`. A component adopting a primitive must drop its own
competing rules for that element, or the primitive silently loses.

- **Digit glow** (signature): layered `text-shadow: 0 0 8px, 0 0 24px, 0 0 64px`
  of the current digit color at decreasing alpha; the three alphas scale with
  `settings.glowIntensity` (`02 §3.1`).
- **The display window**: smoked glass behind the segments — a `::before` on the
  countdown, so it adds nothing to the box `§4`'s size cap measures and bleeds
  only 0.08em a side. The arithmetic that keeps it off the YouTube player is in
  `§4`.
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
- **Scanline overlay**: full-screen repeating-linear-gradient of warm white, 3%
  opacity, disabled by `prefers-reduced-motion` and toggleable in Settings.
- **Chassis texture**: an inline SVG noise tile (`--tt-grain`, a `data:` URI —
  `img-src` already allows it) on the page, panels and keycaps, plus a faint
  amber vignette at the top of the page. Metal, not flat black.
- **Tally light**: 10 px lamp top-left in the brand plate, with an engraved
  **ON AIR** caption beside it that lights with it (decorative, `aria-hidden`).
  Idle: a dark red lens — hardware never loses its colour. Playing: `tt-danger`,
  pulsing to the beat (Analyser energy) in local modes; steady in YouTube mode.
  This is the beat-reactive element that survives even when the visualizer is
  off. ✅ **The pulse shipped with the visualizer in P5 slice 4** (`05 §6`).

  Driven by a CSS custom property carrying the 0–1 energy, **not** by a class:
  the beat is continuous, and a class toggle quantises it to on/off, which reads
  as a blink rather than as a pulse. Both the glow radius and the scale ride the
  same value. Suppressed under `prefers-reduced-motion` in two places — the
  visualizer stops publishing a beat at all, and the CSS pins the dot — because
  the first is the real mechanism and the second is what catches a future
  refactor that keeps the value flowing.
- **Icons** (`TtIcon.svelte`): inline SVG on one 24-unit grid in `currentColor`,
  always `aria-hidden` — the button owns the name. They replaced the emoji the
  transport used (⏮ ⏯ 🔊 ⚙), which rendered as colour emoji on Windows and as
  text glyphs elsewhere, so one button looked different on every OS.
- **Scrollbars**: custom everywhere — `scrollbar-width: thin` with an `outline`
  thumb on a transparent track (standard properties for Chromium ≥ 121 and
  Firefox, `::-webkit-scrollbar` for Safari), amber on hover. Settings →
  Display → **Hide scrollbars** (`hideScrollbars`, `02 §3.1`) sets
  `html[data-tt-scrollbars='hidden']`, which removes them inside `/app/` while
  wheel, keyboard and touchpad scrolling keep working; scroll regions then get
  an edge fade (`.tt-scroll-fade`) as the remaining cue, and any region with no
  focusable child is itself focusable so a keyboard can still scroll it.
- Fonts are **self-hosted** (privacy §09): `@fontsource/chakra-petch` (display,
  500/600), `@fontsource/be-vietnam-pro` (UI), `@fontsource/jetbrains-mono`
  (numbers, codes); all three ship a Vietnamese subset, checked before choosing.
  DSEG7 Classic is vendored in `public/fonts/dseg7/` with its OFL license file.
  DSEG covers digits + `:` `.` `-` only — exactly what the countdown needs; all
  prose uses `--font-ui` (full Vietnamese diacritics). ⚠️ CSS imports are
  invisible to knip and to the bundle graph, so each `@fontsource` family is
  also in `knip.json` `ignoreDependencies` and in `scripts/make-notices.ts`
  `CSS_ONLY`.

## 2. Layout zones — Player screen

```
┌──────────────────────────────────────────────────────────────┐
│ Z5 ● ON AIR  TICKTUNE                            EN ⚙ ⤢  Z6 │
│                                                              │
│  Z1 background stack (full-bleed, bottom → top):             │
│     solid / gradient  →  image | slideshow (Ken Burns)       │
│     →  cover-art blur + dark scrim (adaptive 35–60%)         │
│     →  Z2 visualizer canvas (local modes only)               │
│                                                   ┌────────┐ │
│              Z3   1:24:07                         │  Z4    │ │
│              (DSEG7 behind smoked glass, §4 cap)  │ right  │ │
│              < 60 s → 42.183  in tt-danger        │ rail   │ │
│                                                   └────────┘ │
│ Z7 ─ Song Title — Artist ─ 3:12 / 6:40 ─ ▂▂▂▂▂▂▂▂▂▂▂▂▂▂──  │
└──────────────────────────────────────────────────────────────┘
```

| Zone | Content | Behavior |
|------|---------|----------|
| Z1 | Background stack per Settings | Crossfades 400 ms between slideshow images; scrim auto-raises if contrast sampling under digits < 4.5:1 |
| Z2 | Visualizer canvas | Styles: bars / wave / ring around the clock; hidden in YouTube mode (no audio data cross-origin) — Z1's generated gradient carries that mode, and **nothing is derived from the video thumbnail** (`§5`, `06 §6`) |
| Z3 | Countdown | Formats and update rates are **defined solely by `04 §4`** — not restated here. Below 60 s the digit color switches to `tt-danger` |
| Z4 | **Right rail — mode dependent** (below) | Collapsible (`]` hotkey); auto-collapses in Focus mode — **except in YouTube mode**, see the carve-out below |
| Z5 | Brand plate: tally lamp, ON AIR caption, wordmark | Always visible except Focus mode |
| Z6 | Language, settings, fullscreen | Icon keycaps (`.tt-key-icon`), 40 px hit area |
| Z7 | Transport console: Title — Artist · ⏮ ⏯ ⏭ ⏹ · mute + fader · elapsed/duration · tape progress | A floating rack strip, right-inset by `--tt-yt-reserve` like every fixed layer. **Auto-hide** after 4 s idle (fades, then leaves the tab order); reappears on mouse move/any key. ⏮/⏭ are **disabled in Single mode** — there is nowhere to go |

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

**The overlay row has a mechanism as of P5 slice 2: `--tt-yt-reserve`.** The shell
publishes it on `.tt-main` — the rail's column plus the page padding while a
YouTube video is loaded, `0px` in every other mode — and every fixed layer insets
its right edge by it. One variable, so a future overlay inherits the rule instead
of rediscovering it.

v1.1 closed the two exemptions the rule still had. The full-width bottom bar
never actually reached the player — the stage reserves its height — but a rule
with an exemption is a rule the next layout change breaks, so Z7 is inset too.
The `?ttdebug=1` panel was `right: 1rem`, squarely over the player whenever
debug met YouTube mode; it is inset as well.

⚠️ It was written because the rule was **already being broken in v0.5.2**, and
the shape is worth keeping: `TtTrackInfo`'s modal box never reached the rail, but
its **backdrop** was `inset: 0` at 75% opaque void, so right-clicking a queue row
during YouTube playback laid a scrim over a playing player. The part of the markup
that covered the player was the part with no content in it, which is why reading
the component did not find it and measuring did.

### Measured 2026-07-22 (spike S1) — the carve-out is load-bearing

The S1 harness renders the player inside a mock rail whose collapse and Focus
behaviours are the **naive** ones, precisely so this could be observed rather
than assumed. With a video **playing**:

| Rail state | Player box | Computed | Video |
|------------|-----------|----------|-------|
| normal | 384×216 | `display: grid`, opacity 1 | playing |
| **collapsed** | **0×0** | **`display: none`** | **still playing** |
| **Focus** | 384×216 | **opacity 0.06** | **still playing** |

Both states leave audio running with the player hidden — exactly what `06 §1.2`
forbids. So the carve-out above is not defensive wording; without it the default
implementation of either affordance violates the ToS.

⚠️ **`Element.checkVisibility({ checkOpacity: true })` returns `true` at opacity
0.06.** It only catches opacity **0**, so it cannot be the guard for "the player
is visible" — a near-transparent player passes it. Any P4 assertion has to test
the computed opacity and the box, not ask the platform whether it is visible.

## 3. Screens inventory

1. **Landing** (`/`, `/en/`) — hero with looping demo capture (placeholder asset
   until core is done, per spec), feature grid, mode explainer, limits table, FAQ,
   legal links, "Open TickTune →" CTA. Static, indexable (07 §3).
   ✅ **Built in P6 slice A**, both languages, zero JS on the page.

   Two things it carries that are requirements rather than copy:

   - **The FAQ states the visible-vs-hidden countdown promise** (`04 §2` item 6)
     — the one deliverable of the S2 decision that lives outside the app. It is
     asserted in both languages by `tests/e2e/landing.spec.ts` and again at the
     source by `tests/unit/tt-static-i18n.test.ts`, so a translation pass cannot
     quietly drop it.
   - **The GPL-3.0 §6 source-offer link** stays in the footer. It has been on
     the page since the first deploy because the hosted build must offer its
     corresponding source; it is a licence obligation, not decoration.

   The hero media is the **real app**: `pnpm demo` (`scripts/make-demo.ts`)
   records it into `public/demo/`, same-origin, so the CSP needs no change. It
   was a labelled placeholder until P7, and is re-recorded whenever the UI it
   shows changes — v1.1's redesign included.
2. **Legal Gate** — first run at `/app/`: blocking modal, summary of
   EULA/Disclaimer/Privacy + links to `/legal/*` and GitHub; single checkbox +
   Accept. Accept = autoplay-unlock gesture (`02 §1`). Re-shown if legal version
   bumps. Styled as the power-on plate — lit tally, wordmark, the version being
   agreed to — and the card **scrolls itself**: `main` is inert behind it, so on
   a short window or at 200% zoom nothing else could bring Accept into view.
3. **Setup** — two rack modules side by side under the countdown preview:
   **Source** (mode tabs, drop zone or link box, the queue, import progress and
   toast) and **Timer** (countdown input `H:MM:SS`, presets **in minutes**
   (5/10/15/25/30/45/60/90), "Match queue length", Start). Side by side because
   stacked they scrolled on a 1280×720 laptop window — Start is the one control
   that must never be below the fold. For the same budget the countdown is drawn
   at 66% on Setup (`--tt-stage-scale`), where it is only a preview; the scale
   multiplies its preferred size and never the `§4` cap. Once the queue has
   tracks the drop zone collapses to one line, and the queue's legend shares a
   row with Shuffle and Repeat.

   **"Match queue length"** sets the countdown to
   `clamp(ceil(Σ durationMs / 1000) · 1000, 1 s, 24 h)`. It is **disabled** when
   the queue is empty or when any queued track's `durationMs` is `null`. Links
   get their lengths at import from the Data API since v2.0 (`06 §3`), so it
   works for a YouTube queue too; until v2.0 their lengths stayed `null` until
   player backfill, which disabled it for every link queue. A deployment
   without the key, or a live stream in the queue, still disables it — with
   the reason shown.
   It is **one-shot**: it does not re-compute when the queue changes afterwards,
   because a user who then edits the countdown by hand must not have that
   silently overwritten.

   **Mode tabs.** All three render, and since P4 all three are enabled.
   `lastMode` is written only when the user picks an **enabled** tab — which is
   why, while tabs were still locked, a profile carrying the
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
5. **Finished** — "TIME'S UP" as a framed, lit stamp in DSEG14-style caps,
   rendered in the display face (DSEG7 covers digits only), then Restart / Back
   to setup. The suite 1.0 sketch also listed a session summary (tracks played,
   duration); no phase built it, and nothing here should imply one exists.

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
8. **404** — static Astro page in the Rack Unit style ("Channel not found").

## 4. Focus mode

`F` toggles fullscreen; `H` toggles **Focus**: hides Z4–Z7, dims Z1 further,
countdown scales up ~20%. Any pointer/key shows a 3 s hint chip "H to exit focus"
— **including the `H` that entered Focus**, which is the case that matters: the
keystroke has just removed every control that could explain itself.

Leaving the player screen cancels Focus. The path that forces this is the one the
user cannot steer: with Z7 hidden there is no Stop button, so a run **finishing**
is how Focus is left from inside it, and the Finished screen must not arrive under
a hidden header.

**In YouTube mode, Focus keeps the player visible** — Z4 is reduced to the player
alone rather than hidden. See the YouTube visibility carve-out in `§2`; it is a
ToS requirement (`06 §1.2`), not a preference.

### The countdown size cap — measured 2026-07-23, and it is a ToS floor

`§4` grows the digits ~20% while `06 §1.2` pins the player at 384×216 and forbids
anything overlapping it. The two pull opposite ways, so the question was measured
on the shipping app before any Focus code existed (Chromium, DSEG7 Classic v0.46,
YouTube mode, a **two-hour** countdown so the widest of `04 §4`'s three regimes is
on screen):

| Viewport | Player right edge | Fully on screen | Off screen |
|----------|-------------------|-----------------|------------|
| 1920 | 1800 | ✅ | — |
| 1600 | 1726 | ❌ | 126 px (33%) |
| 1440 | 1633 | ❌ | 193 px (50%) |
| 1366 | 1573 | ❌ | 207 px (54%) |
| 1280 | 1504 | ❌ | **224 px (58%)** |
| 1152 | 1400 | ❌ | 248 px (65%) |

**That is a defect that shipped in v0.5.2, not a P5 one.** Neither flex item could
shrink below its min-content size — the rail's is the player's own 384 px — so the
line overflowed and the overflow went off the right edge, taking the player with
it. It survived every existing spec because they all use a one-minute countdown,
and `MM:SS` is the *narrowest* regime.

The glyph metric that decides it, same measurement:

| Regime (`04 §4`) | Ghost | Width ÷ font-size |
|------------------|-------|-------------------|
| ≥ 1 h | `8:88:88` | **4.48 em** |
| < 60 s | `88.888` | 4.08 em |
| 60 s – 1 h | `88:88` | 3.46 em |

**Resolution: the ToS floor wins, and it is enforced by layout rather than by a
YouTube-specific branch.** The rails are `flex: none`; the countdown lives in a
`container-type: inline-size` column whose width is therefore "the stage minus the
rail"; and its size is `min(<the s/m/l × Focus clamp>, 22.2cqw)` — `22.2 = 100 ÷
4.49`. Consequences, all deliberate:

- Above ~1600 px nothing changes: the vw term is still the smaller of the two, so
  a wide monitor renders exactly what it did before.
- Below that, Focus grows the digits by **less** than 20%, and in YouTube mode at
  1280 px it does not grow them at all. That is the correct trade: `06 §1.2` is a
  contract, `§4`'s 20% is a preference.
- The cap sits **outside** the `clamp`, so its 96 px floor cannot beat it. `07 §2`
  keeps a session alive when a desktop window is snapped narrow, which is exactly
  when the floor would otherwise push the player off screen again.
- The **widest** regime sets the constant even though it is only on screen above
  an hour. Sizing per regime would resize the digits at the 1 h and 60 s
  boundaries — the jitter the ghost layer exists to prevent (`§1`).

⚠️ Verified by mutation: with the cap removed, six of `tests/e2e/yt-visibility.spec.ts`
turn red. An earlier version of that spec probed only the player's **centre** and
stayed green while the digits overlapped its left edge by 79 px — the failure
arrives from one side, which is where a single sample is blind. It samples a grid.

**The display window (v1.1) is inside this arithmetic, not beside it.** The smoked
glass behind the digits (`§1`) is a pseudo-element, so it adds nothing to the box
the cap measures; it paints 0.08em past it on each side. The largest font-size
that can exist is 280 px × Focus's 1.2 = 336 px, where that bleed is 26.9 px —
inside both the stage's 40 px (2.5rem) gap to the rail and `.tt-main`'s 32 px
padding. Grow the bleed, or shrink either gap, and this sum has to be redone.

## 5. Auto-theme (enhancement)

On track change (local): sample the embedded cover art via a 16×16 canvas
median-cut → derive one dominant hue → tint the gradient background and digit glow
(never the digit core color; legibility first). Toggle in Settings, default ON.

**Skipped when there is no cover art, when the art is greyscale, and in YouTube
mode.** The middle case is not a technicality: a black-and-white sleeve has no
hue to borrow, and returning one anyway would tint the whole interface off a
rounding error in a grey gradient. `tt-dominant-hue.ts` returns `null` and the
caller must handle it.

⚠️ **The YouTube clause changed on 2026-07-23, and the reason is worth keeping.**
This section used to read *"skipped when no cover art or in YouTube mode
(thumbnail hue used instead)"* — i.e. it specified deriving a colour from
YouTube's thumbnail. That is a **modified use of YouTube's image** and it sits
under an open 🟠 audit finding (`AUDIT-BACKLOG`) that names this very sentence.

Spike S1 measured `i.ytimg.com` responding with `ACAO: *`, so the canvas would
**not** be tainted and the extraction is perfectly implementable. That removes
the technical objection and leaves only the licensing one — which makes building
it a *decision* rather than an oversight, and nobody has read the terms. So
YouTube mode gets the generated gradient, unmodified, which is what the audit
finding's own recommendation asks for:

> "drive the ambient background from a generated gradient rather than a
> blurred/derived version of YouTube's image"

The same ruling covers `06 §6`'s blurred `hqdefault` background. Neither is
built. If the terms are read later and permit it, this is the paragraph to
revisit — not the code.

**How the tint is applied**, because "tint the gradient" admits a wrong reading:
a `hue-rotate` filter over the base layer, **not** a rebuild of the gradient
stops. The six presets were chosen dark so the digits clear 4.5:1 against them
at the minimum scrim (`tt-gradient.ts` asserts it), and rotating hue leaves
luminance untouched — so the contrast guarantee survives the tint. Replacing the
colours with sampled ones would throw it away, which is what "legibility first"
above is guarding.

## 6. Settings (⚙ panel, grouped)

This table is the **UI grouping only**. Field names, types, ranges and defaults
live in `02 §3.1` (`TtSettings` / `TT_DEFAULT_SETTINGS`) — the single source of
truth. Do not restate a default here; it will drift.

| Group | Controls | `TtSettings` fields | Ships |
|-------|----------|---------------------|-------|
| General | Language EN/VI · reopen legal pages · export / import the settings file (`02 §3.4`, v2.0) · reset app (clears Dexie) | `lang` | **P5 s2** |
| Display | **Theme: Dark (LED) / Light (LCD)** (v2.0, `§1`) · Background: Solid / Gradient (6 presets + custom) / Image / Slideshow (multi-upload, interval, fade or Ken Burns) / Cover-art blur · scrim strength · scanlines · auto-theme · **hide scrollbars** (v1.1; applies inside `/app/`, the static pages keep the slim custom bar) | `theme`, `background`, `gradientPreset`, `gradientCustom`, `slideshowIntervalMs`, `slideshowTransition`, `scrimStrength`, `scrimAuto`, `scanlines`, `autoTheme`, `hideScrollbars` | **P5 s3**, v1.1, v2.0 |
| Countdown | Glow intensity · size (S/M/L) · **clock face 7/14-segment** (v2.0) · **notify when time is up** (v2.0, `04 §2`; asks permission in the click) · **End Behavior**: fade-out duration, chime, flash, and what happens at zero (stay / restart / loop — see `02 §3.3`) | `glowIntensity`, `countdownSize`, `clockFace`, `finishNotify`, `endFadeMs`, `endChime`, `endFlash`, `endAction` | **P5 s2**, v2.0 |
| Visualizer | Style off/bars/wave/ring · sensitivity | `visualizer`, `visualizerSensitivity` | **P5 s4** |
| Audio | Volume · mute · **crossfade 0–5 s** (0 = hard cut) · **single-track loop style** (v2.0, `05 §2`) | `volume`, `muted`, `crossfadeMs`, `singleLoopStyle` | **P5 s2**, v2.0 |
| Playback | Shuffle · Repeat playlist · allow duplicates | `shuffle`, `repeatPlaylist`, `allowDuplicates` | **P5 s2** |
| Hotkeys | Read-only reference list | — | **P5 s2** |
| Diagnostics | Log viewer · Copy Diagnostics · clear log | — | **P5 s2** |
| About | Version, license, GitHub, third-party notices | — | **P5 s2** |

**Slideshow pictures are capped at `TT_MAX_BACKGROUND_IMAGES` = 20** (P5 slice 3).
`03 §6` said "multi-upload" and named no ceiling, and an uncapped multi-select is
a way to put a few hundred full-resolution bitmaps into RAM behind a countdown.
Twenty is twenty minutes before a repeat at the 60 s maximum interval. Over the
cap logs **TT-IMG-002** rather than silently truncating.

**The pictures themselves are session-only, and the Display group must say so.**
Hard invariant 1 keeps them in RAM (`02 §3`), so `background: 'slideshow'`
survives a reload and the images do not. Z1 composites rather than switches, so
the gradient underneath is already painted and nothing goes blank — but a user
who chose a slideshow yesterday would otherwise find a gradient today with no
explanation, which is why the empty state is copy rather than an absence.

### A group ships with its feature, never before it

**A group whose renderer does not exist is not rendered — not even disabled.**
✅ **All nine groups now exist**, and the order of arrival is the point: Display
landed with `TtBackdrop` in slice 3, Visualizer with `TtVisualizer` in slice 4,
neither a moment earlier. Inside Audio the crossfade slider and the loop-style
selector stayed **absent** while `15 §S4b` was open — the rule outlived the last
group, and the group said so in a line of prose — and arrived in v2.0 with the
engine they drive.

The rule is written here because the alternative had already shipped: `TtSingleRail`
carried a loop-style pair with hardcoded `aria-pressed` and **no `onclick` at all**
for three phases — an inert control, in production, reading as finished work. A
greyed-out Display group would be the same object with better manners.

The loop-style pair itself stays in Z4 where `§2` puts it, now wired: until
v2.0 the pressed state reported the **effective** style — `hard` while S4b was
open, with the visible notice `05 §2` promised beside a stored `'crossfade'`.
Since S4b passed both styles are real, and the pair simply shows the stored one.

### Reset app — two steps, and the second one states the cost

`settings.reset()` deletes the Dexie row, so `legalAccepted` goes with it and the
**legal gate blocks at next boot**. That is what "clears Dexie" means and it is
the intended behaviour — a full reset is a fresh profile, and the gate is also one
of the three autoplay-unlock sites (`05 §1`), so nothing downstream is worse off.

What was missing was saying so. The confirmation names the consequence before it
happens; an unannounced re-block is indistinguishable from the app having broken.
Logged as **TT-USR-101** (`12 §6`), and the shell returns the app to `gate`
in place rather than waiting for a reload.

### The panel is a side sheet, not a modal

Left-anchored, no page-covering backdrop, capped by `--tt-yt-reserve` (`§2`), and
**no `aria-modal`** — a full-bleed backdrop is precisely what `§2` forbids over
the player, so the page behind genuinely stays interactive and the ARIA must not
claim otherwise. `Esc` and a press outside close it; focus moves to the close
button on open and returns to **⚙** on close, because `S` opens the panel with
nothing focused and "restore the opener" would drop a keyboard user on `<body>`.

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
Disabled while typing in inputs (and selects).

**Bare keys only** (v1.1). With Ctrl/⌘/Alt held the key belongs to the browser —
Ctrl+F (find) used to toggle fullscreen and Ctrl+S opened the panel. Shift is
allowed (`S` = `s`), and AltGr is exempt because Windows reports it as Ctrl+Alt
and it is how `]` is typed on German and French layouts. A key a component has
already handled (`preventDefault`) is never also a hotkey: a row's `Alt+↑/↓`
reorder used to move the volume ±5 as well.

**Enter on a queue row** plays it, as double-click does (`02 §8`). The row's
context menu opens with real focus on its first enabled item, takes outside
clicks without any overlay element (an `inset: 0` layer used to sit over the
YouTube player while the menu was open — the `§2` carve-out), and returns focus
to the row on close.

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

- Duration tokens 120 (key press) / 150 / 250 / 400 ms; ease
  `cubic-bezier(0.2, 0.7, 0.1, 1)` — mechanical: a short press, a damped
  settle. Keycaps travel 1 px on `:active`; the Finished stamp lands with a
  one-shot scale. Digits do **not** animate per tick (LED authenticity); state
  changes use opacity/scale only.
- **No entrance fades on anything that carries text.** axe measures partial
  opacity as low contrast and scans whenever a test asks, so a 400 ms fade on
  the settings sheet failed the a11y spec on its most marginal colour, and a
  slide moved a box another spec measures. The sheet and the gate simply
  appear; the landing's power-on reveals text with clip-path and movement,
  never opacity.
- `prefers-reduced-motion`: disables Ken Burns, scanlines, visualizer, tally
  pulse, the landing's power-on, the Finished stamp and the sheet's smooth
  scrolling — countdown still updates (content, not decoration).
- Contrast: all text ≥ 4.5:1 against effective background — the scrim guarantees
  it over Z1, and `§1` lists the measured ratio of every text token on every
  surface, so `tt-muted` no longer needs the 14 px floor it had in v1.0.
- Countdown `aria-live`: **off** for per-second ticks (screen-reader spam);
  polite announcements at 10 min / 5 min / 1 min / 10 s / zero.
  ✅ **Written in P5 slice 4** — it had been a sentence with no code behind it
  since suite 1.0, and `16` listed it as a P5 exit criterion for that reason.

  Three rules the sentence does not state, each ruling out a wrong
  announcement (`tt-milestones.ts`, and each has a unit test):

  1. **Downward crossings only.** A 30-second countdown starts already below the
     one-minute threshold, and announcing "one minute remaining" at the moment
     the user pressed Start would be nonsense. It also keeps a paused timer
     silent.
  2. **Only the lowest threshold, when one tick crosses several.** `04 §2` is
     explicit that a backgrounded tab can be throttled for minutes, so a tick
     genuinely can run 12 min → 30 s. Four announcements back to back would talk
     over each other and the only one still true would arrive last.
  3. **Zero is `<= 0`, not `== 0`.** The timer overshoots by design, routinely by
     a whole throttled interval, so equality would silently never fire the one
     announcement that matters most.

  ⚠️ **The wiring was the defect, not the rule** — this project's signature
  shape, and it shipped for the length of one E2E run. The shell first passed
  the *display* value as "previous", and that value is initialised to 90 000 for
  the idle preview, so the first tick of a 12-second run compared 90 000 against
  12 000 and announced "one minute remaining". The pure function was correct
  throughout. A dedicated baseline fixed it; reverting it turns the spec red
  with exactly that spurious announcement.
- Full keyboard support: queue rows focusable, context-menu equivalent via `Menu`
  key / `Shift+F10`, visible focus ring (`tt-signal`, 2 px offset).
- Language of parts: `lang` attribute switches with i18n so screen readers use the
  right voice.
