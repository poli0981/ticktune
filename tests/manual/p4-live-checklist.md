# P4 live-site checklist — YouTube

The `docs/13 §7` checklist, filtered to **what P4 actually ships**. Focus mode,
crossfade and the thumbnail background are **deliberately absent** — see
"Known-absent" at the bottom, and please don't report them.

Slice 1 (links become a queue) is the first block; **slice 2** (the player) is
marked ⬆. The third block is the **`yt-matrix` re-run**, which is P4's stated
exit criterion.

Run at `https://ticktune.net/app/` on a **desktop** browser, fresh profile.

⚠️ **This must be run against the tagged release, not a preview.** Under `astro
preview` and `astro dev` the Worker does not run at all, so `/api/yt/oembed`
falls through to the static 404 page and every link is reported as a network
problem. The site is the only place this is testable.

## Blocking — a failure here means don't announce

- [ ] **The YouTube tab is there and switching to it hides the drop zone.** A
      queue is all-local or all-links, decided by the mode (`06 §5`) — there is
      no paste box in Playlist and no drop zone here.
- [ ] **Paste 3 real links at once**, one per line, and press *Thêm vào danh
      sách*. Each row shows the video's **title and channel**, and the footer
      counts them with **no `/ 91:00`** denominator — this mode imposes no
      duration cap.
- [ ] **Press Bắt đầu. The first video plays, on its own, without touching
      anything else.**
      This is the single most important line in this file. It did not work at
      all before this release: the first Start cued nothing and the app never
      even contacted YouTube. If you see a black rectangle where the video
      should be, stop and say so.
- [ ] **When a video ends, the next one starts by itself.** The highlighted row
      moves with it.
- [ ] **Press ⏹ Dừng, then Bắt đầu again.** The video plays again. A black
      384×216 box on the second run is the other bug this release fixes.
- [ ] **The player stays visible and unobscured the whole time** — it is a
      YouTube ToS requirement (`06 §1.2`), not a layout preference. Nothing may
      cover it, and there is deliberately no control anywhere that could collapse
      or hide it.
- [ ] **YouTube's own controls work** — play, pause, seek, fullscreen, volume.
      Pausing with **YouTube's** button must make the app's bottom-bar button
      turn back into ▶. (Before this release it stayed ⏸ and the ⏯ hotkey pointed
      the wrong way.)
- [ ] **Let the countdown reach zero.** The video pauses, **the chime plays**,
      and the Finished screen appears. Do this **twice, in the same browser
      profile** — the second run is the one that was broken, because the legal
      gate does not appear again and it was the only thing unlocking audio.

## ⬆ Slice 2 — the player, errors and metadata

- [ ] **Paste a link to a video that cannot be embedded** (see the matrix below
      for a known one). It is **refused at import** with a reason, rather than
      accepted and failing five seconds later during the countdown.
- [ ] **Volume and mute** (`↑` `↓` `M`, and the slider) change the video's
      loudness. YouTube's scale is 0–100 and ours is 0–1, so a bug here sounds
      like the app being silent rather than like a wrong level.
- [ ] **Turn Lặp lại off and let the queue run out** → the panel says *"Đã hết
      danh sách"*, the video stops, **and the countdown keeps running**.
- [ ] **⏭ past the last track** → the video actually stops. (It used to keep
      playing while the queue reported itself finished.)
- [ ] **Right-click a row → Thông tin bài.** *Thời lượng* shows a real duration,
      not `–`, once the video has started. Every YouTube track read `–` forever
      before this release.

## Exit criterion — the `yt-matrix` re-run, against the app

`tests/manual/yt-matrix.md` was measured against the S1 spike harness. This is
the same matrix run through **the real app**, which is what `docs/16` asks for.

Paste each id as `https://www.youtube.com/watch?v=<id>`, one at a time, and check
what the app says. **Expected** is what should happen — a different outcome is
the finding.

| id | Case | Expected |
|----|------|----------|
| `jNQXAC9IVRw` | normal, 19 s | imports with title + channel, plays |
| `9bZkp7q19f0` | normal, long | imports, plays |
| `dt7N1Yw-DVI` | embedding disabled | **refused at import**, toast says `TT-YT-101` |
| `l2jmBhzMons` | private | **refused at import**, `TT-YT-100` |
| `abcdefghijk` | well-formed, no such video | **refused at import**, `TT-YT-100` |
| `0000000000` | 10 chars — malformed | **refused**, `TT-YT-002`, never sent upstream |
| `-pvEyYU5-08` | age-restricted | **imports** (oEmbed says 200) then the player refuses: the card appears, says the cause cannot be narrowed, counts down and skips |
| `8dLS8_xM2LI` | age-restricted | as above |
| `x8mLnM-oD_s` | region-blocked (VN-only) | from Vietnam: plays. From elsewhere: imports, then the same card as age-restricted |

- [ ] The two age-restricted ids produce the **card with a countdown**, and it
      skips to the next track by itself after 5 s.
- [ ] **Bỏ qua ngay** on that card skips immediately.
- [ ] ⚠️ **`x8mLnM-oD_s` is the one row that needs a Vietnamese connection with
      no VPN.** It is the only part of this file nobody else can run.

⚠️ The edge caches an oEmbed answer for 6 hours and a client cannot bust it. If
a row disagrees with the table, note the time — a stale cache entry from an
earlier run explains some disagreements and a real bug explains the rest.

## Worth a look, not blocking

- [ ] Paste the same link twice → the second is skipped with `TT-IMP-005`.
- [ ] Paste 51+ links → the extras are refused with `TT-YT-003` and the first 50
      are kept.
- [ ] Paste junk (a bare word, a Spotify URL) → `TT-YT-002`, and the good lines
      in the same paste still import.
- [ ] Paste `youtu.be/`, `shorts/`, `live/` and `music.youtube.com` forms → all
      accepted as the same video.
- [ ] **Turn your network off, then on.** The offline banner appears and Start is
      blocked with the reason stated; the banner clears by itself on reconnect.
- [ ] **Import while offline, reconnect, then press Bắt đầu.** The rows that
      imported as `N/A / N/A` gain their real title and channel a moment after
      Start — that is the re-check the toast has always promised and never did.
- [ ] Switch YouTube → Danh sách with links staged: the queue survives and Start
      disables with a reason.

## Firefox — still the gap CI cannot close

Playwright's Firefox will not launch on this dev box at all (`spawn UNKNOWN`), so
every Firefox result in this project is a manual one. The YouTube specs do not
need an audio device — the sound is inside the iframe — so CI should cover them,
but CI has never run them before this release.

- [ ] **In a real Firefox, fresh profile:** accept the gate, paste 2 links, press
      Start. The video plays, and it advances to the second by itself.

## Known-absent — do not report

These are not built yet, on purpose:

| Not there | Why |
|-----------|-----|
| **Focus mode**, and the `]` collapse | P5. The rail's ToS carve-out is written and component-tested, but nothing can turn Focus on yet — so the branch cannot run |
| The blurred **thumbnail background** (`06 §6`, `03 §5`) | Blocked on an open audit finding: the modified use of `hqdefault` rests on terms nobody has read. S1 answered only the CORS half |
| Crossfade, anywhere | **Blocked on spike S4b**, whose harness needs fixing before its numbers mean anything (`15 §S4`) |
| A visualizer, and a beat-reactive tally light | P5 |
| A Settings panel; an English UI | P5 |
| Any indication of the 60 req/min edge rate limit | The client path is built and tested, but whether the rule exists in the zone is still unverified (`10 §11`) |

Also expected, and not a defect: a **backgrounded** tab still finishes late and
the Finished screen says when zero was actually reached (`04 §2`). That is the
re-scoped promise from P2, unchanged here.

Also expected: **`rel: 0` no longer suppresses YouTube's end screen** — since
2018 it only restricts related videos to the same channel. Those thumbnails at
the end of a video are YouTube's own chrome, not ours (`06 §2`).
