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
  → 404/400 passthrough {error:"unavailable"}  (cached 15 min)
  → input validated: ^[A-Za-z0-9_-]{11}$ else 400
```

- Thumbnails render directly from `https://i.ytimg.com/vi/<id>/hqdefault.jpg`.
- Duration and publish date are **not** available without the Data API v3 —
  post-1.0 option (same Worker would hold the key server-side). v1 renders `–`
  until the player backfills duration.
- Abuse controls: Cloudflare rate-limiting rule on `/api/*` (`10 §6`); client
  throttles imports to 4 concurrent oEmbed checks.

## 4. Error matrix → typed overlays (spec: "custom pages")

The spec's per-condition "custom pages" are implemented as **typed overlay cards**
inside the player area — a routed page would break the running countdown.

| Signal | Meaning | Overlay (i18n key) | Action | Log |
|--------|---------|--------------------|--------|-----|
| URL regex fails / oEmbed 400 | Invalid link | `yt.err.invalid` | rejected at import | TT-YT-002 |
| oEmbed 404/401 at import | Deleted / private | `yt.err.gone` | rejected at import | TT-YT-100 |
| `onError 2` | Bad parameter | `yt.err.invalid` | skip after 5 s | TT-YT-002 |
| `onError 5` | HTML5 player failure | `yt.err.player` | retry once → skip | TT-YT-005 |
| `onError 100` | Removed/private mid-session | `yt.err.gone` | stop → 3 s → next (`02 §6`) | TT-YT-100 |
| `onError 101/150` | Embedding disabled by owner — **also the observed signal for age-restricted**; region blocks may surface here or as an unplayable state | `yt.err.blocked` (subtext lists embed-off / age / region as possible causes) | skip after 5 s | TT-YT-101 / TT-YT-150 |

Each overlay: icon, title, one-line cause, countdown-to-skip, "Skip now" button.
Exact signal↔cause mapping (esp. age vs region) is confirmed empirically in
**Spike S1** with a curated test-video list; this table is updated from its
findings.

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
