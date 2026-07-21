# YouTube test matrix — spike S1

Curated list for `docs/15 §S1`. Every id here must map to exactly one documented
overlay in `docs/06 §4`, with no "unknown" bucket left over.

`oEmbed` below is what `GET /api/yt/oembed?id=<id>` returns; `onError` is what
the IFrame player reports at play time. **They are independent signals** — a
video can pass the oEmbed check and still refuse to play embedded, which is the
entire reason the matrix has two columns.

## Verified by oEmbed (2026-07-21, against the live endpoint)

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

## Still to run — needs a browser and the IFrame player

These cannot be settled by oEmbed; they only appear as `onError` at play time,
and the last one is region-dependent.

| Case | id | Expected | Result |
|------|-----|----------|--------|
| embed disabled by owner | _TBD_ | `onError 101/150` → `yt.err.blocked` | ⬜ |
| age-restricted | _TBD_ | `onError 101/150` (per `06 §4`) | ⬜ |
| region-blocked in VN | _TBD_ | `onError 101/150` or an unplayable state | ⬜ **must be confirmed from Vietnam** — cannot be verified from another region |
| deleted **mid-session** | `aaaaaaaaaaa` | `onError 100` → `yt.err.gone` | ⬜ |
| normal playback chain | `dQw4w9WgXcQ`, `jNQXAC9IVRw`, `9bZkp7q19f0` | queue of 3 advances hands-free after one gesture | ⬜ |
| controls at 384×216 **inside the real rail** | any | fully visible in every rail/Focus state | ⬜ |
| `i.ytimg.com` CORS | any | record whether `Access-Control-Allow-Origin` is present — without it the thumbnail canvas is tainted and `03 §5` auto-theme is unimplementable | ⬜ |

Fill in `id` and `Result` as each is run, then copy the outcome into
`docs/06 §4` and the `docs/15` result table.
