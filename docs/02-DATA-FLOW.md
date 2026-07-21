# 02 — Data Flow

Suite 1.0 · 2026-07-21

## 1. App state machine

```
 boot ──► gate ──► setup ──► playing ⇄ paused ──► finished
            │        ▲          │                    │
            │        │          └── Stop ────────────┤
            │        └── "Edit setup" / Back ────────┘
            │                       restart ─────────┘
            └─ blocked (mobile gate, terminal)
```

| State | Meaning | Allowed transitions |
|-------|---------|---------------------|
| `boot` | Island mounted, settings loading from Dexie | → `gate` (first run / legal version bumped) or → `setup` |
| `gate` | Blocking legal gate (`legal/*`). The **Accept click is the user gesture** that unlocks autoplay: `AudioContext.resume()` is called here. | → `setup` |
| `setup` | Choose mode, set countdown, build queue. Validation runs continuously. Start is enabled iff `isReady` (below). | → `playing` (Start, only while `isReady`) |
| `playing` | Countdown running, media playing. | ⇄ `paused`, → `finished`, → `setup` (Stop) |
| `paused` | Countdown frozen (remaining stored), media paused. | ⇄ `playing`, → `setup` (Stop) |
| `finished` | Countdown hit 0; End Behavior executed. | → `setup` (Back), → `playing` (Restart, same queue) |

`blocked` is not an app state — the mobile gate (`07`) is a pre-boot DOM overlay
and the island never mounts behind it. It is drawn above only to show it is
terminal.

### `ready` is a predicate, not a state

Earlier revisions listed a `ready` state between `setup` and `playing`. It was a
phantom: no screen in `03 §3`, no component in `13 §2`, no E2E flow in `13 §3`,
and — fatally — no edge back to `setup`, so a user who staged a queue had no
specified way to add or remove a track. `03 §3` has always put the Start button
on the **Setup** screen.

It is therefore a derived boolean on `setup`, gating the Start button:

```ts
const MIN_QUEUE: Record<TtMode, number> = { single: 1, playlist: 1, youtube: 1 };

/** A track is startable if it is not known-broken. */
function isPlayable(t: TtTrack): boolean {
  return t.status !== 'error';     // 'pending' counts — see below
}

function isQueueValid(mode: TtMode, queue: TtTrack[]): boolean {
  const playable = queue.filter(isPlayable);
  if (playable.length < MIN_QUEUE[mode]) return false;
  if (mode === 'single')   return playable.length === 1;
  if (mode === 'playlist') return playable.length <= 95;
  return playable.length <= 50;    // youtube
}

const isReady = isQueueValid(mode, queue)
  && countdownMs >= 1_000 && countdownMs <= 86_400_000;
```

Status semantics at the Start boundary:

| `status` | Counts toward validity? | Rationale |
|----------|------------------------|-----------|
| `'ok'` | yes | — |
| `'pending'` | **yes** | YouTube-only, set when the oEmbed pre-check failed on the network rather than on the video (`06 §5` step 4, TT-YT-001). The video is probably fine; blocking Start on a flaky metadata lookup would be wrong. Re-checked on Start; if it then resolves 404 it becomes `'error'` and is dropped per `§6` |
| `'error'` | **no** | Known-broken. Excluded from the count, and shown struck-through in the queue so the user sees why Start is disabled |

If a queue drops below validity while sitting on Setup (user removes the last
track), Start simply disables again — no state transition, which is the whole
point of making this a predicate.

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

### 3.1 `TtSettings` — the persisted shape (authoritative)

`03 §6` is the UI grouping; **this is the data contract**. Every control there
maps to exactly one field here. Ranges are clamped on read as well as on write —
a hand-edited IndexedDB row must not be able to produce an invalid app.

```ts
type TtMode        = 'single' | 'playlist' | 'youtube';
type TtLang        = 'vi' | 'en';
type TtBackground  = 'solid' | 'gradient' | 'image' | 'slideshow' | 'cover';
type TtSlideXfade  = 'fade' | 'kenburns';
type TtSize        = 's' | 'm' | 'l';
type TtVisualizer  = 'off' | 'bars' | 'wave' | 'ring';
type TtLoopStyle   = 'hard' | 'crossfade';

interface TtSettings {
  /** Schema marker. Bumped only by a migration (see 3.2). */
  readonly schema: 1;

  // ── General ───────────────────────────────────────────────────────────────
  lang: TtLang;
  lastMode: TtMode;
  legalAccepted: { version: string; acceptedAt: number } | null;

  // ── Display (03 §6 Display) ───────────────────────────────────────────────
  background: TtBackground;
  gradientPreset: 0 | 1 | 2 | 3 | 4 | 5;   // the "6 presets"
  gradientCustom: [string, string] | null;  // two #rrggbb stops; null ⇒ use preset
  slideshowIntervalMs: number;              // 5_000 – 60_000
  slideshowTransition: TtSlideXfade;
  scrimStrength: number;                    // 0.35 – 0.60, the 03 §2 Z1 range
  scrimAuto: boolean;                       // true ⇒ contrast sampling may RAISE
                                            //   scrimStrength; it never lowers it
  scanlines: boolean;
  autoTheme: boolean;                       // 03 §5

  // ── Countdown (03 §6 Countdown) ───────────────────────────────────────────
  glowIntensity: number;                    // 0 – 1, scales the 3 shadow alphas
  countdownSize: TtSize;                    // s/m/l → 14vw / 18vw / 22vw
  endFadeMs: number;                        // 0 – 5_000
  endChime: boolean;
  endFlash: boolean;
  endAction: 'stay' | 'restart' | 'loop';   // see 3.3

  // ── Visualizer ────────────────────────────────────────────────────────────
  visualizer: TtVisualizer;
  visualizerSensitivity: number;            // 0.5 – 2.0, linear gain on band energy

  // ── Audio ─────────────────────────────────────────────────────────────────
  volume: number;                           // 0 – 1
  muted: boolean;
  crossfadeMs: number;                      // 0 – 5_000; 0 = hard cut
  singleLoopStyle: TtLoopStyle;             // 05 §2

  // ── Playback ──────────────────────────────────────────────────────────────
  shuffle: boolean;
  repeatPlaylist: boolean;
  allowDuplicates: boolean;
}

export const TT_DEFAULT_SETTINGS: TtSettings = {
  schema: 1,
  lang: 'vi',                 // VI is the default UI (08); overridden at first
                              //   boot by navigator.language per 08 §2
  lastMode: 'playlist',       // §1 first-run default
  legalAccepted: null,
  background: 'gradient',
  gradientPreset: 0,
  gradientCustom: null,
  slideshowIntervalMs: 10_000,
  slideshowTransition: 'fade',
  scrimStrength: 0.45,
  scrimAuto: true,
  scanlines: true,
  autoTheme: true,            // 03 §5
  glowIntensity: 0.8,
  countdownSize: 'm',
  endFadeMs: 2_000,           // 03 §6
  endChime: true,             // D4
  endFlash: false,
  endAction: 'stay',
  visualizer: 'ring',         // the signature look (05 §6)
  visualizerSensitivity: 1.0,
  volume: 0.8,
  muted: false,
  crossfadeMs: 2_000,         // 03 §6
  singleLoopStyle: 'hard',    // 05 §2
  shuffle: false,
  repeatPlaylist: true,       // 03 §6
  allowDuplicates: false,     // 03 §6
};
```

Values whose defaults `03 §6` did not state (`volume`, `background`,
`gradientPreset`, `slideshowIntervalMs`, `slideshowTransition`, `scrimStrength`,
`scanlines`, `glowIntensity`, `countdownSize`, `visualizer`,
`visualizerSensitivity`, `shuffle`, `endFlash`) are fixed here. `03 §6` defers to
this table; do not restate them there.

`prefers-reduced-motion` does **not** rewrite these values — it suppresses
scanlines, Ken Burns, the visualizer and the tally pulse at render time (`03 §8`).
The stored preference survives, so turning the OS setting off restores the
user's choices.

### 3.2 Dexie schema & upgrade policy

```ts
// state/settings.svelte.ts
const db = new Dexie('ticktune');
db.version(1).stores({ settings: 'key' });   // key-path store, one singleton row
// row shape: { key: 'app', ...TtSettings }
```

One row, primary key `'app'`. A keyed store rather than a free key/value table so
a settings read is a single `get('app')` and the whole object is typed as
`TtSettings` — no per-key parsing, no partial-write races.

**Upgrade policy — additive only for v1.x.** New fields are added to
`TtSettings` with a default in `TT_DEFAULT_SETTINGS`; the read path is
`{ ...TT_DEFAULT_SETTINGS, ...storedRow }`, so a row written by an older build
gains new fields with their defaults and needs no Dexie version bump. A Dexie
`version(2)` is required only to **rename or remove** a field, or to change its
type. `schema` exists to make that boundary explicit and greppable.

Corrupt or unreadable row ⇒ fall back to `TT_DEFAULT_SETTINGS`, log `TT-SYS-204`,
and rewrite. Never block boot on settings (`§1`: `boot` must always reach `gate`
or `setup`).

### 3.3 End Behavior vs Repeat — precedence

`03 §6` listed both "Repeat playlist (default ON)" and "behavior when playlist
ends early (silence / loop)". Those overlap: with repeat ON the playlist cannot
end early, and "loop" when repeat is OFF just *is* repeat. Resolved by deleting
the redundant control — `repeatPlaylist` is the only knob, and `§5`'s documented
outcome (silence, countdown continues, TT-PLY-102) is what happens when it is OFF.

`endAction` covers the separate question of what happens **at zero**, and is
mutually exclusive by construction rather than three overlapping booleans:

| `endAction` | Behavior at zero |
|-------------|------------------|
| `'stay'` | Finished screen, media stopped (default) |
| `'restart'` | Re-run the same countdown with the same queue, once |
| `'loop'` | Re-run indefinitely until the user stops |

`endFadeMs`, `endChime` and `endFlash` are orthogonal and apply to all three.
"Silence-only" is not a fourth mode — it is `endChime: false` with
`endFadeMs: 0`.

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
