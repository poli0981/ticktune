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
| `'pending'` | **yes** | YouTube-only, set when the oEmbed pre-check failed on the network rather than on the video (`06 §5` step 4, TT-YT-001). The video is probably fine; blocking Start on a flaky metadata lookup would be wrong. Re-checked **just after** Start — not inside it, which is what made this promise unkept for a phase (`06 §8`) — and if the cause turns out to belong to the video it becomes `'error'` and is dropped per `§6` |
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
  id: string;                 // crypto.randomUUID()
  source: TtSource;
  status: TtStatus;
  // Display metadata — text fallback "N/A", numeric fallback "–" at render time
  title: string;              // local: tag title → file name; yt: oEmbed title
  artist: string;             // local: tag artist; yt: channel name
  album?: string; year?: string; genre?: string; trackNo?: string;
  durationMs: number | null;  // null until known (YT: filled after cue)
  // Local only
  file?: File;                // session RAM; the sole owner of the bytes
  codec?: string; bitrateKbps?: number; sampleRateHz?: number;
  channels?: number; fileSizeBytes?: number; fileName?: string;
  coverArtUrl?: string;       // blob: URL from embedded picture, revoked on remove
  // YouTube only — declared here, WRITTEN by P4's importer (06 §5)
  videoId?: string;
  thumbnailUrl?: string;      // https://i.ytimg.com/vi/<id>/hqdefault.jpg
  sourceUrl?: string;         // original pasted URL
  addedAt: number;            // Date.now()
}
```

**`objectUrl` was removed from this interface in P3, not forgotten.** It had been
declared since the first revision and nothing ever wrote or read it: the media
URL lives in the object-URL ledger under the key `media:<trackId>` (`05 §3`),
which is what `§6`'s "revoke on removal" actually operates on. A field that
exists only to be `undefined` is the shape of this project's two escaped bugs —
`coverArtUrl` was declared, rendered and never written for a whole phase — so it
is deleted rather than left as a trap for whoever builds preloading.

Rendering rule (spec): any missing **text** field renders `N/A`; any missing
**numeric/duration** field renders `–`. Never render `undefined`/empty.

`id` was specified as a nanoid until P2. `crypto.randomUUID()` is native in every
target browser, equally opaque — so `12 §6`'s "safe to paste publicly" reasoning
about `trackId` is unaffected — and it removes a runtime dependency, a GPL-3.0
compatibility check and an attribution row while `legal/THIRD-PARTY-NOTICES.md`
is the project's one release blocker. The importer takes it as an injected port
so unit tests get deterministic ids.

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
  readonly schema: 2;

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
  schema: 2,
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
  visualizer: 'off',          // see the note below — 'ring' is the signature
                              // look (05 §6), not the starting one
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

**`visualizer` changed from `'ring'` to `'off'` on 2026-07-23, before P5's
renderer existed.** While nothing read the field the default cost nothing; the
day a renderer landed it would have cost something specific — every user whose
row already said `'ring'` would open the app to a moving graphic they never
chose, over a countdown designed legibility-first (`03 §1`). Changing it while
the field is still inert means no upgrade ever imposes it. `05 §6` still calls
ring the signature look: that is what the Settings panel offers, not what a
release turns on.

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

#### schema 1 → 2 (2026-07-23) — the stored `visualizer` is forgotten once

The only migration so far, and the reason one was needed is worth stating,
because it applies to **every default this suite ever changes**:

> Changing a default reaches nobody who has used the app before.

`load()` is `{ ...TT_DEFAULT_SETTINGS, ...storedRow }` — the row wins — and
`patch()` writes the **whole object**, not a delta. So accepting the legal gate
was enough to persist all 26 fields, and `visualizer: 'ring'` sat in every
existing user's row. Flipping the default to `'off'` would have applied to fresh
profiles and no one else.

Discarding the stored value is **not** overriding a preference: no control for
this field has ever shipped, so the value is a default `patch()` carried along
incidentally. That reasoning expires the moment `03 §6`'s Settings panel lands —
after which a stored value means something, and the migration must not be
extended to it. That boundary is why the marker is a version rather than a flag.

No Dexie `version(2)`: nothing is renamed, removed or retyped, which is exactly
the line drawn above.

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
Batch processed sequentially; ends with a summary toast ("Added 12 · Skipped 3")
— every skip gets a coded log entry.

```
0. PRE-SCAN the drop, once, before any per-file work:
   flatten via webkitGetAsEntry, recursing directories depth-first in
   Intl.Collator order
   entries > TT_DROP_MAX_ENTRIES (500) ....... fail → TT-IMP-008
   remaining capacity = cap(mode) - playable(queue).length
                                                  (Single 1 / Playlist 95)
   files beyond capacity ..................... fail → TT-IMP-004

for each File (within capacity):
  1. Extension/MIME allow-list  ............... fail → TT-IMP-001
     .mp3 .m4a .aac .flac .wav .ogg .oga .opus .webm
     + runtime audio.canPlayType() probe (browser matrix in 05 §4)
  2. music-metadata parseBlob → tags + duration + cover art (05 §5)
     Parse failure is non-fatal: keep track with file-name title ... TT-IMP-006
  3. durationMs (parse first, else loadedmetadata probe — 05 §5)
     durationMs > 602_000 (10:02) ............. fail → TT-IMP-002
  4. Aggregate check (Playlist mode only):
     total + durationMs > 5_460_000 (91:00) ... fail → TT-IMP-003
     `total` is seeded from playable(queue) — the SAME filter step 0 uses.
     Until P3 the two disagreed: an errored track freed a count slot but
     still spent its duration, which Single mode could never reach.
  5. Dedupe key `${name}::${size}::${durationMs}`
     (no full-content hashing — 95×~10 MB is too slow; heuristic is enough)
     duplicate → default skip + toast ......... log  → TT-IMP-005
     Setting "Allow duplicates" bypasses this check.
  6. push TtTrack{status:'ok'}
```

**Step 0 exists because the original ordering let unbounded work precede the
count cap:** the duration decode ran for every dropped file before the
`queue.length ≥ 95` check could reject any of it, so an N-file drop performed N
sequential probes to add at most 95 tracks — and in Single mode, at most one.
Hoisting the count cap into a pre-scan is the whole fix.

**Directories are recursed, not rejected.** The pipeline consumed `File` objects
only, so a dropped folder fell through step 1 and was logged as "unsupported
format", which is both wrong and unhelpful — the project's own test corpus is a
104-file folder. Two implementation hazards go with it, and both are silent
failures rather than errors: `DataTransfer.items` is **neutered** once the drop
handler returns or its first `await` resolves, so every `webkitGetAsEntry()`
handle must be taken synchronously first; and `FileSystemDirectoryReader
.readEntries()` yields **at most 100 entries per call** and must be re-called
until it returns empty — a single call truncates that 104-file corpus to 100
without complaint.

Also settled here, all previously undefined:

- **A second concurrent drop while a batch is in flight is ignored**, with a
  toast. Single-flight; no queue, no abort.
- **No cancel button** in v1.0 — the operation is bounded and sub-10-second
  (S3 measured 103 files in 1 362 ms). Revisit with Playlist.
- **The progress indicator** landed in P3 slice 2 — but the deferral's reason
  survived into its design. "Single mode imports one file at a median 11 ms; a
  spinner would flash" is not a scheduling note, it is a **requirement**: the
  bar appears only once a batch has been running past a threshold, so a one-file
  import still renders nothing. Shipping it as "visible while importing" would
  have been the flash the deferral was avoiding, and would have passed any test
  that merely checked the bar eventually appears. Both sides of the threshold
  are tested. The pipeline reports through an optional `onProgress` port, at the
  **top** of each iteration counting files already finished — every rejection
  leaves the loop early, so a call at the bottom would skip exactly the files a
  user most wants to watch go past.
- **Accepted files are kept when a later file trips a limit.** The loop is
  per-file and the summary toast reports both counts.

Single mode runs the same pipeline with `max items = 1` and no total-duration
aggregate; the **count cap applies in every mode** as part of step 0. A second
import in Single mode **replaces** the held track rather than being rejected:
`§1`'s `isQueueValid('single')` requires exactly one playable track, so rejecting
it would strand a user who simply wants a different track behind a remove
control they have not found yet.
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

### 5.1 Queue mutation during playback (decided 2026-07-22, P3)

`§3` named "playback order state" and stopped there, so the relationship between
the queue array the user drags in the `03 §2` Z4 rail and the Fisher–Yates order
above was undefined — an open 🟠 audit finding owned by P3. Three things in
particular had no answer: whether a drag regenerates, remaps or invalidates the
current shuffle cycle; whether toggling Shuffle mid-playback takes effect now or
at the next wrap; and whether the now-playing track stays current when rows move.

Whatever the first drag implementation did would have become the spec, so it is
written here first.

**Two orders, not one.**

| | Display order | Playback order |
|---|---|---|
| What it is | the `queue: TtTrack[]` array — what the rail shows and the user drags | a sequence of **track ids** |
| Shuffle OFF | — | **derived** from the queue array; no permutation is stored |
| Shuffle ON | — | a stored Fisher–Yates permutation of the playable ids |

**The cursor is `currentId: string`, not an index.** That single choice is what
makes rules 1–3 fall out rather than needing their own machinery.

1. **Drag-reorder.** Shuffle OFF: the next track changes immediately, because the
   playback order *is* the array. Shuffle ON: the drag moves the row only; the
   stored permutation is untouched. There is no "remap" case — remapping a
   permutation the user cannot see would change what plays next for no visible
   reason.
2. **Toggling Shuffle mid-playback takes effect immediately**, and the current
   track keeps playing. ON: build a fresh permutation with `currentId` pinned
   first. OFF: fall back to array order and continue from `currentId`'s position.
   "Takes effect at the next wrap" was rejected — a toggle that appears to do
   nothing reads as broken.
3. **The now-playing track always stays current** when any row moves, including
   itself. This is free: the cursor names a track, not a position.
4. **"No immediate repeat" (`§5`), defined.** After generating the new permutation
   on a wrap: if `next[0] === lastPlayedId` **and** `length ≥ 2`, swap `next[0]`
   with `next[1]`. Deterministic given the RNG, and therefore a unit test rather
   than a judgement call. At `length === 1` it is a no-op — a one-track playlist
   repeating itself is not a defect.
5. **Add / remove during playback reconciles, never regenerates.** Ids no longer
   in the queue are dropped from the stored permutation; ids not yet in it are
   appended. Regenerating on every import would reshuffle the unplayed remainder
   behind the user's back. Removing the current track advances first, then
   removes (`§6`, TT-USR-001).
6. **Exhaustion with Repeat OFF** is `§5`'s documented outcome and nothing more:
   media stops, **the countdown continues**, TT-PLY-102 is logged, and the bottom
   bar shows "Playlist ended". The timer and the media engine meet at exactly two
   points and this is not one of them (`04 §5`).

Only tracks passing `isPlayable` (`§1`) enter the playback order, so a track that
fails to decode mid-run (TT-PLY-101) is skipped by the next advance rather than
needing a special case.

## 6. Removal & failure paths (spec: "deleted from source")

With session-only storage, local `File` bytes live in RAM — they cannot vanish
mid-session when the on-disk original is deleted. The spec's intent is preserved
through these concrete paths:

| Event | If currently playing | If queued | Log |
|-------|----------------------|-----------|-----|
| Local track fails to decode/play (corrupt, revoked URL) | stop → auto-advance to next | mark `status:'error'`, auto-remove | TT-PLY-101 |
| ~~YouTube video deleted / made private mid-session (`onError` 100)~~ | **folded into the row below — see the note** | remove on next validation | TT-YT-100 |
| YouTube **anything** unplayable at play time — deleted, private, embed-off, age-restricted, region-blocked | overlay (typed) → auto-skip after 5 s | — | TT-YT-150 |
| User deletes track via UI | stop if current → advance | remove | TT-USR-001 |

All removals release the track's ledger entries — its media URL and its cover —
immediately (`05 §3`, `TtUrlLedger.releaseTrack`).

**Why the `onError 100` row folded — spike S1, 2026-07-22.** This table gave
deleted/private its own path ("stop → overlay 3 s → auto-advance") keyed on
`onError 100`. Measured across six causes and ten videos, **the player reports
`150` for every one of them and `100` was never seen**. Re-run cue-only against
*both* `youtube-nocookie.com` and `www.youtube.com` — 150 on both, so the host is
not the variable and the code is simply not reachable here.

The distinct 3 s path therefore had no trigger. It is not deleted for tidiness:
a path that can never run is worse than no path, because it reads as covered.
`06 §4` keeps the `100` row marked unobserved in case a genuine mid-run deletion
behaves differently — the one case S1 could not manufacture — but nothing may
depend on it firing.

**What replaces it:** deleted, private and embed-disabled are all distinguishable
from the **oEmbed status at import** (`06 §3`), which is strictly better — the
user learns why before the countdown starts, instead of watching a track fail.

**Single-mode carve-out.** "Auto-advance to next" has no next track when the
queue holds exactly one. So: media stops, the track is marked `status:'error'`
and shown as failed, TT-PLY-101 is logged — and **the countdown continues to
zero**. It does not stop, restart or absorb the failure, because the timer and
the media engine meet at exactly two points and this is not one of them
(`04 §5`). A countdown that quietly died because a file failed to decode would be
the worse bug.

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

`contextmenu` on a queue row → `preventDefault` → `TtContextMenu`. The menu's
items, named here because `13 §2`'s TtQueuePanel test and `13 §6`'s keyboard-only
journey both need something concrete to target:

| Item | Effect |
|------|--------|
| **Track info** | the modal below |
| **Move up** / **Move down** | reorder by one row — the keyboard-reachable equivalent of a drag (`03 §7` binds `Alt+↑/↓`). Disabled at the ends |
| **Remove** | `§6` user removal, TT-USR-001 |

Move up/down operate on the **display order** only; `§5.1` rule 1 governs what
that does to playback.

"Track info" opens a modal listing every known field: Title, Artist, Album, Year, Genre, Track #,
Duration, Codec/Container, Bitrate, Sample rate, Channels, File size, File name,
Source, Added at, Cover art — and for YouTube: Channel, Video ID, URL, Thumbnail,
Status. Missing values follow the `N/A` / `–` rule. Modal is fully keyboard
navigable (03 §8).
