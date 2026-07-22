# 06 — YouTube Integration

Suite 1.0 · 2026-07-21 · Locked decision D1

## 1. Compliance rules (non-negotiable)

1. Playback only through the **official IFrame Player API**, host
   `https://www.youtube-nocookie.com` (privacy-enhanced mode).
2. The player is **always visible** while a YouTube track plays: fixed slot in the
   right rail at **384×216** (ToS floor is 200×200; 16:9 chosen so native controls
   render fully). Nothing may overlap or obscure it; Focus mode keeps the player
   visible (rail stays, rest hides) while in YouTube mode.
3. **Never** extract, proxy, cache, or re-stream audio/video. No `yt-dlp`-class
   tooling anywhere in the project.
4. Playback starts only from a user gesture chain (gate Accept → Start), so
   programmatic `playVideo()` is within autoplay policy.
5. These rules are restated in `CLAUDE.md` so AI-assisted changes cannot drift.

## 2. Player lifecycle

- IFrame API script loaded lazily on first entry into YouTube mode
  (`https://www.youtube.com/iframe_api`, CSP-allowed, §09).
- **One** `YT.Player` instance, reused across the queue: `loadVideoById(nextId)`.
- Events: `onReady` → first cue; `onStateChange: ENDED` → advance per
  shuffle/loop; `PLAYING` → `getDuration()` backfills `durationMs` and
  `getVideoData()` backfills title/channel if oEmbed was incomplete;
  `onError` → §4.
- App transport (Space/⏯ etc.) maps to `playVideo/pauseVideo/nextVideo` — the
  native controls remain usable too.
- Countdown `done` in YouTube mode: `pauseVideo()` + UI dim (no audio-graph fade
  available); chime still plays locally.

## 3. Metadata — oEmbed via edge proxy

`https://www.youtube.com/oembed` sends **no CORS headers**, so the browser cannot
call it. The static-assets Worker exposes:

```
GET /api/yt/oembed?id=<videoId>
  → edge fetch https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<id>&format=json
  → 200 {title, author_name, thumbnail_url}   (cached 6 h, caches.default)
  → upstream not-ok passthrough {error:"unavailable"}  (cached 15 min)
  → input fails ^[A-Za-z0-9_-]{11}$      → 400 {error:"invalid_id"}   (uncached)
  → upstream unreachable                 → 502 {error:"upstream_unreachable"} (uncached)
  → method is not GET                    → 405 {error:"method_not_allowed"}
```

⚠️ **Corrected 2026-07-22 by spike S1 — the previous rule here was wrong, and
wrong in a way that mattered.**

This section used to say *"YouTube answers a well-formed but non-existent video
id with HTTP 400, not 404 … read the `error` field, not the status."* That was
measured with the ids `aaaaaaaaaaa` and `ZZZZZZZZZZZ`, and **neither is a
well-formed video id**. An 11-character YouTube id is base64url over 64 bits, so
the final character carries only 4 bits and can only be one of
`A E I M Q U Y c g k o s w 0 4 8`. Both samples end outside that set, so they
were *structurally impossible*, not *non-existent* — and the conclusion drawn
from them never tested the thing it claimed to.

Re-measured across the whole alphabet, 26 ids, **no exceptions**: every id whose
final character is in that set returns **404**; every id whose final character is
outside it returns **400**. So the original status-based rule was right all
along, and the status **is** the signal:

| Upstream | Meaning | Our Worker today | Client action |
|----------|---------|------------------|---------------|
| — (regex fails) | malformed shape, never sent upstream | `400 {"error":"invalid_id"}` | `yt.err.invalid`, TT-YT-002 |
| **400** | 11 chars but structurally impossible id | `400 {"error":"unavailable"}` | `yt.err.invalid`, TT-YT-002 |
| **404** | well-formed id, no such video — deleted or never existed | `404 {"error":"unavailable"}` | `yt.err.gone`, TT-YT-100 |
| **403** | private / unlisted | `403 {"error":"unavailable"}` | `yt.err.gone`, TT-YT-100 |
| **401** | **embedding disabled by owner** | ⚠️ `404` — the Worker rewrites 401→404 | `yt.err.blocked`, TT-YT-101 |
| **200** | exists and is listed — says nothing about whether it will *play* | 200 + metadata | continue; see `§4` |
| network failure | edge could not reach YouTube | `502 {"error":"upstream_unreachable"}` | keep `status:'pending'`, TT-YT-001 |

**Two Worker changes are owed to P4** (not made here — `15 §Scope rule` holds
YouTube code behind S1, and this is the finding, not the fix):

1. **Stop rewriting 401 → 404** (`worker/index.ts`, the `res.status === 401 ?
   404 : res.status` expression). 401 is *embed disabled*, not *deleted*, and
   collapsing them tells the user the wrong cause.
2. **Emit a distinct `error` per case** instead of `"unavailable"` for
   everything non-2xx. The sentence *"This is why the Worker emits distinct
   `error` values"* was aspirational: it emits exactly three
   (`invalid_id`, `unavailable`, `upstream_unreachable`), and the only one that
   carries cause is the one our own regex produces.

Until both land, a client that classifies on the `error` field — which the old
rule above told it to do — can distinguish **nothing**.

- Thumbnails render directly from `https://i.ytimg.com/vi/<id>/hqdefault.jpg`.
- Duration and publish date are **not** available without the Data API v3 —
  post-1.0 option (same Worker would hold the key server-side). v1 renders `–`
  until the player backfills duration.
- Abuse controls: Cloudflare rate-limiting rule on `/api/*` (`10 §6`); client
  throttles imports to 4 concurrent oEmbed checks.

## 4. Error matrix → typed overlays (spec: "custom pages")

The spec's per-condition "custom pages" are implemented as **typed overlay cards**
inside the player area — a routed page would break the running countdown.

**Rewritten 2026-07-22 from spike S1's measured run** (10 videos, 6 distinct
causes, `tests/manual/yt-matrix.md`). The headline result inverts the old table's
premise:

> ### 🔴 `onError` does not discriminate. Every failure is **150**.
>
> Private, age-restricted, region-blocked, deleted, structurally-invalid and
> embed-disabled all reported `onError 150` — six causes, one code. **`onError
> 100` did not fire once.** A taxonomy keyed on the player's error code
> therefore has exactly two outcomes, "played" and "did not play", however many
> rows it lists.
>
> The **oEmbed status is where the cause actually lives** (`§3`), and it is
> available at *import* — before the countdown starts, which is a better place
> to tell the user anyway.

### Import time — the oEmbed status is the classifier

| Signal | Meaning | Overlay (i18n key) | Action | Log |
|--------|---------|--------------------|--------|-----|
| URL regex fails, or `400 {"error":"invalid_id"}` | Malformed link | `yt.err.invalid` | rejected at import | TT-YT-002 |
| **400** from upstream | 11 chars, structurally impossible id | `yt.err.invalid` | rejected at import | TT-YT-002 |
| **404** | Deleted, or never existed | `yt.err.gone` | rejected at import | TT-YT-100 |
| **403** | Private / unlisted | `yt.err.gone` | rejected at import | TT-YT-100 |
| **401** | **Embedding disabled by owner** | `yt.err.blocked` | rejected at import | TT-YT-101 |
| `502 {"error":"upstream_unreachable"}` | Edge could not reach YouTube | none — keep the track | TT-YT-001 |

Three of those — deleted, private, embed-off — were previously only discoverable
at play time. They are now caught before Start, which is the real win from S1.

### Play time — what oEmbed cannot see

| Signal | Meaning | Overlay | Action | Log |
|--------|---------|---------|--------|-----|
| `onError 150` after a **200** oEmbed | **Age-restricted or region-blocked — genuinely indistinguishable.** Both return 200 with full title and channel, then refuse to play | `yt.err.blocked`, subtext naming both as possible causes | skip after 5 s | TT-YT-150 |
| `onError 100` | Removed/private **mid-session** | `yt.err.gone` | stop → 3 s → next (`02 §6`) | TT-YT-100 |
| `onError 2` | Bad parameter | `yt.err.invalid` | skip after 5 s | TT-YT-002 |
| `onError 5` | HTML5 player failure | `yt.err.player` | retry once → skip | TT-YT-005 |

⚠️ **The last three rows are unobserved.** S1 could not produce 2, 5 or 100 — in
particular it could not delete a video mid-run, which is the only way `100` is
supposed to arise. `02 §6`'s TT-YT-100 path is therefore built on a signal that
has never been seen firing; if P4 finds it never fires either, that path folds
into the 150 row and `02 §6` needs revisiting.

The age-vs-region ambiguity is **not** a gap to close later — it is the measured
result. The subtext naming both causes, which this table already required, turns
out to be the only honest wording available.

Each overlay: icon, title, one-line cause, countdown-to-skip, "Skip now" button.

## 5. Import pipeline (YouTube mode)

Input: textarea paste (one URL per line) and/or repeated single adds.

```
1. Extract videoId per line — accepted shapes:
   watch?v= · youtu.be/ · shorts/ · live/ · embed/ · music.youtube.com/watch?v=
   (11-char id regex; extra params ignored)          fail → TT-YT-002
2. Dedupe by videoId (default skip + toast)          dup  → TT-IMP-005
3. Cap: queue would exceed 50 links                  fail → TT-YT-003
4. oEmbed pre-check via /api/yt/oembed (4 concurrent)
   ok  → TtTrack{status:'ok', title, artist=channel, thumbnailUrl}
   404 → rejected with toast                         log  → TT-YT-100
   net-fail → TtTrack{status:'pending'} kept; re-checked on Start  TT-YT-001
5. durationMs stays null → rendered "–" until backfill (§2)
```

No per-track or total duration limits in this mode (spec). Batch ends with the
standard summary toast.

## 6. Degraded visuals (platform limit)

No Analyser access to cross-origin media ⇒ no beat-reactive visualizer and no
beat-driven tally pulse in YouTube mode (`05 §6`). Substitutes: blurred
`hqdefault` thumbnail background, slow gradient drift, steady tally light.
Stated plainly on the landing FAQ so it never reads as a bug.

## 7. CSP + privacy touchpoints

- CSP additions (full policy in `09 §4`): `frame-src` youtube-nocookie.com +
  youtube.com; `script-src` www.youtube.com (iframe_api); `img-src` i.ytimg.com;
  `connect-src 'self'` covers the oEmbed proxy.
- Privacy Policy discloses: entering YouTube mode loads Google's player, which may
  set cookies/collect data per Google's privacy policy; local modes contact no
  third party (`legal/PRIVACY-POLICY.md §4`).
