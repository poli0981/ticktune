# P5 slice 4 live checklist — visualizer, tally pulse, announcements

The last slice of P5. Filtered to what slice 4 ships: `docs/05 §6`'s three
visualizer styles, `docs/03 §1`'s beat-reactive tally light, and `docs/03 §8`'s
five spoken milestones. Slices 1–3 were signed off against v0.6.0 and v0.7.0 and
are not repeated.

Run on a **desktop** browser, fresh profile.

⚠️ **Run against the PR preview, before the merge** — the rule
`p5-live-checklist.md` corrected and the last two slices have used.

**Use a track with actual bass.** Half of this checklist is "does it move with
the music", and a quiet acoustic recording makes a working visualizer look
broken. Anything with a kick drum is a better test than anything subtle.

## Blocking — a failure here means don't merge

### The three styles

⚙ → Hiệu ứng nhạc. Start a local track for each.

- [ ] **Tắt** — no graphic behind the countdown. This is the default, and a
      fresh profile must start here.
- [ ] **Cột** — bars along the bottom, mirrored out from the centre, moving with
      the music. Bass on the inside, treble towards the edges.
- [ ] **Sóng** — a single line across the middle that moves with the waveform.
- [ ] **Vòng** — the signature look: short bars in a circle around the digits,
      not crossing them.
- [ ] **Độ nhạy** — drag it up and the movement gets bigger; drag it down and it
      calms. At maximum nothing should look clipped or frozen.
- [ ] **The countdown stays readable in every style.** If the graphic makes the
      digits hard to read, say which style — legibility beats decoration
      (`03 §1`) and that is a real failure.

### The tally light — the one that is easy to get wrong

The small dot to the left of the "TickTune" wordmark, top-left.

- [ ] **Playing a local track, the dot pulses with the beat.** Red, and it
      visibly grows and glows on each kick.
- [ ] **Set Hiệu ứng nhạc → Tắt. The dot still pulses.** This is the single most
      important line in this file. The graphic is off; the beat is not. If the
      dot goes steady when you turn the visualizer off, that is the exact defect
      this was built to avoid.
- [ ] **In YouTube mode the dot is red but steady** — no pulse. That is correct
      and permanent: the video's audio lives inside YouTube's player and cannot
      be measured. It is stated in the panel too.

### The spoken announcements

You need a screen reader for the real check — **Windows: `Ctrl+Win+Enter`
starts Narrator**. If that is too disruptive, the fallback below still catches
the failure that matters.

- [ ] **Set the countdown to 15 seconds and start it.** You should hear exactly
      **two** announcements: "Còn mười giây", then "Hết giờ". Nothing at the
      start, and nothing in between.
- [ ] **Nothing about minutes.** A fifteen-second countdown must never say "Còn
      một phút" — it never had a minute. This exact bug existed during
      development and is what the line above is watching for.
- [ ] **Set 11 minutes and start.** Within the first minute you should hear
      "Còn mười phút" — and nothing else until five minutes.
- [ ] **The countdown does not read itself out every second.** If your screen
      reader is chattering on every tick, that is a defect.

**Fallback without a screen reader:** open DevTools, find the element with
`data-testid="tt-milestone"`, and watch its text change. Same two changes, same
timing.

### Reduced motion

Turn the OS setting on (Windows: *Settings → Accessibility → Visual effects →
Animation effects* off).

- [ ] **The visualizer disappears entirely** in all three styles.
- [ ] **The tally light stops pulsing** and sits steady.
- [ ] **⚙ still shows your chosen style** — Vòng stays selected. Turn the OS
      setting back off and the graphic returns. Your preference is suppressed,
      never overwritten; a checkbox that has cleared itself is a real bug.

### Nothing regressed from the earlier slices

- [ ] Backgrounds, the ⚙ panel and Focus mode all still behave.
- [ ] With a YouTube video playing, **nothing is drawn over the player** — check
      with the visualizer on a local-mode track first, then switch to YouTube
      and confirm there is no canvas at all.

## Non-blocking

- [ ] Switch to `EN` and reopen ⚙ → Visualizer reads as English.
- [ ] A very quiet passage leaves the bars low rather than jumping to full.
- [ ] **Real Firefox**, one pass of a style plus the tally pulse. CI's Firefox
      cannot produce audio at all (`13 §3`), so this is the only place the
      analyser is exercised there.
- [ ] Leave a style running for a few minutes — it should not slow the page
      down. (The formal performance measurement is **P7's**, not this release's.)

## Known-absent — do not report

| Missing | Why |
|---------|-----|
| A visualizer in YouTube mode | Hard platform limit: cross-origin media gives no analyser access (`05 §6`). The panel says so |
| A blurred YouTube thumbnail, or any colour taken from a video | Deliberate — `03 §5` / `06 §6`, a licensing question nobody has answered |
| Crossfade — both the loop style and between tracks | Spike S4b is open (`15 §S4`) |
| A formal performance number | **P7** (`13 §5`). P5 ships the adaptive-degrade *path*, not the measurement |
| EN versions of the landing page and `/404` | `08 §1`'s route-based mirrors are P6 |
| Background pictures surviving a reload | Hard invariant 1 — session-only RAM, by design |

## Production re-check — after the tag deploys to `ticktune.net`

- [ ] `https://ticktune.net/app/` loads and ⚙ → Giới thiệu reads **0.8.0**.
- [ ] One visualizer style moves with a local track, and the tally pulses.
- [ ] Headers still live (`10 §11`): HSTS present, CSP unchanged.
