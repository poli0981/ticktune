# 06 — YouTube Integration

Suite 2.0 · 2026-10-21 · Locked decision D1

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
5. **Attribution and identification** — the YouTube API Services duties, added
   P7 slice A after `AUDIT-BACKLOG` found this list silent on them. Three things
   follow from embedding the player, and all three are satisfied by *not*
   interfering rather than by adding anything:
   - **The player's own branding, title and controls are never hidden or
     covered.** Rule 2 already forbids obscuring the player, so this is the same
     requirement seen from the licence side rather than the layout side — which
     is why the `03 §2` carve-out is a compliance rule and not a design taste.
   - **Metadata is attributed to YouTube and never presented as ours.** Titles
     and author names come from oEmbed and are shown as the video's own; the
     track-info modal labels the source (`02 §8`). We never re-caption a video.
   - **Nothing derived from YouTube data is stored beyond the session or shown
     out of context.** The queue is session-only by design; oEmbed answers are
     cached at the edge for 6 h and are not a datastore.

   ⚠️ **The thumbnail ruling belongs here too.** `03 §5` once specified a
   blurred/recoloured `hqdefault` background. S1 proved the CORS objection was
   wrong — `i.ytimg.com` sends `ACAO: *`, so the canvas is untainted — which
   turned it from *impossible* into *a decision*. It stays unbuilt because
   modifying thumbnail imagery is exactly what the attribution duties constrain
   and the terms were never read. Generated gradients ship instead.

6. These rules are restated in `CLAUDE.md` so AI-assisted changes cannot drift.

## 2. Player lifecycle

- IFrame API script loaded lazily, when the player is first created — at the
  first YouTube-mode Start, after the rail has mounted (`yt.svelte.ts`;
  `https://www.youtube.com/iframe_api`, CSP-allowed, `09 §4`). Entering the
  mode alone loads nothing.
- **One** `YT.Player` instance, reused across the queue: `loadVideoById(nextId)`.
- **Created is not ready.** `new YT.Player()` returns at once, and its methods
  arrive only with `onReady`, a few hundred milliseconds later. Until v2.0 the
  10 Hz position tick read `getCurrentTime()` in that window and threw on every
  start, and the first video's volume went to a player that could not hear it.
  Nothing is read before `onReady` now (`TtYtPlayer.ready`, and the driver's
  façade goes through `live()`), a volume set meanwhile is applied in
  `onReady`, before the video starts, and a track opened meanwhile — a ⏭ or an
  `ENDED` in the first second — replaces the pending one instead of being lost
  while ready opened the first video again. The E2E stub is bare for 300 ms, as the
  real player is.
- Events: `onReady` → first cue; `onStateChange: ENDED` → advance per
  shuffle/loop; `PLAYING` → `getDuration()` backfills `durationMs` and
  `getVideoData()` backfills title/channel if oEmbed was incomplete;
  `onError` → §4.
- App transport maps ⏯ to `playVideo`/`pauseVideo`; ⏭/⏮/jump select the
  next id with `loadVideoById`, or `cueVideoById` while paused so a paused run
  stays silent (v1.1). The native controls remain usable too.
- Countdown `done` in YouTube mode: `pauseVideo()` + UI dim (no audio-graph fade
  available); chime still plays locally.

## 3. Metadata — oEmbed via edge proxy

`https://www.youtube.com/oembed` sends **no CORS headers**, so the browser cannot
call it. The static-assets Worker exposes:

```
GET /api/yt/oembed?id=<videoId>
  → edge fetch https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<id>&format=json
  → 200 {title, author_name, thumbnail_url}   (cached 6 h, caches.default)
  → upstream not-ok passthrough, cause named in the body (see the table below)
      · a verdict about the VIDEO (400/401/403/404) → cached 15 min
      · a TRANSIENT verdict (429, 5xx)             → uncached, max-age=0
  → input fails ^[A-Za-z0-9_-]{11}$      → 400 {error:"invalid_id"}   (uncached)
  → upstream unreachable or > 8 s        → 502 {error:"upstream_unreachable"} (uncached)
  → 200 whose body is not a JSON object  → 502 {error:"upstream_unreachable"} (uncached)
  → method is not GET                    → 405 {error:"method_not_allowed"}
  every response: application/json, X-Content-Type-Options: nosniff, NO CORS headers
```

**The cache key carries a version** (`CACHE_VERSION` in `worker/index.ts`). A hit
is returned verbatim, headers included, so an entry written by an older Worker
keeps that Worker's headers for its whole TTL. v1.1's own preview caught it:
after the CORS header was dropped, a GET still came back with v1.0's
`Access-Control-Allow-Origin: *` — from the cache — while a HEAD, which never
reaches it, carried the new headers. Bump the version whenever what is stored
changes shape or headers; old entries are then never read again.

**Same-origin only (v1.1).** The endpoint sent `Access-Control-Allow-Origin: *`
from its first version, on the belief that an error response without it would be
unreadable to the client. The client calls it on its **own** origin, where
responses are readable with no CORS header at all — so `*` only ever let other
websites use this Worker as a free, CORS-enabled oEmbed proxy, billed per request.
Both sides now bound the wait: the Worker gives youtube.com 8 s, the client
(`tt-yt-driver.ts`) gives the Worker 10 s, and either timeout is transient — the
track stays `pending`. A 200 that does not parse to an object (a challenge page,
a literal `null`) used to throw out of the handler and surface as Cloudflare's
1101 HTML page; it is reported as the transient it is.

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
| **429** | our own edge rate limit, not YouTube's (`10 §6`) | passthrough `{"error":"rate_limited"}`, **uncached** | keep `status:'pending'`, TT-YT-001 |
| **5xx** | oEmbed itself is having a bad minute | passthrough `{"error":"upstream_unreachable"}`, **uncached** | keep `status:'pending'`, TT-YT-001 |
| network failure | edge could not reach YouTube | `502 {"error":"upstream_unreachable"}` | keep `status:'pending'`, TT-YT-001 |

⚠️ **Corrected 2026-07-23.** A 5xx used to fall through to `unavailable`, which
`§5` treats as non-transient — so a YouTube outage did not fail an import, it
**rejected every pasted link**, and the 15-minute error cache then held that
verdict against a retry the user could not bypass. Two rules now hold together:
a status is only a cause if our own endpoint produced it (already true for the
`!res.ok` path, and true since this correction for an unparseable **200** as
well), and a cause we cannot attribute to the video is never cached.

✅ **Both Worker changes landed in P4** (S1 having passed, the scope rule
released them):

1. **The 401 → 404 rewrite is gone.** 401 is *embed disabled*, not *deleted*;
   collapsing them told the user the wrong cause, and nothing downstream could
   recover it because the player reports `onError 150` for everything.
2. **The `error` body now names the cause**, from one shared vocabulary:
   `invalid_id` · `embed_off` · `private` · `not_found` ·
   `upstream_unreachable` · `rate_limited` · `unavailable`. The status passes
   through unchanged.

The map lives in **`src/lib/tt-yt-cause.ts`**, imported by *both* the Worker and
the app — `src/lib/` exists for exactly this, as `tt-domain-types.ts` explains:
two programs that must agree on a vocabulary should not each keep a copy. Its
truth table is unit-tested against S1's measurements, including the assertion
that 401 and 404 stay distinct.

`unavailable` survives as the fallback for a status nobody has measured. It
means "it failed and we do not know why", which is true; guessing a specific
cause there would put a confident wrong sentence in front of the user.

- **No thumbnail is rendered by the app.** oEmbed's `thumbnail_url` is stored
  and appears only as a text row in track info; the images inside the player
  are the player's own, loaded by its frame under YouTube's policy, not ours.
  **`img-src https://i.ytimg.com` was removed in v2.0** after measuring it
  (`tests/manual/yt-matrix.md` has the run): Edge 155, the enforcing CSP under
  `wrangler dev`, real YouTube, two videos — the app's own document loaded
  nothing from `i.ytimg.com` with the origin allowed, and raised no violation
  without it. S1's one `i.ytimg.com` line was the embed's poster, a frame
  request. The run could not cover playback itself — YouTube refuses an
  automated browser (`150`) — so a playing session is a line of the v2.0 live
  checklist, on the preview, before the tag.
- Duration is **not** in oEmbed. Since v2.0 it comes from the Data API through
  the same Worker — `### Durations` below. Publish date is not fetched: nothing
  renders it.
- Abuse controls: Cloudflare rate-limiting rule on `/api/*` (`10 §6`); the client
  imports **strictly sequentially** — one oEmbed check at a time, awaited.

  ⚠️ **Corrected 2026-07-23.** This line claimed a throttle "to 4 concurrent
  oEmbed checks" and no such throttle has ever existed: `tt-yt-import.ts` is a
  plain `for…of` with an `await` inside, and `recheckPending` copies it. That is
  *stricter* than the doc promised, and it is what keeps a 50-link paste under
  the 60 req/min rule, so the code is right and the sentence was wrong. Do not
  "restore" the pool — a bounded-4 importer would put a 50-link paste much closer
  to a limit nobody has yet confirmed is even switched on (`10 §11`).

### Durations — YouTube Data API v3 (v2.0)

```
GET /api/yt/durations?ids=<id>,<id>,…        (1–50 ids, each ^[A-Za-z0-9_-]{11}$, deduped)
  → per id: caches.default first (key versioned, like oEmbed's)
  → misses, in ONE call: https://www.googleapis.com/youtube/v3/videos
        ?part=contentDetails&id=<misses>&fields=items(id,contentDetails/duration)
        header x-goog-api-key: <YT_DATA_API_KEY>   ← a Worker secret, never in a URL
        header Referer: https://ticktune.net/      ← what the key is restricted to
  → 200 {durations: {id: ms | null}}
        ms   ← contentDetails.duration (ISO 8601, src/lib/tt-iso-duration.ts)
        null ← P0D (live, unaired) or an id Google did not return (private, gone)
        each answer cached: a length 24 h, a null 15 min
  → no key on this deployment          → 503 {error:"not_configured"}  (Google never called)
  → over the per-IP budget (20/min)    → 429 {error:"rate_limited"}
  → upstream 4xx (quota, key refused)  → 503 {error:"upstream_refused"}
  → upstream 429/5xx                   → 503 {error:"upstream_unreachable"}
  → network failure or > 8 s           → 502 {error:"upstream_unreachable"}
  → 200 that is not {items: [...]}     → 502 {error:"upstream_unreachable"}
  → bad ids / method                   → 400 {error:"invalid_id"} / 405
  failures uncached; every response: application/json, nosniff, NO CORS headers
```

**Why at all.** oEmbed has no length, so until v2.0 a link's `durationMs` stayed
`null` until the player loaded it — the queue total read `–` and "Match queue
length" (`03 §3`) was disabled for every link queue by construction.

**The quota is the budget.** 10,000 units a day; `videos.list` costs one per call
whatever the number of ids, so the client asks **once per paste** for every link
still without a length (`ytDurationTargets`), and the per-id cache answers a
re-import for free. A per-IP Workers Rate Limiting binding (`10 §6`) sits in
front, counted in edge memory only; a limiter that fails lets the request
through, because the quota is the hard ceiling and spending it costs only this
convenience until midnight Pacific. The policies allow keeping API data up to
30 days; 24 h is far inside that.

**Every failure means the same to the app**, so the client reads none of the
words: `lookupDurations` returns `null`, **TT-YT-008** is logged once, lengths
stay `–`, and the player still backfills them on play — the v1 behaviour, at the
cost of a convenience. The words are for Workers Logs (`10 §10`), where "why is
Match disabled for links?" gets answered. Answers land through
`session.patchTrack`, which fills blanks only (a length the player backfilled
first wins) and ignores a row the user removed meanwhile.

**The key** is restricted in Google Cloud to the YouTube Data API v3 and to the
website `https://ticktune.net/*`; Google checks that against the Referer the
Worker sends, and Version URLs send the same one, so a PR's preview exercises
the real key. How it is set without deploying: `10 §3`.

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
| `onError 100` | Removed/private **mid-session** | `yt.err.gone` | skip after 5 s | TT-YT-100 |
| `onError 2` | Bad parameter | `yt.err.invalid` | skip after 5 s | TT-YT-002 |
| `onError 5` | HTML5 player failure | `yt.err.player` | skip after 5 s | TT-YT-005 |

Every code gets the same handling: one card, a visible countdown, and one
automatic skip after `OVERLAY_SKIP_MS` (5 s). Suite 1.0 specified a 3 s path
for `100` and a retry for `5`; neither was built, and a retry of an error the
player itself raised has never been observed to succeed.

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
3. Cap: the links shelf would exceed 50 (02 §3.5)    fail → TT-YT-003
4. oEmbed pre-check via /api/yt/oembed
   ok       → TtTrack{status:'ok', title, artist=channel, thumbnailUrl}
   400      → rejected, malformed id                  log  → TT-YT-002
   401      → rejected, embedding disabled            log  → TT-YT-101
   403/404  → rejected, private or gone               log  → TT-YT-100
   429/502  → TtTrack{status:'pending'} kept          log  → TT-YT-001
   anything else → rejected, cause unknown            log  → TT-YT-004
5. Lengths for every link still without one, ONE call (§3 Durations)
   ok       → durationMs filled (patchTrack: blanks only)
   failure  → durationMs stays null, "–" until backfill (§2)   log → TT-YT-008
```

No per-track or total duration limits in this mode (spec) — so the queue
panel's totals row drops its `/ 91:00` denominator here rather than asserting a
ceiling nobody imposed. Batch ends with the standard summary toast.

**The order above is the order the code runs.** Dedupe comes before the cap, so
a repeat never holds one of the free slots. Until v2.0 the code capped first,
and a duplicate could push a valid link further down the paste into TT-YT-003
while the queue still had room for it.

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
sound. Links and files live on **separate shelves** (`02 §3.5`, v2.0.1): the
YouTube tab shows only the links, Single and Playlist only the files, and
switching back finds the other shelf as it was left. Until v2.0.1 this said
"switching mode keeps the queue and disables Start" — but the predicate it
named had no source clause, so Start stayed enabled, a paste joined the files,
and Start played a file on the YouTube player: silence that never advanced.

## 6. Degraded visuals (platform limit)

No Analyser access to cross-origin media ⇒ no beat-reactive visualizer and no
beat-driven tally pulse in YouTube mode (`05 §6`). Substitutes: Z1's generated
gradient and a steady tally light — nothing derived from the thumbnail (`§1`
rule 5). Settings → Visualizer states the limit, so it never reads as a bug.

## 7. CSP + privacy touchpoints

- CSP additions (full policy in `09 §4`): `frame-src` youtube-nocookie.com +
  youtube.com; `script-src` www.youtube.com (iframe_api); no `img-src` origin
  since v2.0 (`§3`);
  `connect-src 'self'` covers the oEmbed proxy.
- Privacy Policy discloses: entering YouTube mode loads Google's player, which may
  set cookies/collect data per Google's privacy policy; local modes make no
  request to Google at all (`legal/PRIVACY-POLICY.md` §3 and §5). The only third
  party on every page, local modes included, is the disclosed Cloudflare
  beacon (`09 §1`).

## 8. Offline — specified in P4, because nothing else did

`docs/10 §9` carried the whole design in one sentence (*"`navigator.onLine` + a
failed-fetch probe drive a banner; entering YouTube mode while offline shows a
blocking panel (`yt.err.offline`); local modes keep working once loaded"*), and
this chapter did not mention offline at all. Everything below is decided here so
the first implementation does not become the spec by default.

**Trigger: the import result, with `navigator.onLine` as a hint. No probe.**

⚠️ **Corrected 2026-07-23, from the live v0.5.0 run.** This section already said
`navigator.onLine` "is a *hint* and is used as one; the import result is the
authority" — and only the hint was ever implemented. What that cost, measured:
the user turned their network off, every link imported as `N/A` (which happens
only when the lookup fails), and **the banner never appeared**, because Chrome
reports `onLine` from whether a network interface is up rather than from whether
anything is reachable. Start was not blocked either.

`reachedEdge()` (`tt-yt-import.ts`) now returns the verdict the batch actually
supports:

| Evidence | Verdict |
|----------|---------|
| A track imported, **or** the edge named a refusal (TT-YT-100/101/004) | **online** — a cause is only nameable if our own endpoint produced it |
| Every attempt returned TT-YT-001 (transient) | **offline** |
| Nothing touched the network — all malformed, all duplicates, all over-cap | **no verdict.** Not the same as offline; treating it as offline would raise the banner on a good connection |

The re-check (`§8` below) applies the same rule per answer, which is what clears
the banner when a connection returns. The hint still clears it optimistically on
an `online` event, and the next lookup corrects that if it was wrong.

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
| Reconnect mid-session | The banner clears. Tracks left `pending` are not re-checked *here* — the re-check runs on Start, see below |

**The banner may not overlap the player rect.** `03 §2`'s carve-out and `§1.2`
apply to it exactly as they apply to any other overlay: it renders in the Setup
column, never over Z4.

✅ **The re-check on Start is implemented (2026-07-23).** `02 §1` promised it
from revision 1 and nothing did it, while the TT-YT-001 toast told the user
*"Chưa kiểm tra được — sẽ thử lại khi bắt đầu"* to their face. The block that
stood here recorded the honest reason — `session.start()` is synchronous by
design, because `05 §1`'s autoplay chain is broken by the first `await` — and
concluded that "the re-check needs a shape nobody has designed".

**The shape is that it is not part of Start at all.** `start()` returns
synchronously and the gesture is spent on `playVideo()`; the shell then calls
`session.recheckPending()` **without awaiting it**. Answers patch the queue as
they land, which is safe because the cursor is a track id (`02 §5.1`) and not an
index.

| Outcome | What happens |
|---------|--------------|
| Resolves 2xx | `pending` → `ok`, blank title/channel filled from the response, **TT-YT-006** |
| A cause that belongs to the video (400/401/403/404) | marked `error`, which drops it from `order` via `isPlayable` and strikes the row through (`02 §6`), **TT-YT-007** |
| Still transient (429, 5xx, unreachable) | left `pending`. One retry, not a spin |

Three things it does **not** do, each for a stated reason: it never touches the
track that is playing; it skips a track whose status changed or that was removed
while its answer was in flight; and it is sequential, matching the importer, for
the 60 req/min rule in `§6`.

⬜ **Still not implemented:** a re-check on *reconnect*. `navigator.onLine` is a
hint (`§8` above), and the natural trigger — Start — is now covered.
