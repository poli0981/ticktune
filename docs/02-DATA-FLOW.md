# 02 — Data Flow

Suite 1.0 · 2026-07-21

## 1. App state machine

```
 boot ──► gate ──► setup ──► ready ──► playing ⇄ paused ──► finished
            │        ▲                    │                    │
            │        └── "Edit setup" ────┘   (countdown = 0)  │
            └─ blocked (mobile gate, terminal)   restart ──────┘
```

| State | Meaning | Allowed transitions |
|-------|---------|---------------------|
| `boot` | Island mounted, settings loading from Dexie | → `gate` (first run / not accepted) or → `setup` |
| `gate` | Blocking legal gate (`legal/*`). The **Accept click is the user gesture** that unlocks autoplay: `AudioContext.resume()` is called here. | → `setup` |
| `setup` | Choose mode, set countdown, build queue. Validation runs here. | → `ready` when queue valid ∧ countdown set |
| `ready` | Everything staged; big Start button. | → `playing` |
| `playing` | Countdown running, media playing. | ⇄ `paused`, → `finished`, → `setup` (Stop) |
| `paused` | Countdown frozen (remaining stored), media paused. | ⇄ `playing`, → `setup` |
| `finished` | Countdown hit 0; End Behavior executed. | → `setup`, → `ready` (restart same session) |

Mode default: **Playlist** on first run (spec). Last-used mode is remembered in
settings thereafter.

## 2. Track model

```ts
type TtSource = 'local' | 'youtube';
type TtStatus = 'ok' | 'pending' | 'error';

interface TtTrack {
  id: string;                 // nanoid
  source: TtSource;
  status: TtStatus;
  // Display metadata — text fallback "N/A", numeric fallback "–" at render time
  title: string;              // local: tag title → file name; yt: oEmbed title
  artist: string;             // local: tag artist; yt: channel name
  album?: string; year?: string; genre?: string; trackNo?: string;
  durationMs: number | null;  // null until known (YT: filled after cue)
  // Local only
  file?: File;                // session RAM; the sole owner of the bytes
  objectUrl?: string;         // created lazily on play, revoked on remove/replace
  codec?: string; bitrateKbps?: number; sampleRateHz?: number;
  channels?: number; fileSizeBytes?: number; fileName?: string;
  coverArtUrl?: string;       // blob: URL from embedded picture, revoked on remove
  // YouTube only
  videoId?: string;
  thumbnailUrl?: string;      // https://i.ytimg.com/vi/<id>/hqdefault.jpg
  sourceUrl?: string;         // original pasted URL
  addedAt: number;            // Date.now()
}
```

Rendering rule (spec): any missing **text** field renders `N/A`; any missing
**numeric/duration** field renders `–`. Never render `undefined`/empty.

## 3. Session model (D3: session-only)

- `session.svelte.ts` holds `mode`, `queue: TtTrack[]`, `countdownMs`, playback
  order state. It lives in memory only.
- **Persisted** (Dexie `ticktune` DB, table `settings`): language, theme/background
  choice, visualizer style, end behavior, volume, crossfade, shuffle/repeat flags,
  legal-gate acceptance `{version, acceptedAt}`, last-used mode.
- **Never persisted:** files, object URLs, queue contents, YouTube link lists.
- `beforeunload` guard: if `queue.length > 0` or state ∈ {playing, paused}, show the
  native confirm dialog. Object URLs are revoked on `pagehide`.

## 4. Import pipeline (local files)

Entry points: drag-drop anywhere on Setup, or file picker (`accept` list below).
Batch processed sequentially with a progress indicator; ends with a summary toast
("Added 12 · Skipped 3") — every skip gets a coded log entry.

```
for each File:
  1. Extension/MIME allow-list  ............... fail → TT-IMP-001
     .mp3 .m4a .aac .flac .wav .ogg .oga .opus .webm
     + runtime audio.canPlayType() probe (browser matrix in 05 §4)
  2. Decode duration (metadata first, else loadedmetadata probe)
     durationMs > 602_000 (10:02) ............. fail → TT-IMP-002
  3. Aggregate checks (Playlist mode only):
     total + durationMs > 5_460_000 (91:00) ... fail → TT-IMP-003
     queue.length ≥ 95 ........................ fail → TT-IMP-004
  4. Dedupe key `${name}::${size}::${durationMs}`
     (no full-content hashing — 95×~10 MB is too slow; heuristic is enough)
     duplicate → default skip + toast ......... log  → TT-IMP-005
     Setting "Allow duplicates" bypasses this check.
  5. music-metadata parseBlob → tags + cover art (05 §5)
     Parse failure is non-fatal: keep track with file-name title ... TT-IMP-006
  6. push TtTrack{status:'ok'}
```

Single mode runs the same pipeline with `max items = 1` and no aggregate step.
YouTube import pipeline is defined in `06-YOUTUBE-INTEGRATION.md §5` (cap 50,
dedupe by `videoId`, oEmbed pre-check via `/api/yt/oembed`).

## 5. Playback flow

```
playing:
  countdown ticks independently of media (04-TIMER-ENGINE.md)
  media chain by mode:
    Single   → loop one track (hard loop default; optional crossfade-loop)
    Playlist → next per order (shuffle: Fisher–Yates, reshuffle on wrap,
               no immediate repeat) ; "Repeat playlist" default ON
               Repeat OFF ∧ playlist exhausted before 0 → silence, countdown
               continues, log TT-PLY-102, bottom bar shows "Playlist ended"
    YouTube  → player queue advance on state ENDED; loop/shuffle toggles apply
  countdown reaches 0 → transition finished → End Behavior (03-UI-SPEC.md §6):
    fade media (default 2 s, equal-power), optional chime, Finished screen,
    optional flash / silence / auto-restart / countdown loop
```

## 6. Removal & failure paths (spec: "deleted from source")

With session-only storage, local `File` bytes live in RAM — they cannot vanish
mid-session when the on-disk original is deleted. The spec's intent is preserved
through these concrete paths:

| Event | If currently playing | If queued | Log |
|-------|----------------------|-----------|-----|
| Local track fails to decode/play (corrupt, revoked URL) | stop → auto-advance to next | mark `status:'error'`, auto-remove | TT-PLY-101 |
| YouTube video deleted / made private mid-session (`onError` 100) | stop → overlay 3 s → auto-advance | remove on next validation | TT-YT-100 |
| YouTube embed blocked / age / region at play time | overlay (typed) → auto-skip after 5 s | — | TT-YT-101/150 |
| User deletes track via UI | stop if current → advance | remove | TT-USR-001 |

All removals revoke `objectUrl`/`coverArtUrl` immediately.

## 7. Log & diagnostics

- Ring buffer, capacity **500**, in-memory. Entry:
  `{ ts, level: 'info'|'warn'|'error', code: 'TT-XXX-nnn', message, trackId? }`
- Code registry lives in `12-CODE-STANDARDS.md §6` (single source of truth).
- Global capture: `window.onerror` + `unhandledrejection` append `TT-SYS-*` entries.
- Settings → Diagnostics: log viewer (filter by level), **Copy Diagnostics** button
  producing JSON: `{ app:'TickTune', version, ua, mode, settings-snapshot,
  last 50 log entries, captured console errors }` — this is what the bug template
  (`.github/ISSUE_TEMPLATE/bug_report.yml`) asks the reporter to paste.

## 8. Right-click metadata modal (spec)

`contextmenu` on a queue row → `preventDefault` → `TtContextMenu` → "Track info"
opens a modal listing every known field: Title, Artist, Album, Year, Genre, Track #,
Duration, Codec/Container, Bitrate, Sample rate, Channels, File size, File name,
Source, Added at, Cover art — and for YouTube: Channel, Video ID, URL, Thumbnail,
Status. Missing values follow the `N/A` / `–` rule. Modal is fully keyboard
navigable (03 §8).
