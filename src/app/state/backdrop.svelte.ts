import { TtUrlLedger } from '../engine/audio/tt-object-urls';
import { dominantHue, type TtHue } from '../engine/visuals/tt-dominant-hue';
import { ttLog } from '../engine/log/tt-log';

/**
 * The Z1 background's session state — docs/03 §2, P5 slice 3.
 *
 * ## What is NOT here, and why that is the whole design
 *
 * The user's background images are **never persisted**. Hard invariant 1 is
 * "user files never leave the browser", and `02 §3` lists what Dexie holds:
 * the background *choice* is a setting, the *files* are session-only RAM, the
 * same rule the queue lives under. So a reload keeps `background: 'slideshow'`
 * and loses the pictures — which the Display group has to state rather than
 * silently render a gradient and look broken.
 *
 * ## A second ledger, not a second kind in the first one
 *
 * `TtUrlLedger` is reused, but a **separate instance**. docs/05 §3's bound is
 * "≤ queueLength + 2" and it is a statement about the AUDIO graph — two decks
 * plus one cover per queued track. Adding backgrounds to that ledger would make
 * `withinBound` stop meaning anything, and it is the leak canary docs/09 §5
 * relies on. Two ledgers, two bounds, both checkable.
 */

/**
 * How many pictures a slideshow may hold.
 *
 * New in P5 slice 3: `03 §6` said "multi-upload" and named no ceiling, and an
 * uncapped multi-select is a way to put a few hundred full-resolution bitmaps
 * into RAM behind a countdown. Twenty is generous for the feature (at the
 * 60 s maximum interval that is twenty minutes before a repeat) and bounded
 * enough to state.
 */
export const TT_MAX_BACKGROUND_IMAGES = 20;

/** Not exported: nothing outside this module names the shape. */
interface TtBackgroundImage {
  readonly id: string;
  readonly url: string;
  readonly name: string;
}

class BackdropStore {
  #images = $state<TtBackgroundImage[]>([]);
  #index = $state(0);
  #hue = $state<TtHue>(null);

  readonly #ledger = new TtUrlLedger(
    (blob) => URL.createObjectURL(blob),
    (url) => URL.revokeObjectURL(url),
  );

  /** Session-only, in the order the user picked them. */
  get images(): TtBackgroundImage[] {
    return this.#images;
  }

  /** Which one a slideshow is showing. Always valid, or 0 when empty. */
  get index(): number {
    return this.#index;
  }

  get current(): TtBackgroundImage | null {
    return this.#images[this.#index] ?? this.#images[0] ?? null;
  }

  /** docs/03 §5's dominant hue, or null when there is nothing to borrow. */
  get hue(): TtHue {
    return this.#hue;
  }

  /** docs/09 §5's canary, for the ?ttdebug=1 panel — this ledger's own count. */
  get liveUrls(): number {
    return this.#ledger.size;
  }

  /**
   * Replace the picture set.
   *
   * Replace rather than append: the file picker's own semantics are "these are
   * the ones I chose", and an appending control needs a per-row remove affordance
   * that `03 §6` does not specify. Anything over the cap is dropped with a log
   * entry rather than silently, because a user who selected 300 files and got 20
   * is owed the reason.
   */
  setImages(files: readonly File[]): void {
    /*
     * TT-IMG-*, deliberately NOT TT-IMP-*. These reject for the same two shapes
     * of reason as the audio importer and were briefly written with its codes —
     * but `TT-IMP-*` is keyed straight into the import summary toast (docs/08
     * §3.1), so a rejected background would have surfaced as "Format not
     * supported" inside a toast about music. Registered in docs/12 §6 first.
     */
    const accepted = files.filter((f) => f.type.startsWith('image/'));
    const rejected = files.length - accepted.length;
    if (rejected > 0) ttLog.warn('TT-IMG-001', `${rejected} not an image`);

    const kept = accepted.slice(0, TT_MAX_BACKGROUND_IMAGES);
    if (accepted.length > kept.length) {
      ttLog.warn('TT-IMG-002', `${accepted.length - kept.length} over the cap`);
    }

    // Release FIRST. The old URLs are unreachable the moment `#images` is
    // reassigned, and a ledger that is only cleared on dispose is a leak that
    // survives every reasonable test (docs/09 §5).
    this.#ledger.releaseAll();
    this.#images = kept.map((file) => {
      const id = crypto.randomUUID();
      return { id, url: this.#ledger.acquire(id, file), name: file.name };
    });
    this.#index = 0;
  }

  /** Next picture, wrapping. A no-op below two images. */
  advance(): void {
    if (this.#images.length < 2) return;
    this.#index = (this.#index + 1) % this.#images.length;
  }

  clearImages(): void {
    this.#ledger.releaseAll();
    this.#images = [];
    this.#index = 0;
  }

  /**
   * docs/03 §5 — read a hue off the current cover art.
   *
   * The canvas work lives here rather than in the component because it is the
   * one impure step and it has a failure mode worth swallowing in exactly one
   * place: a cover that will not decode, or a 2D context the browser refuses,
   * must leave the theme alone rather than throw into a render.
   *
   * ⚠️ **Local cover art only.** `03 §5` used to say the YouTube thumbnail's hue
   * is used instead; that is a modified use of YouTube's image and it sits under
   * an open audit finding whose ToS half nobody has read. Spike S1 established
   * that `i.ytimg.com` sends `ACAO: *`, so the canvas would NOT be tainted — the
   * technical objection is gone and only the licensing one remains, which makes
   * this a decision rather than a limitation. YouTube mode gets the generated
   * gradient, which is what the audit itself recommends.
   */
  async readHue(coverArtUrl: string | null): Promise<void> {
    if (!coverArtUrl) {
      this.#hue = null;
      return;
    }
    try {
      const bitmap = await createImageBitmap(await (await fetch(coverArtUrl)).blob(), {
        resizeWidth: 16,
        resizeHeight: 16,
        resizeQuality: 'pixelated',
      });
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        this.#hue = null;
        return;
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      this.#hue = dominantHue(ctx.getImageData(0, 0, 16, 16).data);
    } catch {
      // Decoration. A cover that cannot be read must never break playback —
      // the same rule `makeCoverUrl` follows in the playback store.
      this.#hue = null;
    }
  }

  /** `pagehide` and unmount — docs/05 §3 revokes every URL it created. */
  dispose(): void {
    this.clearImages();
    this.#hue = null;
  }
}

export const backdrop = new BackdropStore();
