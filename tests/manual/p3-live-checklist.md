# P3 slice 1 live-site checklist — Playlist plays

The `docs/13 §7` checklist, filtered to **what this slice actually ships**. Rows
for drag-reorder, the context menu's Move up/down, the import progress bar and
crossfade are **deliberately absent** — see "Known-absent" at the bottom, and
please don't report them as bugs.

Run at `https://ticktune.net/app/` on a **desktop** browser, fresh profile.

## Blocking — a failure here means don't announce

- [ ] **The app opens on the Danh sách tab.** That is the spec's first-run
      default (`02 §1`), not a regression. `Một bài` still switches to Single.
- [ ] **Import 3–5 real tracks at once** from your own library, by drag-drop and
      again with the file button.
      - The queue lists them in order, each with its own duration.
      - The footer reads `N bài · M:SS / 91:00`.
      - Vietnamese titles keep their diacritics.
- [ ] **Start plays track 1, and when it ends track 2 starts on its own.**
      Nothing is clicked. This is the whole point of the slice.
      - The highlighted row moves with the music.
      - There is a real gap between tracks — a hard cut, no crossfade. Expected.
- [ ] **⏮ and ⏭, and the `←` / `→` keys**, move between tracks. ⏮ is greyed out
      on track 1 and does **not** wrap to the end.
- [ ] **Trộn (shuffle), while something is playing**: the current track keeps
      playing — it must not cut off — and the order after it changes.
- [ ] **Turn Lặp lại off and let the queue run out**: the music stops, the panel
      says *"Đã hết danh sách"*, and **the countdown keeps running**. A
      countdown that stopped here would be the real bug.
- [ ] **Remove the track that is currently playing** (× on its row): playback
      moves to the **next** track, not back to the top, and not silence.

## Worth a look, not blocking

- [ ] Right-click any row → the info modal shows **that row's** metadata, not
      track 1's. `Esc` closes it and returns focus.
- [ ] Import a file whose tags are broken → it still lists, using the file name.
- [ ] Import the same file twice → skipped, with `TT-IMP-005` in the toast.
      (Then, if you want: Settings has no "Allow duplicates" toggle yet — the
      setting exists and is now honoured, but its UI is P5.)
- [ ] Drop a **folder** of music → it recurses, in name order.
- [ ] Import more than 95 files → the extra ones are refused with `TT-IMP-004`
      and the first 95 are kept.
- [ ] Switch Danh sách → Một bài with several tracks staged: **the queue is not
      thrown away**; Start disables and says why. Switching back restores it.
- [ ] Reload with a queue staged → the browser's "leave site?" prompt appears.

## Firefox — still the gap CI cannot close

`AudioContext.resume()` hangs on the Linux CI runner, and this dev box cannot
launch Playwright's Firefox at all. So Firefox playlist playback has **never
been observed anywhere**.

- [ ] **In a real Firefox, fresh profile:** accept the gate, import 3 tracks,
      press Start. Sound comes out, and it advances to track 2 by itself.

## Known-absent — do not report

These are not built yet, on purpose:

| Not there | Why |
|-----------|-----|
| Drag a row to reorder it, `Alt+↑/↓` | Slice 2. The behaviour is specified in `02 §5.1` and `03 §7` first, so the implementation cannot become the spec |
| A right-click menu with Move up / Move down / Remove | Slice 2 — right-click currently opens the info modal directly |
| A progress bar while a big batch imports | Slice 2 |
| Crossfade between tracks, and the crossfade loop toggle | **Blocked on spike S4b**, whose harness needs fixing before its numbers mean anything (`15 §S4`). A hard cut is correct for now |
| A Settings panel (shuffle/repeat/duplicates live only on the queue panel) | P5 |
| An English UI | P5 — everything is Vietnamese until the dictionaries land |
| YouTube tab | P4 |

Also expected, and not a defect: a **backgrounded** tab still finishes late, and
the Finished screen says when zero was actually reached (`04 §2`). That is the
re-scoped promise from P2, unchanged here.
