# P5 live-site checklist — i18n, the ⚙ panel and Focus mode

The `docs/13 §7` checklist, filtered to **what P5 slices 1 and 2 actually ship**.
Backgrounds, the visualizer, crossfade and the countdown's spoken milestones are
**deliberately absent** — see "Known-absent" at the bottom, and please don't
report them.

Slice 1 (the dictionaries and the EN/VI toggle) is the first block; **slice 2**
(the panel, Focus, the hotkeys) is marked ⬆. The last block is the one this
release was nearly derailed by: **the YouTube player's geometry**.

Run at `https://ticktune.net/app/` on a **desktop** browser, fresh profile.

⚠️ **Run against the tagged release, not a preview.** Under `astro preview` and
`astro dev` the Worker does not run, so `/api/yt/oembed` falls through to the
static 404 page and every YouTube link is reported as a network problem. P4's
checklist found a real bug on the one line nobody expected; that is what this
ritual is for.

## Blocking — a failure here means don't announce

### Slice 1 — language

- [ ] **The interface is Vietnamese on a fresh profile.** Every string: the legal
      gate, the mode tabs, the drop zone, the Start button and its hint.
- [ ] **Press `EN` in the top-right.** Everything switches **instantly, with no
      reload**, and the toggle now reads `VI`.
- [ ] **Reload.** It is still English — the choice persisted.
- [ ] **Nothing anywhere reads like a key.** If you see `setup.start` or
      `settings.group.audio` on screen, that is the failure this whole slice was
      guarded against; note exactly where.

### ⬆ Slice 2 — the ⚙ panel

- [ ] **Press `S`, or the ⚙ button.** A panel slides in from the **left**. It
      does *not* dim the whole page — that is deliberate, not an unfinished
      backdrop.
- [ ] **Press `Esc`.** It closes, and the focus ring is back on ⚙ (press `Tab`
      once to confirm you are somewhere sensible, not at the top of the page).
- [ ] **Seven groups, in this order:** Chung · Đồng hồ · Âm thanh · Phát lại ·
      Phím tắt · Chẩn đoán · Giới thiệu. **There is no Display group and no
      Visualizer group.** That is correct for this release.
- [ ] **Cỡ chữ số: press Nhỏ, then Lớn.** The countdown visibly changes size both
      times. This is the single line slice 2 owes: the field has existed since P1
      and nothing read it.
- [ ] **Reload with Nhỏ selected.** The digits are still small.
- [ ] **Độ phát sáng: drag to 0, then to 1.** The glow around the digits goes and
      comes back. The digits themselves never change colour.
- [ ] **Giới thiệu shows a real version number** (`0.6.0`), not `__TT_VERSION__`
      and not `0.0.0`.
- [ ] **Chẩn đoán already lists `TT-USR-100`** — the legal gate you accepted a
      minute ago. Press *Chép thông tin chẩn đoán*, paste it somewhere: it is
      JSON, and **it contains no file names and no track titles**. Please
      actually check that.

### ⬆ Slice 2 — End Behavior, which had no UI at all until now

- [ ] **Đồng hồ → Sau đó → "Chạy thêm một lần".** Load one audio file, set the
      countdown to 5 seconds, Start. When it hits zero it **runs again by
      itself, once**, then shows the Finished screen. The engine has done this
      since P2 with no way to ask for it.
- [ ] **Turn "Nháy màn hình" on and repeat.** The screen pulses at zero.
- [ ] **"Tiếng chuông" off + "Nhỏ dần" to 0 s** — a silent finish, with no chime
      and no fade. (This is what `02 §3.3` means by "silence-only is not a fourth
      mode".)
- [ ] **Set "Sau đó" back to "Dừng lại"** before continuing.

### ⬆ Slice 2 — Focus mode and the hotkeys

- [ ] **Start a run, then press `H`.** The wordmark, the top-right buttons, the
      right-hand panel and the bottom bar all go. The digits get bigger. A small
      chip appears telling you `H` gets you out — **it must appear on that first
      press**, not only after you move the mouse.
- [ ] **Press `H` again.** Everything comes back, same size as before.
- [ ] **Press `H`, then let a short countdown finish.** The Finished screen
      arrives *with* the header — Focus does not survive leaving the player.
- [ ] **Press `]` during a run (Single or Playlist).** The right panel hides;
      press again and it returns.
- [ ] **Press `F`.** Fullscreen. `F` again, or `Esc`, leaves it.
- [ ] **Click into the seconds box and type.** None of `s`, `h`, `f` do anything
      — hotkeys are off while you are typing.
- [ ] **Loop-style buttons in Single mode:** "Cắt thẳng" is selected and
      clickable; "Chuyển mềm" is greyed out and says why on hover. Neither was
      clickable at all before this release.

### ⬆ The YouTube player — the geometry line

This block exists because the planning measurement found the player was **already
being pushed off screen in v0.5.2**. Please do it on the window size you actually
use, and then on a smaller one.

- [ ] **Paste 2 links, set the countdown to 2 HOURS, press Bắt đầu.** Two hours
      matters: it is what makes the clock show `1:59:58` rather than `59:58`, and
      the longer form is 29% wider. This is the exact case that was broken.
- [ ] **The whole 384×216 player is on screen.** No part of it is cut off at the
      right edge, and the page does **not** scroll sideways.
- [ ] **Narrow the window to about half your screen.** Still true. The digits get
      smaller to make room — that is the fix working, not a bug.
- [ ] **Press `H`.** The queue list disappears, **the player does not**, and
      nothing is drawn over it.
- [ ] **Press `]`.** Nothing collapses, and a chip explains that the player has
      to stay visible. Press it a few times; the player never moves.
- [ ] **Press `S` with a video playing.** The settings panel opens on the left
      and **does not reach the player**.
- [ ] **Right-click a queue row → Thông tin bài.** The modal opens and the
      **player is still fully visible and un-dimmed** beside it. In v0.5.2 the
      dark scrim covered it.

## Non-blocking — worth knowing, not worth holding the release

- [ ] Switch to `EN` and reopen ⚙: the whole panel is English, including the
      hotkey table.
- [ ] Diagnostics → change the level filter → only rows of that level show.
- [ ] Diagnostics → *Xoá nhật ký* empties the list.
- [ ] Playback group: turning "Cho phép trùng bài" on and importing the same file
      twice adds two rows.
- [ ] **Real Firefox**, one pass of the Focus/`]`/`S` block. CI's Firefox cannot
      produce audio and this dev box cannot launch Firefox at all
      (`docs/13 §3`), so this is the only place it is exercised.

## Destructive — do this last

- [ ] **⚙ → Chung → Đặt lại ứng dụng.** It asks a second time, and the warning
      **says the legal gate will come back**. Confirm. The gate appears
      immediately. Accept it, and every setting is back to default.

## Known-absent — do not report

| Missing | Why |
|---------|-----|
| Backgrounds, gradients, slideshow, scrim, scanlines, auto-theme | P5 slice 3. The Display group is not rendered at all, on purpose |
| The visualizer, and the tally light pulsing to the beat | P5 slice 4. The dot is a static two-state light |
| Crossfade — both the loop style and between tracks | Spike S4b is open (`15 §S4`). "Chuyển mềm" is greyed out and says so; there is no crossfade slider in the Audio group |
| Spoken countdown milestones (10 min / 5 min / 1 min / 10 s) | `03 §8`, P5 slice 4 |
| EN versions of the landing page and `/404` | `08 §1`'s route-based mirrors are P6. Only the app island is bilingual |
| The blurred YouTube thumbnail behind the countdown | An open audit finding whose ToS half was never read (`06 §6`) |
| A GitHub Release, and any release notification | Never existed; filed as a gap in `docs/14 §5`, not patched |
| A countdown that finishes on time in a **hidden** tab | Measured and re-scoped (`04 §2`). It finishes **late** and says when zero actually was. That is the designed behaviour, not a defect |
