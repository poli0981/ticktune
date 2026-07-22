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

The harness still shows a **CSP-violation box** if one ever fires. That box would
be a FINDING, not a broken harness — but see below: the case it was built for
has already been checked and did not happen.

## ✅ Closed: the CSP carries the player, and `s.ytimg.com` is not involved

Measured 2026-07-22 on `https://ticktune.net/spike/s1-youtube/`, real browser,
deployed CSP:

```
+   115ms  IFrame API ready
+  1763ms  onStateChange 1 (playing) — dQw4w9WgXcQ
violations: []

resources loaded:
  script  https://www.youtube.com/iframe_api
  script  https://www.youtube.com/s/player/<build>/www-widgetapi.vflset/www-widgetapi.js
  iframe  https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ
  other   https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/mqdefault.webp
```

The audit predicted that `www-widgetapi.js` comes from `s.ytimg.com` and that
`docs/09 §4` would therefore break the player. **It comes from
`www.youtube.com`**, which `script-src` already allows. No CSP row is needed and
no privacy-policy disclosure follows. `AUDIT-BACKLOG` updated with the
refutation.

## ✅ RUN 2026-07-22 — Chrome 151 / Windows, deployed site, 1 gesture

10 ids, 6 distinct causes, **9 hands-free advances from 1 gesture**, no CSP
violations, no `⚠️ UNKNOWN` bucket. Acceptance items for the playback chain and
the taxonomy's completeness both pass. The *content* of the taxonomy does not.

| id | Cause | oEmbed (YouTube) | our `/api` | `onError` |
|----|-------|------------------|-----------|-----------|
| `l2jmBhzMons` | private / unlisted | **403** | 403 `unavailable` | **150** |
| `-pvEyYU5-08` | age-restricted | **200** + full metadata | 200 + metadata | **150** |
| `8dLS8_xM2LI` | age-restricted | **200** + full metadata | — | **150** |
| `x8mLnM-oD_s` | region-blocked (VN-only, run from a foreign IP) | **200** + full metadata | — | **150** |
| `jNQXAC9IVRw` | normal | 200 | 200 | plays ✅ |
| `9bZkp7q19f0` | normal | 200 | 200 | plays ✅ |
| `abcdefghijk` | well-formed, no such video | **404** | 404 `unavailable` | **150** |
| `0000000000` | 10 chars — malformed | 400 | 400 `invalid_id` | **150** |
| `______1111` | 10 chars — malformed | 400 | — | **150** |
| `dt7N1Yw-DVI` | embedding disabled | **401** | ⚠️ **404** `unavailable` | **150** |

### 🔴 Finding 1 — `onError` discriminates nothing

Six causes, one code. **`onError 100` never fired.** Any overlay taxonomy keyed
on the player's error code has two real outcomes: played, or did not. `docs/06
§4` is rewritten around this.

### ✅ Finding 2 — oEmbed *does* discriminate, and our Worker throws it away

YouTube answers **400 / 401 / 403 / 404** for four different causes. Our Worker
flattens every one of them to the body `{"error":"unavailable"}` **and rewrites
401 → 404** (`worker/index.ts`), so embed-disabled is reported as deleted. Since
`docs/06 §3` had been changed to classify on that body, the app could
distinguish nothing at all. Two Worker changes are now owed to P4.

The upside: deleted, private and embed-off are all knowable at **import**, before
the countdown starts — better than failing at play time.

### 🔴 Finding 3 — the earlier "400, not 404" finding was measured on bad ids, and I re-verified it wrongly

The section below recorded, on 2026-07-21, that *"YouTube answers a non-existent
video with 400, not 404"*, and `docs/06 §3`/`§4` were changed to classify on the
`error` body because of it. Both samples were `aaaaaaaaaaa` and `ZZZZZZZZZZZ`.

An 11-character YouTube id is base64url over 64 bits, so its **final character
carries only 4 bits** and can only be one of `A E I M Q U Y c g k o s w 0 4 8`.
Both samples end outside that set — they are *structurally impossible*, not
*non-existent*, so they never tested the claim.

Measured across the whole alphabet, `abcdefghij<c>`, 26 ids, **no exceptions**:

```
final char in the 16-value set  → 404  (A E I M Q U Y c g k o s w 0 4 8)
final char outside it           → 400  (a b d z Z 1 2 9 _ - …)
```

So **400 = structurally invalid, 404 = well-formed but gone**, and the original
status-based mapping was right before it was "fixed".

⚠️ **I re-verified this matrix on 2026-07-22 by re-curling the same two bad
ids** and reported it confirmed. Re-running a bad sample confirms nothing; the
error survived a check that looked like diligence. The lesson is cheap to state
and was not applied: a negative sample has to be *valid* in every respect except
the one under test.

## Verified by oEmbed — the original 2026-07-21 list

| id | Case | oEmbed | Notes |
|----|------|--------|-------|
| `dQw4w9WgXcQ` | normal | 200 | Rick Astley — Never Gonna Give You Up |
| `jNQXAC9IVRw` | normal | 200 | "Me at the zoo" — the oldest video on the site, stable |
| `9bZkp7q19f0` | normal | 200 | PSY — Gangnam Style |
| `M7lc1UVf-VE` | normal | 200 | YouTube's own IFrame API demo video |
| `aaaaaaaaaaa` | ~~no such video~~ **structurally invalid** | **400** `{"error":"unavailable"}` | ⚠️ mislabelled here on 2026-07-21; ends in `a`, which cannot terminate an id |
| `ZZZZZZZZZZZ` | ~~no such video~~ **structurally invalid** | 400 `{"error":"unavailable"}` | same mistake, same reason |
| `xxx` | malformed | 400 `{"error":"invalid_id"}` | rejected by our regex, never reaches YouTube |

### ~~Finding: a deleted video is a 400, not a 404~~ — **RETRACTED 2026-07-22**

Kept here rather than deleted, because the shape of the mistake is the useful
part. This concluded that YouTube answers a non-existent video with **400**, and
`§3`/`§4` were rewritten to classify on the `error` body instead of the status.

Both samples (`aaaaaaaaaaa`, `ZZZZZZZZZZZ`) end in a character that **cannot
terminate a valid YouTube id**, so they were malformed rather than missing and
the claim was never tested. See Finding 3 above: well-formed-but-gone is a
**404**, and the mapping this replaced was correct.

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

## ~~Preliminary finding — 150 not 100~~ — superseded

Folded into **Finding 1** above, which measured it across six causes instead of
one and reached a stronger conclusion: the code does not discriminate at all.

## Remaining — what S1 still owes

| Case | Result |
|------|--------|
| embed disabled (`dt7N1Yw-DVI`) | ✅ oEmbed **401**, `onError` 150 |
| age-restricted (`-pvEyYU5-08`, `8dLS8_xM2LI`) | ✅ oEmbed **200**, `onError` 150 |
| region-blocked (`x8mLnM-oD_s`, VN-only id from a foreign IP) | ✅ oEmbed **200**, `onError` 150 |
| private / unlisted (`l2jmBhzMons`) | ✅ oEmbed **403**, `onError` 150 |
| deleted / never existed (`abcdefghijk`) | ✅ oEmbed **404**, `onError` 150 |
| normal playback chain | ✅ 9 hands-free advances from 1 gesture |
| no `⚠️ UNKNOWN` bucket | ✅ |
| CSP on the deployed site | ✅ |
| `i.ytimg.com` CORS | ✅ |
| controls at 384×216 inside the rail, across rail/Focus states | ✅ measured — see below. **Both naive states violate the ToS** |
| `onError 100` | ✅ **believed unreachable** — see below |
| Firefox | ✅ same results (user-run) |

**The region case is answered, by an inversion worth recording.** Rather than
finding a video blocked *in* Vietnam, a **Vietnam-only** video was played from a
**foreign IP**. Same signal, and it sidesteps the "needs Vietnam" constraint that
had blocked this row since the spike was written. The complementary direction —
a foreign-only video played from Vietnam — is still untested, but since every
failure mode reports 150 the discrimination question does not depend on it.

### If you run more ids

Paste them into `/spike/s1-youtube` and send the log. What would change a
conclusion above: **any `onError` that is not 150**, and especially a real
`onError 100`.

## Appendix — how the three hard ids were found

Kept for whoever re-runs this when statuses rot:

- **Embed disabled** — on youtube.com, open a video and press *Share*. No
  **Embed** option means the owner disabled it.
- **Age-restricted** — shows *"Sign in to confirm your age"* in a private
  window. Do not sign in; the signed-out embed path is the subject.
- **Region-blocked** — either a video unavailable in your country, or (as used
  here) a video available **only** in your country, played from elsewhere.

Statuses change without notice, so re-verify an id before trusting a row built
on it — a stale id fails as *"embedding disabled"* while actually being deleted,
which is a green row for the wrong reason.


## ✅ Closed 2026-07-22 — controls in the rail, and `onError 100`

### Controls at 384×216, and what the rail states do to them

Player box measured while a video was **playing**, on the deployed harness:

| Rail state | Player box | Computed | Video |
|------------|-----------|----------|-------|
| normal | **384×216** exactly | `display: grid`, opacity 1 | playing |
| **collapsed** | **0×0** | **`display: none`** | **still playing** |
| **Focus** | 384×216 | **opacity 0.06** | **still playing** |

Native controls render fully at 384×216 in the normal state — title, scrubber,
elapsed/total, volume, settings, YouTube wordmark, all inside the box.

Both other states leave **audio running with the player hidden**, which is what
`docs/06 §1.2` forbids. That is the *expected* result: the harness implements the
naive behaviour on purpose, so `docs/03 §2`'s carve-out is proven load-bearing
rather than assumed. Recorded there.

⚠️ **Implementation trap for P4:** `checkVisibility({checkOpacity: true})`
returned **`true`** for the 0.06-opacity player. It only catches opacity *0*, so
it cannot be the guard. Assert the computed opacity and the box.

### `onError 100` — not reachable

Cued **without playing** on **both** hosts, three causes each:

```
nocookie  abcdefghijk  404 gone/never-existed -> onError 150
nocookie  l2jmBhzMons  403 private            -> onError 150
nocookie  dt7N1Yw-DVI  401 embed-off          -> onError 150
regular   abcdefghijk  404 gone/never-existed -> onError 150
regular   l2jmBhzMons  403 private            -> onError 150
regular   dt7N1Yw-DVI  401 embed-off          -> onError 150
```

Six for six. The host is **not** the variable — `youtube-nocookie` is not
collapsing codes that the regular host would distinguish. `onError 100` does not
appear for the causes YouTube documents it for.

The one case that remains unmanufacturable is a video deleted *while already
playing*. `docs/02 §6`'s separate TT-YT-100 path has folded into the 150 row
accordingly: a path with no trigger reads as covered while doing nothing.
