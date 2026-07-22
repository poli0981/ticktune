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

| Upstream | Meaning | Our Worker | Client action |
|----------|---------|------------|---------------|
| — (regex fails) | malformed shape, never sent upstream | `400 {"error":"invalid_id"}` | `yt.err.invalid`, TT-YT-002 |
| **400** | 11 chars but structurally impossible id | `400 {"error":"invalid_id"}` | `yt.err.invalid`, TT-YT-002 |
| **404** | well-formed id, no such video — deleted or never existed | `404 {"error":"not_found"}` | `yt.err.gone`, TT-YT-100 |
| **403** | private / unlisted | `403 {"error":"private"}` | `yt.err.gone`, TT-YT-100 |
| **401** | **embedding disabled by owner** | `401 {"error":"embed_off"}` | `yt.err.blocked`, TT-YT-101 |
| **200** | exists and is listed — says nothing about whether it will *play* | 200 + metadata | continue; see `§4` |
| **429** | our own edge rate limit, not YouTube's (`10 §6`) | passthrough `{"error":"rate_limited"}` | keep `status:'pending'`, TT-YT-001 |
| network failure | edge could not reach YouTube | `502 {"error":"upstream_unreachable"}` | keep `status:'pending'`, TT-YT-001 |

✅ **Both Worker changes landed in P4** (S1 having passed, the scope rule
released them):

1. **The 401 → 404 rewrite is gone.** 401 is *embed disabled*, not *deleted*;
   collapsing them told the user the wrong cause, and nothing downstream could
   recover it because the player reports `onError 150` for everything.
2. **The `error` body now names the cause**, from one shared vocabulary:
   `invalid_id` · `embed_off` · `private` · `not_found` ·
   `upstream_unreachable` · `unavailable`. The status passes through unchanged.

The map lives in **`src/lib/tt-yt-cause.ts`**, imported by *both* the Worker and
the app — `src/lib/` exists for exactly this, as `tt-domain-types.ts` explains:
two programs that must agree on a vocabulary should not each keep a copy. Its
truth table is unit-tested against S1's measurements, including the assertion
that 401 and 404 stay distinct.

`unavailable` survives as the fallback for a status nobody has measured. It
means "it failed and we do not know why", which is true; guessing a specific
cause there would put a confident wrong sentence in front of the user.

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

⚠️ **The last three rows are unobserved, and `100` is now believed unreachable.**
S1 re-tested it deliberately: the three ids whose oEmbed says *gone* (404),
*private* (403) and *embed-off* (401) were **cued without playing** against
**both** `youtube-nocookie.com` and `www.youtube.com`. All six combinations
returned **150**. So the host is not the variable and `100` does not appear for
the causes it documents.

The only case S1 could not manufacture is a video deleted *while it is already
playing*. `02 §6`'s separate 3 s path has therefore **folded into the 150 row**,
because a path with no trigger reads as covered while doing nothing. This row
stays only so a future observation has somewhere to land — **nothing may depend
on `100` firing**.

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
4. oEmbed pre-check via /api/yt/oembed
   ok       → TtTrack{status:'ok', title, artist=channel, thumbnailUrl}
   400      → rejected, malformed id                  log  → TT-YT-002
   401      → rejected, embedding disabled            log  → TT-YT-101
   403/404  → rejected, private or gone               log  → TT-YT-100
   429/502  → TtTrack{status:'pending'} kept          log  → TT-YT-001
   anything else → rejected, cause unknown            log  → TT-YT-004
5. durationMs stays null → rendered "–" until backfill (§2)
```

No per-track or total duration limits in this mode (spec) — so the queue
panel's totals row drops its `/ 91:00` denominator here rather than asserting a
ceiling nobody imposed. Batch ends with the standard summary toast.

**Only the transient causes keep the track.** Everything else is a property of
the video, so re-checking on Start would fail identically and rejecting now is
both honest and cheaper — the user learns before the countdown starts rather
than watching a track fail. That split is `ytCauseIsTransient` in
`src/lib/tt-yt-cause.ts`, shared with the Worker.

⚠️ **The 429 is our own edge, not YouTube's** (`docs/10 §6`), and its block page
carries no CORS header — so `res.json()` throws, and the browser may reject the
`fetch` outright with an opaque error indistinguishable from being offline. The
client therefore reads `res.status` **before** any body and treats a rejected
fetch as transient too (`tt-yt-driver.ts`). ⬜ **Whether the 60 req/min rule
exists in the zone at all is still unverified** — `docs/10 §11`'s checkbox is
unticked, so this path is implemented and unit-tested but not observed.

**Sources do not mix.** A queue is all-local or all-links, decided by the mode:
the caps differ (95 vs 50), the 91:00 aggregate is meaningless against durations
the player has not backfilled yet, and playback would have to hand the cursor
between an `HTMLAudioElement` and a cross-origin iframe while `§1.2` requires
the player visible throughout — including while a local file is the one making
sound. Switching mode keeps the queue and disables Start with its reason, which
is the `docs/03 §3` predicate Playlist → Single already uses.

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

## 8. Offline — specified in P4, because nothing else did

`docs/10 §9` carried the whole design in one sentence (*"`navigator.onLine` + a
failed-fetch probe drive a banner; entering YouTube mode while offline shows a
blocking panel (`yt.err.offline`); local modes keep working once loaded"*), and
this chapter did not mention offline at all. Everything below is decided here so
the first implementation does not become the spec by default.

**Trigger: `navigator.onLine` plus the `online`/`offline` events. No probe.**

`docs/10 §9` suggested a failed-fetch probe as well, and P4 deliberately does
not add one. The only same-origin endpoint worth probing is `/api/yt/oembed` —
which is the exact path the 60 req/min rule guards (`§6`), so a polling probe is
a self-inflicted 429. And a real signal already exists: an import that cannot
reach the edge returns `upstream_unreachable` and keeps its track as `pending`
(`§5`). `navigator.onLine` is a *hint* and is used as one; the import result is
the authority.

| Where | Behaviour |
|-------|-----------|
| Any mode, offline | A banner on Setup. Not dismissible — it clears itself when the browser reports a connection, because a dismissed banner would have to reappear anyway |
| **Local modes** | Nothing else. Files are in RAM (`02 §3`) and playback never touches the network, so an offline Playlist run is fully supported |
| **YouTube mode, offline** | Start is **blocked**, with the reason stated. Not "allowed and then failing": every track would report `onError 150` five seconds apart while the countdown ran, which is the worst version of this |
| Reconnect mid-session | The banner clears. Tracks left `pending` are not auto-re-checked — see below |

**The banner may not overlap the player rect.** `03 §2`'s carve-out and `§1.2`
apply to it exactly as they apply to any other overlay: it renders in the Setup
column, never over Z4.

⬜ **Not implemented, and stated rather than implied:** a `pending` track is not
re-checked on reconnect or on Start. `02 §1` promises "re-checked on Start", and
that promise is currently unkept — `session.start()` is synchronous by design
(making it async would break the autoplay gesture chain `05 §1` depends on), so
the re-check needs a shape nobody has designed. Until then a `pending` track is
simply attempted, and fails like any other if it was never going to work.
