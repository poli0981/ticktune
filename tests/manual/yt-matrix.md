# YouTube test matrix — spike S1

Curated list for `docs/15 §S1`. Every id here must map to exactly one documented
overlay in `docs/06 §4`, with no "unknown" bucket left over.

`oEmbed` below is what `GET /api/yt/oembed?id=<id>` returns; `onError` is what
the IFrame player reports at play time. **They are independent signals** — a
video can pass the oEmbed check and still refuse to play embedded, which is the
entire reason the matrix has two columns.

## How to run the browser half

There is a harness: **`/spike/s1-youtube`** (`src/app/spike/TtS1Youtube.svelte`,
throwaway, deleted before P6). Run it **on the deployed site**, not only locally
— the shipped CSP is part of what is being measured.

1. Open `https://ticktune.net/spike/s1-youtube` on a **desktop** viewport (the
   `docs/07` mobile gate blocks narrow ones, correctly).
2. Paste ids or URLs, one per line, `#` for comments. Bare ids and every URL
   shape in `docs/06 §5` both work.
3. Press **▶ Start** — that is the *only* gesture allowed. Everything after it
   must happen hands-free; the header counts gestures and advances so you can
   see whether that held.
4. Watch the log. Each `onError` is classified against `docs/06 §4` live, and an
   unmapped code renders as **⚠️ UNKNOWN** — that bucket staying empty *is* the
   acceptance criterion.
5. Toggle **Collapse rail** and **Focus mode** *while a video is playing*. The
   mock rail deliberately implements the **naive** behaviour (hide / dim to 6%)
   so the `docs/03 §2` ToS carve-out is observable rather than assumed. If the
   player disappears, the carve-out is doing real work and P4 must implement it.
6. **Copy log** puts the run, the UA and any CSP violations on the clipboard.

⚠️ **A CSP-violation box appearing is a FINDING, not a broken harness.**
`docs/09 §4` allows `script-src https://www.youtube.com` but **not**
`https://s.ytimg.com`, and the audit suspects the loader pulls
`www-widgetapi.js` from there. If the API never becomes ready on the live site,
that is the answer — record the blocked URI and `docs/09 §4` gains a row.

## Verified by oEmbed — re-checked 2026-07-22 against the live endpoint

| id | Case | oEmbed | Notes |
|----|------|--------|-------|
| `dQw4w9WgXcQ` | normal | 200 | Rick Astley — Never Gonna Give You Up |
| `jNQXAC9IVRw` | normal | 200 | "Me at the zoo" — the oldest video on the site, stable |
| `9bZkp7q19f0` | normal | 200 | PSY — Gangnam Style |
| `M7lc1UVf-VE` | normal | 200 | YouTube's own IFrame API demo video |
| `aaaaaaaaaaa` | **no such video** | **400** `{"error":"unavailable"}` | Well-formed id, does not exist. See below |
| `ZZZZZZZZZZZ` | no such video | 400 `{"error":"unavailable"}` | second sample, same behaviour |
| `xxx` | malformed | 400 `{"error":"invalid_id"}` | rejected by our regex, never reaches YouTube |

### Finding: a deleted video is a 400, not a 404

`docs/06 §4` used to map "oEmbed 400" to *Invalid link* (TT-YT-002) and reserve
*Deleted / private* (TT-YT-100) for 404/401. Measured behaviour is that YouTube
answers a non-existent video with **400**, so under the old mapping a user who
pasted a link to a deleted video would have been told their **link was
malformed**.

`§3` and `§4` now classify on the `error` field instead of the status code.
Found before any P4 UI work existed, which is what S1 is for.

## ✅ Closed: `i.ytimg.com` sends CORS

Measured 2026-07-22:

```
$ curl -sI -H "Origin: https://ticktune.net" https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
Timing-Allow-Origin: *
```

So the thumbnail canvas is **not tainted**, and the dominant-hue extraction in
`docs/03 §5` / `docs/06 §6` is implementable as written. `docs/15 §S1`'s risk
*"a tainted thumbnail canvas forces an ambient-background redesign in `03 §5`
before P5"* does not apply. Worth re-confirming in-browser with
`crossOrigin="anonymous"` when P5 builds it, but `ACAO: *` leaves little room.

## 🔴 Preliminary finding — a non-existent video reports **150**, not **100**

Measured 2026-07-22 in the harness, Chromium engine, local preview:

```
+   264ms  onReady — playing aaaaaaaaaaa
+   265ms  onError 150 → yt.err.blocked (TT-YT-101/150) — aaaaaaaaaaa
+  1891ms  onError 150 → yt.err.blocked (TT-YT-101/150) — ZZZZZZZZZZZ
```

`docs/06 §4` expects **`onError 100` → `yt.err.gone` (TT-YT-100)** for a
removed/private video, and maps **101/150** to *"Embedding disabled by owner"*.
Under that table, a user whose queued video is deleted mid-session would be told
**the owner disabled embedding** — the wrong cause, and the same shape of defect
as the 400-vs-404 finding above.

**Do not edit `docs/06 §4` from this alone.** It needs the confirmations below:
an id that *never existed* may well behave differently from a video that existed
and was removed, and Firefox has to agree. Both cases matter, because
`docs/02 §6` promises "stop → overlay 3 s → auto-advance" for TT-YT-100
specifically.

| Confirm | Expected | Result |
|---------|----------|--------|
| id that never existed (`aaaaaaaaaaa`), Chrome | 100 per the table; **measured 150** | 🔴 mismatch |
| same, Firefox | — | ⬜ |
| a **genuinely deleted** video, Chrome | 100 | ⬜ |
| same, Firefox | — | ⬜ |

## Still to run — needs a browser and the IFrame player

| Case | id | Expected | Result |
|------|-----|----------|--------|
| embed disabled by owner | _find one, see below_ | `onError 101/150` → `yt.err.blocked` | ⬜ |
| age-restricted | _find one, see below_ | `onError 101/150` (per `06 §4`) | ⬜ |
| region-blocked in VN | _find one, see below_ | `onError 101/150` or an unplayable state | ⬜ **must be confirmed from Vietnam** |
| deleted mid-session | see the finding above | `onError 100` → `yt.err.gone` | 🔴 see above |
| normal playback chain | `dQw4w9WgXcQ`, `jNQXAC9IVRw`, `9bZkp7q19f0` | queue of 3 advances hands-free after one gesture | ⬜ |
| controls at 384×216 **inside the real rail** | any | fully visible in every rail/Focus state | ⬜ |
| CSP: does the API load on the **deployed** site? | any | ready, with no violation row | ⬜ |
| `i.ytimg.com` CORS | any | — | ✅ see above |

### Finding the three ids

**Deliberately left blank rather than guessed.** A video's embed and age status
changes without notice, and a stale id would fail as *"embedding disabled"*
while actually being deleted — a green row for the wrong reason, which is worse
than an empty one.

- **Embed disabled** — on youtube.com, open a video and press *Share*. If there
  is no **Embed** option, the owner disabled embedding. Major-label music videos
  are the usual source. Confirm by pasting the id into the harness.
- **Age-restricted** — a video that shows *"Sign in to confirm your age"* in a
  private window. Do not sign in; the signed-out embed path is the subject.
- **Region-blocked in VN** — a video that shows *"Video này không khả dụng ở
  quốc gia của bạn"* **from a Vietnamese connection, with no VPN**. This is the
  one case nobody outside Vietnam can produce, which is why it is yours to run.

Fill in `id` and `Result` as each is run, paste the harness log into the PR, then
copy the outcome into `docs/06 §4` and the `docs/15` result table.
