# P2 live-site smoke checklist — v0.2.0

The `docs/13 §7` checklist, filtered to what P2 actually ships and expanded with
what to look for. Rows for Playlist, YouTube, Settings and Diagnostics are
**deliberately absent** — those are P3/P4/P5, and ticking them off would be
recording a pass for something that does not exist yet.

Run at `https://ticktune.net/app/` on a **desktop** browser, fresh profile.

## Blocking — a failure here means don't announce the release

- [ ] **Gate appears on a fresh profile**, Accept persists across a reload.
- [ ] **Import a real MP3** from your own library (not a fixture): it stages,
      the title shows, the duration is right.
      - Vietnamese-tagged file → diacritics intact, not `N¯ng ¥m`.
      - A file with no tags → falls back to the file name, does not show blank.
- [ ] **Start plays it.** Sound actually comes out; the loop counter reaches
      ×2 when the track wraps.
- [ ] **`< 60 s` display is smooth** — milliseconds, no visible stepping, digits
      in red.
- [ ] **Countdown accuracy over 10 min vs a phone stopwatch, ±1 s, tab VISIBLE.**
      This is the only case that bound applies to (`04 §2`).
- [ ] **The End Behavior fires at zero**: the music fades over ~2 s, the chime
      sounds (two notes), the Finished screen appears.

## The S2 case — the one this release exists to get right

- [ ] Start a **5-minute** countdown, then **switch to another application** (not
      just another tab) and leave it for the whole run.
- [ ] Come back. Expected: the Finished screen is showing, and **if it was late
      by more than 2 s it says when zero was actually reached** — e.g.
      *"HẾT GIỜ · lúc 14:32 — 2 phút 57 giây trước"*.
- [ ] **Lateness is expected here, not a defect** (`04 §2`). What would be a
      defect: the screen implying the moment is now, or the countdown never
      finishing at all.
- [ ] The fade and chime happened too — you may hear the chime on return.

## Worth checking while you are there

- [ ] `?ttdebug=1` still shows the S2 panel, and **"Chỉ đồng hồ (S2)"** starts a
      countdown with no track — spike S2's remaining cases need it.
- [ ] Drop a **folder** of music on the drop zone: it takes one track and the
      toast says the rest were skipped, rather than erroring.
- [ ] Drop a **non-audio file**: toast shows `TT-IMP-001`, nothing is staged.
- [ ] **Right-click the now-playing card** → info modal lists every field, `Esc`
      closes it and focus returns.
- [ ] **Mute (`M`) then let it finish** → no chime, and nothing in the console.
- [ ] Bottom bar hides after 4 s idle and returns on mouse move.
- [ ] **Reload mid-run** → the browser asks to confirm (the queue is
      session-only, so leaving really does discard it).
- [ ] Headers/CSP live (`10 §11`) — no CSP violations in the console. Watch for
      the Cloudflare Web Analytics beacon, which is still auto-injected and
      still blocked (`10 §10`, open zone-side item).
- [ ] **Real Android phone + touch-only iPad**: the gate shows and no app bundle
      is downloaded.

## Known-absent, so do not report as bugs

Crossfade loop style (gated on `15 §S4b`) · the tally-light beat pulse · the
Settings panel and Diagnostics viewer · background/visualizer · Focus mode and
fullscreen · the `F`/`H`/`]`/`S` hotkeys · EN translation of the app UI · the
import progress indicator.
