# P5 slice 3 live checklist — backgrounds

Filtered to **what slice 3 ships**: `docs/03 §2`'s Z1 stack and the Display group.
Everything from slices 1–2 was signed off against v0.6.0 in
`p5-live-checklist.md` and is not repeated here; the visualizer and the a11y
milestones are slice 4 and are listed under "Known-absent".

Run on a **desktop** browser, fresh profile.

⚠️ **Run this against the PR preview, BEFORE the merge.** That is the rule
`p5-live-checklist.md` corrected: the requirement is a real deployment — one
where the Worker actually runs, which excludes `astro dev` and `astro preview` —
and the Cloudflare build that fires on every PR is one. A failure found here
costs a force-push; the same failure found after a tag costs a patch release,
which is what v0.5.1 and v0.5.2 both were.

Nothing in this slice touches the Worker, so a failure is unlikely to *need* the
edge — but the YouTube block below does, and that is the block worth not
skipping.

## Blocking — a failure here means don't merge

### The background is behind the app

- [ ] **The app looks the way it did**, with a slightly warmer dark backdrop
      behind it. If anything is *covered* — the countdown, the buttons, the setup
      form — stop and report that first. Z1 is full-bleed and fixed, so a paint
      order mistake hides the whole interface.

### Display → Background

- [ ] **⚙ → Hiển thị exists**, between Chung and Đồng hồ.
- [ ] **Màu trơn** — the gradient goes, flat near-black remains.
- [ ] **Chuyển sắc** — press each of the six swatches. All six look **different**,
      and all six keep the digits comfortably readable. If one is hard to read,
      say which; the presets were chosen to clear a contrast bound and that is a
      real failure rather than a taste note.
- [ ] **Màu tự chọn** — pick two colours. The background follows both. Press
      *Về mẫu có sẵn* and it returns to the swatch you had.
- [ ] **Ảnh** — choose one picture. It fills the screen behind the countdown.
- [ ] **Trình chiếu** — choose several. They cross-fade, not cut, roughly every
      ten seconds. Move *Đổi sau mỗi* and the rhythm follows.
- [ ] **Ken Burns** — the picture drifts and slowly zooms. *Mờ dần* stops the
      drift and keeps the cross-fade.
- [ ] **Ảnh bìa** — play a local file **that has embedded artwork** (any track
      whose ⓘ modal shows *Ảnh bìa: Có*). The blurred artwork becomes the
      background. Without artwork, the gradient stays — that is correct.

### The part that is easy to get wrong

- [ ] **Pick a very BRIGHT picture** — a white or near-white photo. The digits
      must stay readable: the dimming rises on its own to keep them so. This is
      the one automatic behaviour in the slice, and it is arithmetic rather than
      a guess, so if the digits are hard to read on a bright picture that is a
      genuine defect.
- [ ] **Turn *Tự tăng độ tối* off** with that same bright picture. The digits get
      harder to read. Turn it back on; they recover. (Both states are correct —
      the point is that the switch does something.)
- [ ] **Set *Độ tối nền* to its maximum with a DARK background.** Turning
      *Tự tăng* on must **not** make it lighter. Auto only ever adds.

### Persistence, and the honest gap

- [ ] **Choose a slideshow, then reload.** The setting is still Trình chiếu, the
      pictures are **gone**, and the panel explains that they are not saved. The
      gradient shows in the meantime. This is deliberate — your files never
      leave your machine and are never stored — but it must be *explained*, not
      silently blank.
- [ ] **Preset, scanlines, dimming and Ken Burns all survive a reload.**
- [ ] **Try to choose a music file as a background.** It is refused, and
      ⚙ → Chẩn đoán shows **TT-IMG-001**.

### YouTube mode — the ruling this slice makes

- [ ] **Start a YouTube video.** The background is the plain gradient. There is
      **no blurred video thumbnail** behind the countdown, and the background
      does **not** take its colour from the video.
      This is deliberate and it is the one line in this file worth reading twice:
      using YouTube's thumbnail that way is a licensing question nobody has
      answered, so we do not do it. Please do not report it as missing.
- [ ] **The player is still fully visible** with a picture background behind it
      and with ⚙ open — nothing is drawn over it.

### Reduced motion

Turn the OS setting on (Windows: *Settings → Accessibility → Visual effects →
Animation effects* off).

- [ ] The slideshow **stops moving** and Ken Burns stops drifting.
- [ ] **Vạch quét disappear.**
- [ ] **⚙ still shows Vạch quét as ON**, and turning the OS setting back off
      brings them back. Your preference is suppressed, never overwritten — if the
      checkbox has cleared itself, that is a real bug.

## Non-blocking

- [ ] Switch to `EN` and reopen ⚙ → Display reads as English throughout.
- [ ] Twenty-plus pictures at once: only twenty are kept, and Chẩn đoán shows
      **TT-IMG-002**.
- [ ] *Lấy tông màu từ ảnh bìa* with a strongly coloured sleeve tints the
      gradient towards that colour; with a black-and-white sleeve it does not
      tint at all (there is no colour to borrow).
- [ ] **Real Firefox**, one pass of the slideshow and the bright-picture check.

## Known-absent — do not report

| Missing | Why |
|---------|-----|
| The visualizer, and the tally light pulsing to the beat | P5 slice 4 |
| Spoken countdown milestones (10 min / 5 min / 1 min / 10 s) | `03 §8`, P5 slice 4 |
| A blurred YouTube thumbnail background, or any colour taken from a video | Deliberate. `06 §6` / `03 §5`: a modified use of YouTube's image, under an open audit finding whose ToS half is unread. S1 proved it is technically possible, which makes not doing it a decision |
| Crossfade — both the loop style and between tracks | Spike S4b is open (`15 §S4`) |
| EN versions of the landing page and `/404` | `08 §1`'s route-based mirrors are P6 |
| Background pictures surviving a reload | Hard invariant 1. Session-only RAM, by design, and the panel says so |
