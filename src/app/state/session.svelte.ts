import type { TtMode } from '../../lib/tt-domain-types';
import { browserImportPorts, filesFromDataTransfer } from '../engine/importer/tt-import-driver';
import { importFiles } from '../engine/importer/tt-import';
import { isPlayable, isReady, matchQueueLengthMs } from '../engine/importer/tt-queue-rules';
import type { TtImportResult, TtTrack } from '../engine/importer/types';
import { ttLog } from '../engine/log/tt-log';
import {
  nextInOrder,
  pinFirst,
  prevInOrder,
  reconcile,
  shuffleIds,
  withoutImmediateRepeat,
} from '../engine/queue/tt-play-order';
import { ytCauseIsTransient } from '../../lib/tt-yt-cause';
import { browserYtPorts } from '../engine/youtube/tt-yt-driver';
import { importLinks } from '../engine/youtube/tt-yt-import';
import { finishReport } from '../engine/timer/tt-late';
import { TT_MAX_COUNTDOWN_MS, TT_MIN_COUNTDOWN_MS } from '../engine/timer/tt-format';
import type { TtFinishInfo, TtFinishReport } from '../engine/timer/types';
import { playback } from './playback.svelte';
import { settings } from './settings.svelte';

/**
 * Session state — docs/02 §1 and §3.
 *
 * Everything here dies with the tab, by design. **No Dexie import appears in
 * this file**, and that is the point rather than an accident: hard invariant 1
 * says user media never leaves the browser and the queue is never persisted, so
 * the module that owns the queue is kept structurally unable to persist it.
 * Preferences live in settings.svelte.ts, which is the only module that talks to
 * IndexedDB.
 *
 * P3 imports that store — for `shuffle`, `repeatPlaylist`, `allowDuplicates` and
 * `lastMode` — and the guarantee above still holds, but for a sharper reason
 * than "no import": `patch()` takes a `Partial<TtSettings>`, and `TtSettings`
 * has no field a queue could be written to. The queue is unpersistable by type,
 * not by import hygiene. Reading `settings.current` touches no database at all —
 * the Dexie handle is created lazily inside load/patch/reset.
 *
 * The state machine is docs/02 §1's, minus the parts that need a queue:
 *
 *     boot ──► gate ──► setup ──► playing ⇄ paused ──► finished
 *                         ▲          │                    │
 *                         └── stop ──┴──── back ──────────┤
 *                                          restart ───────┘
 *
 * P2 slice S2 owns the transitions the timer alone can make. `queue`, and the
 * `isReady` half that depends on it (docs/02 §1's `isQueueValid`), arrive with
 * the importer — at which point `canStart` gains a second clause and nothing
 * else here changes.
 */

/*
 * Not exported: consumers reach it through `session.state`, and knip fails the
 * build on unused exports (docs/12 §5). It gets exported by the slice whose
 * components actually name the type — the Setup/Player router.
 */
type TtAppState = 'boot' | 'gate' | 'setup' | 'playing' | 'paused' | 'finished';

/** What `advance()` did, so the caller can load, wrap or fall silent. */
type TtAdvance = 'advanced' | 'wrapped' | 'exhausted';

/**
 * How long an import must still be running before its progress bar appears.
 *
 * docs/02 §4 deferred the indicator out of P2 with a reason — "Single mode
 * imports one file at a median 11 ms; a spinner would flash" — and shipping it
 * in P3 without a threshold would reintroduce exactly that flash on every
 * one-file import. So the bar is not "shown while importing", it is "shown while
 * an import is taking long enough to be worth reporting". S3 measured 103 files
 * in 1 362 ms, so a 95-file batch clears this comfortably and a single file
 * never does.
 */
const PROGRESS_DELAY_MS = 400;

class SessionStore {
  #state = $state<TtAppState>('boot');
  #countdownMs = $state(90_000);
  #finish = $state<TtFinishReport | null>(null);
  #queue = $state<TtTrack[]>([]);
  #importing = $state(false);
  #lastImport = $state<TtImportResult | null>(null);

  /** Live counts from the pipeline. Null except during a batch. */
  #progress = $state<{ done: number; total: number } | null>(null);
  /** Flipped by the PROGRESS_DELAY_MS timer — see the constant's note. */
  #progressVisible = $state(false);
  #progressTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * P2 pinned this to `single` because Playlist was not built. P3 unlocks it and
   * `adoptMode` seats the remembered value at boot — `lastMode` was never
   * clobbered precisely so that this would be an unlock rather than a repair
   * (docs/03 §3).
   */
  #mode = $state<TtMode>('single');

  /**
   * The playback cursor — a TRACK ID, never an index. docs/02 §5.1 turns on
   * this: "does the now-playing track stay current when rows move" stops being
   * a question the moment the cursor names a track instead of a position.
   */
  #currentId = $state<string | null>(null);

  /**
   * The stored Fisher-Yates permutation, or **null when Shuffle is off** — in
   * which case playback order is not stored at all, it is simply the queue
   * array. That is what makes a drag change the next track for free (docs/02
   * §5.1 rule 1) instead of needing a remap.
   */
  #shuffled = $state<string[] | null>(null);

  /** docs/02 §5.1 rule 6 — the order ran out and Repeat is off. */
  #exhausted = $state(false);

  /**
   * docs/06 §8. A HINT, not the authority — the browser reports `true` for a
   * captive portal too. The authority is what an import actually got back, and
   * that is why there is no polling probe: the only endpoint worth probing is
   * the one the rate limit guards.
   */
  #online = $state(true);

  get mode(): TtMode {
    return this.#mode;
  }

  get state(): TtAppState {
    return this.#state;
  }

  get queue(): TtTrack[] {
    return this.#queue;
  }

  get importing(): boolean {
    return this.#importing;
  }

  /** The last batch's outcome, for the summary toast (docs/02 §4). */
  get lastImport(): TtImportResult | null {
    return this.#lastImport;
  }

  /**
   * docs/02 §4's progress indicator — null until the batch has been running for
   * PROGRESS_DELAY_MS, so a fast import shows nothing at all.
   *
   * The gate lives here rather than in the component because "is this worth
   * showing" is a rule, and a component that receives counts and decides for
   * itself is a rule nobody can unit-test.
   */
  get progress(): { done: number; total: number } | null {
    return this.#progressVisible ? this.#progress : null;
  }

  /** docs/02 §5.1 rule 6 — bottom bar shows "Playlist ended"; timer runs on. */
  get exhausted(): boolean {
    return this.#exhausted;
  }

  /**
   * The track the player is on.
   *
   * Before Start there is no cursor yet, so this falls back to the first
   * playable track — which is what the Single-mode staged row has always shown.
   * The final `#queue[0]` keeps an errored single track visible rather than
   * making it vanish from Setup the moment it fails (docs/02 §1: an errored
   * track is *shown* struck-through, not hidden).
   */
  get current(): TtTrack | null {
    const seated =
      this.#currentId === null ? null : (this.#queue.find((t) => t.id === this.#currentId) ?? null);
    return seated ?? this.#queue.find(isPlayable) ?? this.#queue[0] ?? null;
  }

  /**
   * The raw cursor, for the queue panel's highlight.
   *
   * Distinct from `current` on purpose: `current` falls back so Setup always has
   * something to show, whereas nothing should be highlighted before Start.
   */
  get currentId(): string | null {
    return this.#currentId;
  }

  /** Playback order: the stored permutation, else the queue's own order. */
  get order(): readonly string[] {
    return this.#shuffled ?? this.#playableIds();
  }

  get canPrev(): boolean {
    return this.#mode !== 'single' && prevInOrder(this.order, this.#currentId) !== null;
  }

  get canNext(): boolean {
    return this.#mode !== 'single' && this.order.length > 1;
  }

  get countdownMs(): number {
    return this.#countdownMs;
  }

  set countdownMs(ms: number) {
    this.#countdownMs = ms;
  }

  /** Null except on the Finished screen. docs/04 §2. */
  get finish(): TtFinishReport | null {
    return this.#finish;
  }

  /**
   * docs/02 §1: `ready` is a predicate on `setup`, not a state. An earlier
   * revision listed it as one, which left a user who had staged a queue with no
   * specified way back to edit it.
   */
  get canStart(): boolean {
    // docs/06 §8 — YouTube mode needs the network. Blocking here beats letting
    // Start succeed and then reporting onError 150 on every track, five seconds
    // apart, while the countdown runs.
    if (this.#mode === 'youtube' && !this.#online) return false;
    return isReady(this.#mode, this.#queue, this.#countdownMs);
  }

  /** docs/06 §8 — `navigator.onLine`, used as the hint it is. */
  get online(): boolean {
    return this.#online;
  }

  setOnline(online: boolean): void {
    this.#online = online;
  }

  /** True when only the countdown is out of range — for the input's own hint. */
  get countdownInRange(): boolean {
    return this.#countdownMs >= TT_MIN_COUNTDOWN_MS && this.#countdownMs <= TT_MAX_COUNTDOWN_MS;
  }

  /** docs/03 §3 — null when the button must be disabled. */
  get matchableMs(): number | null {
    return matchQueueLengthMs(this.#queue);
  }

  // ── mode (docs/02 §1, docs/03 §3) ─────────────────────────────────────────

  /**
   * Boot: adopt the remembered mode.
   *
   * P4 ships YouTube, so all three are honoured and the fallback is gone. It
   * had to go with the tab: `setMode` writes `lastMode`, so a user who picked
   * YouTube got it persisted and then silently rewritten to Playlist on every
   * single reload — the preference saved correctly and never came back.
   */
  adoptMode(lastMode: TtMode): void {
    this.#mode = lastMode;
  }

  /**
   * A user picked an enabled tab. Only this path writes `lastMode` (docs/03 §3).
   *
   * The queue is **not** touched, including Playlist → Single with 95 tracks
   * staged: docs/02 §1 makes readiness a predicate, so an invalid queue simply
   * re-disables Start with its reason on screen. Truncating would discard the
   * user's work silently; refusing the tab would strand them mid-decision.
   */
  setMode(mode: TtMode): void {
    if (mode === this.#mode) return;
    this.#mode = mode;
    this.#syncOrder();
    void settings.patch({ lastMode: mode });
  }

  // ── playback order (docs/02 §5.1) ─────────────────────────────────────────

  #playableIds(): string[] {
    return this.#queue.filter(isPlayable).map((t) => t.id);
  }

  /**
   * Reconcile, never regenerate — docs/02 §5.1 rule 5.
   *
   * Called after every queue mutation. A no-op when Shuffle is off, because
   * there is nothing stored to drift.
   */
  #syncOrder(): void {
    if (this.#shuffled !== null) this.#shuffled = reconcile(this.#shuffled, this.#playableIds());
  }

  /** Seat the cursor at the head of a freshly built order. Start and Restart. */
  #seat(): void {
    this.#exhausted = false;
    const ids = this.#playableIds();
    this.#shuffled = settings.current.shuffle ? shuffleIds(ids, Math.random) : null;
    this.#currentId = (this.#shuffled ?? ids)[0] ?? null;
  }

  /**
   * docs/02 §5.1 rule 2 — takes effect **immediately**, and the current track
   * keeps playing.
   *
   * "At the next wrap" was rejected in the spec: a toggle that appears to do
   * nothing reads as broken. Pinning `#currentId` first is what makes "immediate"
   * mean "reorder the future", not "cut off the present".
   */
  setShuffle(on: boolean): void {
    this.#shuffled = on
      ? pinFirst(shuffleIds(this.#playableIds(), Math.random), this.#currentId)
      : null;
    void settings.patch({ shuffle: on });
  }

  setRepeat(on: boolean): void {
    if (on) this.#exhausted = false;
    void settings.patch({ repeatPlaylist: on });
  }

  /**
   * Advance to the next track — docs/02 §5 / §5.1 rule 6.
   *
   * Returns what happened rather than acting on it: loading media is the
   * player's business and docs/12 §3.3 keeps data flowing one way.
   */
  advance(): TtAdvance {
    // docs/02 §6's Single-mode carve-out: "auto-advance to next" has no next
    // when the queue holds exactly one. Media stops; the countdown continues,
    // because the timer and the media engine meet at two points and this is not
    // one of them (docs/04 §5).
    if (this.#mode === 'single') {
      this.#exhausted = true;
      return 'exhausted';
    }

    const next = nextInOrder(this.order, this.#currentId);
    if (next !== null) {
      this.#currentId = next;
      return 'advanced';
    }

    if (this.order.length === 0 || !settings.current.repeatPlaylist) {
      this.#exhausted = true;
      // docs/02 §5: silence, the countdown continues, and the bottom bar says so.
      if (this.order.length > 0) ttLog.warn('TT-PLY-102', '');
      return 'exhausted';
    }

    // Wrap. docs/02 §5's "reshuffle on wrap, no immediate repeat" is a property
    // of SHUFFLE, so an unshuffled playlist simply returns to its own head.
    const ids = this.#playableIds();
    if (this.#shuffled !== null) {
      this.#shuffled = withoutImmediateRepeat(shuffleIds(ids, Math.random), this.#currentId);
    }
    this.#currentId = (this.#shuffled ?? ids)[0] ?? null;
    return 'wrapped';
  }

  /** ⏮. False when there is nowhere to go — it does not wrap (docs/02 §5.1). */
  prev(): boolean {
    const target = prevInOrder(this.order, this.#currentId);
    if (target === null) return false;
    this.#currentId = target;
    this.#exhausted = false;
    return true;
  }

  /** Double-click a queue row. Ignores ids that are not playable. */
  jumpTo(id: string): boolean {
    if (!this.order.includes(id)) return false;
    this.#currentId = id;
    this.#exhausted = false;
    return true;
  }

  // ── import (docs/02 §4) ────────────────────────────────────────────────────

  /**
   * Single-flight. A second drop while a batch is in flight is IGNORED with a
   * toast rather than queued or aborted (docs/02 §4) — the operation is bounded
   * and sub-second, so the simplest defined behaviour is the right one.
   */
  async importDropped(dt: DataTransfer): Promise<void> {
    if (this.#importing) return;
    const { files, dropped } = await filesFromDataTransfer(dt);
    await this.#runImport(files, dropped);
  }

  async importPicked(list: FileList | null): Promise<void> {
    if (this.#importing || !list) return;
    await this.#runImport(Array.from(list), 0);
  }

  /**
   * docs/06 §5 — paste one or more YouTube links.
   *
   * **Sources do not mix.** A queue is all-local or all-YouTube, decided by the
   * mode, and this guard is where that holds: the caps differ (95 vs 50), the
   * 91:00 aggregate is meaningless for videos whose duration is unknown until
   * the player backfills it, and playback would have to hand the cursor back
   * and forth between an `HTMLAudioElement` and a cross-origin iframe — with
   * the ToS requiring the player visible throughout, including while a local
   * file is the one making sound. Switching mode keeps the queue and disables
   * Start instead (docs/03 §3), which is the same predicate Playlist → Single
   * already uses.
   */
  async importLinks(text: string): Promise<void> {
    if (this.#importing || this.#mode !== 'youtube' || text.trim() === '') return;

    this.#importing = true;
    this.#progress = { done: 0, total: 0 };
    this.#progressVisible = false;
    this.#progressTimer = setTimeout(() => {
      if (this.#importing) this.#progressVisible = true;
    }, PROGRESS_DELAY_MS);

    try {
      const result = await importLinks(
        { text, queue: this.#queue, allowDuplicates: settings.current.allowDuplicates },
        browserYtPorts((done, total) => {
          this.#progress = { done, total };
        }),
      );

      for (const s of result.skipped) ttLog.warn(s.code, '');
      /*
       * Notes carry their track id; skips cannot, because a skipped link never
       * became a track.
       *
       * A note is always a KEPT track (docs/06 §5 — the transient causes), and
       * `recheckPending` later logs a verdict for that same track. Logging both
       * with an empty id left nothing to correlate them by: the diagnostics
       * buffer showed a retry promised and a retry answered with no way to tell
       * which link either belonged to. `fileName` is the videoId here, which is
       * what matches a note to the row it produced.
       */
      for (const s of result.notes) {
        const added = result.added.find((t) => t.videoId === s.fileName);
        ttLog.warn(s.code, '', added?.id);
      }

      if (result.added.length > 0) this.#queue = [...this.#queue, ...result.added];
      this.#syncOrder();
      this.#lastImport = result;
    } finally {
      this.#importing = false;
      if (this.#progressTimer !== null) clearTimeout(this.#progressTimer);
      this.#progressTimer = null;
      this.#progressVisible = false;
      this.#progress = null;
    }
  }

  async #runImport(files: File[], droppedByCap: number): Promise<void> {
    // Sources do not mix (see importLinks). The drop zone is not even rendered
    // in YouTube mode, but a stray drop on the window would otherwise reach
    // here and quietly build a queue the mode cannot play.
    if (this.#mode === 'youtube') return;

    this.#importing = true;
    this.#progress = { done: 0, total: files.length };
    this.#progressVisible = false;
    // Armed, not shown. If the batch finishes first the `finally` clears this
    // and nothing was ever rendered — which is the whole point (docs/02 §4).
    this.#progressTimer = setTimeout(() => {
      if (this.#importing) this.#progressVisible = true;
    }, PROGRESS_DELAY_MS);

    try {
      if (droppedByCap > 0) ttLog.warn('TT-IMP-008', `${droppedByCap} entries over the scan cap`);

      // docs/02 §4: a second import in Single mode REPLACES the held track,
      // because isQueueValid('single') requires exactly one — rejecting it
      // would strand a user who simply wants a different track.
      //
      // ⚠️ This branch WIPES the queue and revokes every URL in it. It is
      // guarded on `#mode === 'single'` and must stay that way: reaching it
      // with a playlist staged would silently destroy up to 95 imported tracks.
      // Both branches are pinned by store tests for exactly that reason.
      const replacing = this.#mode === 'single' && files.length > 0;
      const queue = replacing ? [] : this.#queue;

      // Replacing in Single mode: release the outgoing track's URLs, or the
      // ledger accumulates one cover per import (docs/05 §3).
      if (replacing) for (const t of this.#queue) playback.releaseTrack(t.id);

      const result = await importFiles(
        {
          files,
          mode: this.#mode,
          queue,
          // Read from settings, not a literal. This call site passed `false`
          // through all of P2 while the setting was declared, defaulted,
          // clamped, persisted and honoured by the engine — so the toggle would
          // have shipped doing nothing, and no engine test could have caught it.
          allowDuplicates: settings.current.allowDuplicates,
        },
        {
          ...browserImportPorts(playback.makeCoverUrl),
          onProgress: (done, total) => {
            this.#progress = { done, total };
          },
        },
      );

      // Every skip and every note gets a coded entry — docs/01 §2 principle 5.
      // The message carries no file name: docs/12 §6 makes the diagnostics
      // payload safe to paste publicly by construction, not by remembering.
      for (const s of [...result.skipped, ...result.notes]) ttLog.warn(s.code, '');

      if (replacing) {
        // The cursor named a track that no longer exists. Nothing to reconcile.
        this.#currentId = null;
        this.#shuffled = null;
      }
      if (result.added.length > 0) this.#queue = [...queue, ...result.added];
      // docs/02 §5.1 rule 5 — new ids join the END of a stored permutation, so
      // importing during a shuffled run cannot reshuffle the unplayed remainder.
      this.#syncOrder();
      this.#lastImport = result;
    } finally {
      this.#importing = false;
      if (this.#progressTimer !== null) clearTimeout(this.#progressTimer);
      this.#progressTimer = null;
      this.#progressVisible = false;
      this.#progress = null;
    }
  }

  /** docs/02 §6 — user removal. All removals release the track's URLs at once. */
  removeTrack(id: string): void {
    // docs/02 §6 "stop if current → advance", and §5.1 rule 5. Advance FIRST,
    // while the id is still in the order: afterwards `nextInOrder` could only
    // restart from the top, which is a different track than the one after it.
    if (this.#currentId === id) this.advance();

    this.#queue = this.#queue.filter((t) => t.id !== id);
    // Advancing had nowhere to go — a one-track queue, or the last one left.
    if (this.#currentId === id) this.#currentId = null;
    this.#syncOrder();

    playback.releaseTrack(id);
    ttLog.info('TT-USR-001', '', id);
  }

  /**
   * Move a row within the DISPLAY order — docs/02 §5.1 rule 1.
   *
   * This touches `#queue` and nothing else, which is the whole design showing
   * its work:
   *
   * - Shuffle **off**: playback order is derived from this array, so the next
   *   track changes immediately. No extra call, and nothing to keep in sync.
   * - Shuffle **on**: the stored permutation is untouched, so a drag reorders
   *   what the user *sees* and not what they are about to *hear*. Remapping a
   *   permutation nobody can see would change the future for no visible reason.
   *
   * In both cases the cursor is a track id, so the now-playing track stays
   * current however far it moves.
   *
   * @param delta −1 for up, +1 for down. Clamped: moving the first row up is a
   *   no-op rather than a wrap, so a held key stops at the end instead of
   *   cycling the queue forever.
   * @returns the index it ended at, or null when nothing moved.
   */
  moveTrack(id: string, delta: number): number | null {
    const from = this.#queue.findIndex((t) => t.id === id);
    if (from < 0) return null;

    const to = from + delta;
    if (to < 0 || to >= this.#queue.length) return null;

    const next = [...this.#queue];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return null;
    next.splice(to, 0, moved);
    this.#queue = next;
    return to;
  }

  dismissImport(): void {
    this.#lastImport = null;
  }

  /**
   * Fill in what the queue could not know at import — docs/06 §2.
   *
   * The missing writer. `06 §2` has specified since the first revision that
   * `getDuration()` backfills `durationMs` and `getVideoData()` backfills
   * title/channel, and neither happened — not because either was hard, but
   * because there was nowhere to put the result: `markTrackError` was the store's
   * only track mutator and it only ever wrote `status`. So every YouTube track
   * kept `durationMs: null` for its whole life and the info modal, the queue
   * footer total and "Khớp độ dài" all read `–` forever.
   *
   * **Blanks only, and that is the whole rule.** oEmbed is the better source
   * when it answered — it is the channel's own title, before the player's
   * normalisation — so a value that is already there wins. This exists to fill
   * the gap left by a `pending` import, where title and artist are `''`.
   *
   * Silently ignores a track that has since been removed: every caller is
   * asynchronous by nature, learning a duration seconds after the row was drawn.
   */
  patchTrack(id: string, fields: { durationMs?: number; title?: string; artist?: string }): void {
    const target = this.#queue.find((t) => t.id === id);
    if (target === undefined) return;

    const patch: Partial<TtTrack> = {};
    if (fields.durationMs !== undefined && target.durationMs === null) {
      patch.durationMs = fields.durationMs;
    }
    if (fields.title !== undefined && target.title.trim() === '') patch.title = fields.title;
    if (fields.artist !== undefined && target.artist.trim() === '') patch.artist = fields.artist;
    if (Object.keys(patch).length === 0) return;

    this.#queue = this.#queue.map((t) => (t.id === id ? { ...t, ...patch } : t));
    // Nothing here changes `isPlayable`, but the queue array is new and
    // docs/02 §5.1 rule 5 says reconcile after every mutation rather than
    // deciding case by case which ones could matter.
    this.#syncOrder();
  }

  /**
   * Re-check every `pending` track — docs/02 §1's promise, finally kept.
   *
   * ## Why it looks like this
   *
   * `02 §1` has said "Re-checked on Start" since the first revision and nothing
   * implemented it, while `TtToast` told the user *"sẽ thử lại khi bắt đầu"* to
   * their face. `06 §8` recorded the reason honestly: `start()` is synchronous
   * by design, because `05 §1`'s autoplay chain is broken by the first `await`,
   * so nobody had designed a shape that fits.
   *
   * This is that shape, and it is the boring one: **the re-check is not part of
   * Start at all.** `start()` returns, the gesture has already been spent on
   * `playVideo()`, and the shell then kicks this off without awaiting it. The
   * queue is patched as answers land, which is safe because the cursor is a
   * track id (`02 §5.1`) and not an index.
   *
   * Sequential, matching the importer, for the reason `06 §3` gives about the
   * 60 req/min rule — and the track now playing is skipped, because interfering
   * with it is the one thing this must not do.
   */
  async recheckPending(): Promise<void> {
    const targets = this.#queue.filter((t) => t.status === 'pending' && t.id !== this.#currentId);
    if (targets.length === 0) return;

    const ports = browserYtPorts();
    for (const target of targets) {
      const videoId = target.videoId;
      if (videoId === undefined) continue;

      const result = await ports.lookup(videoId);

      // The queue is live: the user can remove a track, or the cursor can reach
      // it, while its answer is in flight. Both mean this answer is stale.
      const still = this.#queue.find((t) => t.id === target.id);
      if (still === undefined || still.status !== 'pending') continue;
      if (this.#currentId === target.id) continue;

      if (result.ok) {
        this.#queue = this.#queue.map((t) =>
          t.id === target.id ? { ...t, status: 'ok' as const } : t,
        );
        this.patchTrack(target.id, {
          ...(result.meta.title === null ? {} : { title: result.meta.title }),
          ...(result.meta.author_name === null ? {} : { artist: result.meta.author_name }),
        });
        ttLog.info('TT-YT-006', '', target.id);
        continue;
      }

      if (ytCauseIsTransient(result.cause)) continue;

      // Now a property of the video, so it is honest to say so — and `02 §6`'s
      // struck-through row plus `isPlayable` dropping it from the order are
      // both already built and waiting for a writer.
      this.markTrackError(target.id);
      ttLog.warn('TT-YT-007', '', target.id);
    }

    this.#syncOrder();
  }

  /** docs/02 §6 — a track that failed to decode is marked, not silently dropped. */
  markTrackError(id: string): void {
    // Same ordering as removeTrack, and for the same reason: marking it first
    // drops it out of `order` (isPlayable), after which the cursor is stranded
    // and can only restart from the top.
    if (this.#currentId === id) this.advance();

    this.#queue = this.#queue.map((t) => (t.id === id ? { ...t, status: 'error' as const } : t));
    if (this.#currentId === id) this.#currentId = null;
    this.#syncOrder();
  }

  /** boot → gate | setup. Boot must always reach one of them (docs/02 §1). */
  booted(needsGate: boolean): void {
    this.#state = needsGate ? 'gate' : 'setup';
  }

  /** The legal-gate Accept click. Also the autoplay-unlock gesture (docs/05 §1). */
  gateAccepted(): void {
    if (this.#state === 'gate') this.#state = 'setup';
  }

  /**
   * @param force the `?ttdebug=1` timer-only Start (docs/15 §S2). Spike S2's
   *   cases 4–7 are still unrun and its silent case is audio-free by
   *   definition, so the harness needs a way past the queue predicate. Gated
   *   by the flag, exactly like the debug panel, and it collects nothing.
   */
  start(force = false): void {
    if (!force && !this.canStart) return;
    this.#finish = null;
    this.#seat();
    this.#state = 'playing';
  }

  pause(): void {
    if (this.#state === 'playing') this.#state = 'paused';
  }

  resume(): void {
    if (this.#state === 'paused') this.#state = 'playing';
  }

  /** Stop, from playing or paused. Returns to Setup with the run discarded. */
  stop(): void {
    if (this.#state === 'playing' || this.#state === 'paused') {
      this.#finish = null;
      // The queue survives — Stop discards the RUN, not the user's work. The
      // cursor does not, because the next Start re-seats it anyway.
      this.#exhausted = false;
      this.#state = 'setup';
    }
  }

  /**
   * The countdown reached zero.
   *
   * `Date.now()` is read HERE, as the first thing the handler does, because
   * `finishReport` reconstructs the instant zero was reached by subtracting the
   * overshoot from it (docs/04 §2). Every statement between the timer firing and
   * this read adds to the error, and the case this exists for is precisely the
   * one where the main thread is stalled.
   */
  finished(info: TtFinishInfo): void {
    this.#finish = finishReport(info, Date.now());
    this.#state = 'finished';
  }

  /** Finished → setup. docs/03 §3.5 "Back to setup". */
  backToSetup(): void {
    this.#finish = null;
    this.#state = 'setup';
  }

  /** Finished → playing, same countdown. docs/02 §1 "Restart, same queue". */
  restart(): void {
    if (this.#state !== 'finished') return;
    this.#finish = null;
    this.#state = 'playing';
  }
}

export const session = new SessionStore();
