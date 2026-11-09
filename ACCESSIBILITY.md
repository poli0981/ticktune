# Accessibility

TickTune is a full-screen countdown with your own music behind it, used on a
desktop computer. Everyone who can use a desktop browser should be able to set a
countdown, start it, control the music, and know when time is up. That includes
people who use a keyboard instead of a mouse, a screen reader, high-contrast
colours, zoom, or reduced motion.

This statement covers the site at [ticktune.net](https://ticktune.net) and this
repository. It says what is built in, what is known not to work, and how to
tell us about a barrier.

It was last reviewed on 2026-11-09, for **v2.2.0**.

If something stops you right now, skip to
[Reporting accessibility issues](#reporting-accessibility-issues).

## Priorities

Our target is **WCAG 2.2 Level AA**. It is a target we work towards, **not a
conformance claim**: no independent audit has been done. What we have checked,
and how, is under [Supported environments](#supported-environments).

In order, we prioritise:

1. **Keyboard.** Every control works without a mouse, focus is always visible,
   and focus never gets lost or trapped.
2. **Screen readers.** Controls have names. Status changes are announced once,
   not repeatedly. The time remaining can be read at any moment.
3. **Readable content.** Text contrast is measured, not eyeballed. The site
   respects Windows Contrast themes and reduced motion.
4. **Languages.** The app and landing are in Vietnamese, English and Japanese.
   Each page declares its language so screen readers use the right voice.

## What is built in

### Keyboard

| Key | What it does |
|-----|--------------|
| `Space` | Play / pause (when no control has focus — a focused button keeps its own `Space`) |
| `←` `→` | Previous / next track |
| `↑` `↓` | Volume ±5 |
| `M` · `F` · `H` · `S` · `]` | Mute · fullscreen · Focus mode · Settings · show or hide the right panel |
| `Esc` | Close a dialog or panel |
| `Enter` | Play the selected track in the queue |
| `Alt`+`↑` `↓` | Move the selected track up or down (the keyboard version of dragging) |
| `Menu` or `Shift`+`F10` | Open the track's menu: info, move, remove |

- **Single-key shortcuts can be turned off** in Settings → Keyboard shortcuts.
  This helps if you use speech input, or tend to press keys by accident. When
  they are off, `M` `F` `H` `S` `]` do nothing; `Space`, the arrows and `Esc`
  still work. No shortcut runs while you are typing in a field.
- Focus is shown by a 2 px amber ring, offset from the control.
- Dialogs move focus inside when they open and return it when they close. The
  terms dialog cannot trap you: Accept and a "go back" button are both reachable
  by keyboard.
- The Setup mode tabs (Single / Playlist / YouTube) are one tab stop. Move
  between them with `←` `→`, `Home` and `End`.
- Local files are added with the file picker, which works from the keyboard.
  Drag-and-drop is optional.

### Screen readers

- **Announcements.** The time remaining is announced politely at 10 minutes, 5
  minutes, 1 minute, 10 seconds and zero. It is never announced every second.
- **The time remaining on demand.** A hidden "Time remaining: …" timer element
  on the player screen can be read at any moment, in words. It never interrupts.
- **Status messages** are announced once: the import summary, the Focus-mode
  hint, and a YouTube video that cannot play.
- Every icon button has a name: previous, play/pause, next, stop, mute,
  settings, fullscreen, and each track's move and remove buttons. Toggle buttons
  expose whether they are pressed. Sliders speak their value with its unit, such
  as "45%" or "2.00 s".
- Every screen has one top-level heading. The app has a `main` landmark.
- When a run finishes, focus moves to the "Time is up" heading.

### Vision

- **Contrast** is measured for every text colour on every surface it appears on.
  On the worst of the three surfaces: text 13.7:1, digits 14.7:1, amber 9.4:1,
  muted text 6.2:1, red 4.78:1. Control outlines are 3.2:1. The light "LCD"
  theme is held to the same 4.5:1 minimum by an automated test.
- **Behind the digits**, the backdrop is darkened by an amount calculated to
  keep 4.5:1. See the scrim limitation below.
- **Windows Contrast themes** (forced colours) are supported:
  - your colours replace ours;
  - selected and pressed controls, switches and sliders show their state in your
    theme's highlight colour.
- **Size and look.** The countdown comes in three sizes, a 7- or 14-segment
  face, and a dark or light theme.
- **Zoom** works once the page has loaded. See the limitations for zooming
  before load.

### Motion and flashing

- **Reduced motion.** With "reduce motion" set in your operating system, these
  stop:
  - the landing's demo video and power-on animation;
  - Ken Burns, scanlines and the visualizer;
  - the pulsing light and the finish stamp;
  - smooth scrolling and the screen flash.

  The countdown keeps updating.
- **The landing's demo video** can also be stopped with its "Stop the demo
  video" control, keyboard included.
- **The screen flash** at zero is off by default. When on, it is two amber
  pulses at 20% opacity within 400 ms, once per finish — under WCAG's limit of
  three flashes a second.

### Sound

- The chime at zero always comes with the visual "Time is up" screen, so no
  information is sound-only.
- In YouTube mode, captions are YouTube's own: use the CC button in the player.

## Supported environments

TickTune is **desktop only by design**. Phones and tablets get a notice instead
of the app.

- **Browsers:** current Chrome, Edge, Firefox and Safari on a desktop computer,
  with a window at least 1024 px wide when the page loads.
- **Input:** keyboard, mouse or trackpad. A touch screen works alongside a
  mouse; touch alone is treated as a tablet.

**What has been tested, and how:**

| Check | Covers |
|-------|--------|
| Keyboard only (mouse off) + **Windows Narrator** on Windows 11, with **Brave, Chrome and Firefox** | The whole journey, by the maintainer, before v2.2. No barriers found |
| axe-core scan, WCAG 2.0 / 2.1 / 2.2 A and AA + best practices | Every screen: landings, legal pages, 404, terms dialog, Setup, Settings, Player (Single, Playlist, YouTube with an error card), track menu, track info, Finished. Dark and light themes. Runs on every pull request |
| Keyboard-only end-to-end tests | Locate controls by their accessible name, so they fail when a name is lost. Run in Chromium, Firefox and WebKit on every pull request |
| Forced-colours test | Selected, pressed and checked states differ under Windows Contrast themes (Chromium emulation) |
| Lighthouse accessibility | Score of at least 0.95 on the static pages |

**Not tested yet** — reports especially welcome:

- NVDA and JAWS;
- macOS VoiceOver;
- Windows Voice Access and Dragon;
- switch access;
- screen magnifiers.

## Known limitations

Each is described by what it does to you, with a workaround where one exists.

- **Zooming in before the page loads shows the "not available on mobile"
  notice.** The app needs a window at least 1024 px wide at load, and browser
  zoom narrows it. On a 1920 px screen that happens at about 190% zoom.
  - The notice tells you what to do: reset the zoom (`Ctrl`+`0`, or `⌘`+`0` on
    a Mac), reload, then zoom in again. Zooming after load is kept.
  - Very high zoom (400%) is not supported: the layout does not reflow into a
    single column.
- **YouTube's player is YouTube's.** Its controls, captions and keyboard
  behaviour belong to YouTube's embedded player, which we cannot change.
  TickTune's own transport bar works the same way in every mode.
- **A YouTube video that cannot play** shows a card naming the reason. The card
  skips to the next video after 5 seconds, and its reason is announced once.
  "Skip now" moves on at once; there is no way to keep the card longer.
- **A very bright background picture** can leave the digits below 4.5:1,
  because the darkening layer stops at 60%. Nothing on screen says when that
  happens yet. Workaround: a solid or gradient background, or a darker
  picture.
- **Track changes are not announced.** The current title is in the bottom bar
  and the queue, where a screen reader can read it.
- **The legal documents are in Vietnamese and English only.** The Japanese pages
  link to the English text and say so.
- **The app's page title stays "TickTune"**; it does not show the time.
- **The landing page's footer is inside its main region**, so screen readers do
  not list it as a separate "content info" landmark. It is still reachable
  by heading.

## Contributor expectations

Accessibility is part of "done", the same as the hard invariants in
[`CLAUDE.md`](CLAUDE.md).

**Testing**

- A new screen, dialog or state gets a scan in `tests/e2e/a11y.spec.ts`.
- A new control is reached by its accessible name (`getByRole`, `getByLabel`)
  in at least one end-to-end test, never only by test id.
- Run a keyboard-only pass over anything you change. For a UI change, also do
  one screen-reader spot check: Narrator, NVDA or VoiceOver.
- Check reduced motion and forced colours (DevTools → Rendering → "Emulate CSS
  media feature forced-colors") for anything visual.
- A new guard is verified by mutation: break the thing it guards and watch it
  fail (`docs/13 §6`).

**Design and content**

- Colours come from the design tokens in `src/styles/global.css`, whose
  contrast is measured (`docs/03 §1`). No new colour carries meaning on its own.
- Nothing that carries text fades in: a partial opacity is a contrast failure
  while it lasts. Animation sits behind `prefers-reduced-motion`.
- Never put `aria-live` on something that changes every second.
- Every user-facing string, labels included, exists in all three languages
  (`docs/08 §3`).
- A target is at least 24 × 24 px.

**CI**

- The end-to-end workflow fails a pull request with any axe violation.
- A violation that cannot be fixed is listed under
  [Known limitations](#known-limitations) in the same pull request, with its
  effect on users.

The full specification is [`docs/03 §8`](docs/03-UI-SPEC.md) (motion and
accessibility) and [`docs/13 §6`](docs/13-TESTING.md) (the accessibility pass).

## Reporting accessibility issues

If something gets in your way, please tell us. Either:

- open an
  [**Accessibility barrier** issue](https://github.com/poli0981/ticktune/issues/new?template=accessibility.yml),
  or
- email **accessibility@poli0981.dev**, if you prefer not to use GitHub or find
  it hard to use.

Things that help us:

- what you were trying to do;
- the page or screen;
- your browser, operating system, and any assistive technology, with versions
  if you know them.

Screenshots or recordings are welcome but never required. **You never need to
tell us about a disability.**

### Severity

We assign severity when we triage. These are the levels, with examples from
TickTune:

| Level | Meaning | Example |
|-------|---------|---------|
| **Critical** | Blocks a core task, with no workaround | You cannot get past the terms dialog, start a countdown, or find out that time is up |
| **Serious** | A core task is very hard, or needs a workaround | The time remaining cannot be read; a control has no name |
| **Moderate** | An annoyance or inconsistency | An announcement repeats; focus lands somewhere unexpected |
| **Minor** | Small impact | A tooltip-only hint; slightly low contrast on decoration |

## How we respond

TickTune is a solo, unpaid project. There is no formal service-level agreement,
but every report is read. You can expect:

- **an acknowledgement within a week;**
- a workaround, if there is one, while a fix is made;
- the status kept in the issue, or by email if that is how you wrote;
- a request to check the fix, if you are willing — never required;
- thanks, and credit if you would like it.

## Resolution expectations

Targets, counted from the acknowledgement:

| Severity | Target |
|----------|--------|
| Critical | The next patch release — aiming for 14 days |
| Serious | About 30 days, in the next patch or minor release |
| Moderate | About 90 days, or tracked in the roadmap backlog (`docs/16`) |
| Minor | Best effort |

If a target slips, the issue says why and gives a new date.

## Ownership and maintenance

The maintainer, [poli0981](https://github.com/poli0981), owns accessibility:

- triage reports;
- track known barriers here and in the roadmap;
- say when something is at risk;
- keep this statement true.

It is reviewed with every minor release, and at least once a year. A change that
makes a sentence here untrue updates it in the same pull request. If ownership
ever changes, this section will name the new owner.

## Feedback

Suggestions about this statement, or about how TickTune approaches
accessibility, are welcome through the same channels: an issue, or
**accessibility@poli0981.dev**. For a barrier you have hit, please use
[Reporting accessibility issues](#reporting-accessibility-issues), so it is
tracked.
