/**
 * Object-URL lifecycle as an accounted ledger — docs/05 §3.
 *
 * The invariant is "at most `queueLength + 2` live object URLs", and the
 * arithmetic behind it is worth stating because it constrains the key:
 *
 *   ≤ 2 MEDIA urls — the A/B pair — plus ≤ queueLength COVER urls, one each.
 *
 * `queueLength` is the LOCAL shelf's (docs/02 §3.5, v2.0.1): covers belong to
 * files, and the files stay staged while the YouTube tab shows its links.
 *
 * The media URL is therefore keyed per **track**, not per deck. Keying it per
 * deck looks equivalent and breaks the bound the moment the crossfade loop style
 * loads the same file on both decks: that is one file, one URL, two decks.
 *
 * docs/09 §5 calls this accounting a leak canary, which is the other reason it
 * is a ledger rather than a pair of `createObjectURL` calls: a count that can be
 * asserted is a count that can fail a test.
 */

export type TtUrlKind = 'media' | 'cover';

export function urlKey(trackId: string, kind: TtUrlKind): string {
  return `${kind}:${trackId}`;
}

export class TtUrlLedger {
  readonly #urls = new Map<string, string>();
  readonly #create: (blob: Blob) => string;
  readonly #revoke: (url: string) => void;
  readonly #onChange: ((size: number) => void) | undefined;

  /**
   * @param onChange told the new size after every create or revoke. The debug
   *   panel's canary read `size` through a plain getter, which nothing reactive
   *   depends on, so it showed whatever the count was when it first rendered —
   *   a leak canary that could never go off (v1.1.1).
   */
  constructor(
    create: (blob: Blob) => string,
    revoke: (url: string) => void,
    onChange?: (size: number) => void,
  ) {
    this.#create = create;
    this.#revoke = revoke;
    this.#onChange = onChange;
  }

  /** How many URLs are live right now. The canary. */
  get size(): number {
    return this.#urls.size;
  }

  /**
   * Idempotent per key: asking twice for the same track's media URL returns the
   * first one rather than leaking a second. That is what makes it safe to call
   * on every play without tracking whether this track has played before.
   */
  acquire(key: string, source: Blob): string {
    const existing = this.#urls.get(key);
    if (existing !== undefined) return existing;
    const url = this.#create(source);
    this.#urls.set(key, url);
    this.#onChange?.(this.#urls.size);
    return url;
  }

  get(key: string): string | undefined {
    return this.#urls.get(key);
  }

  /** No-op when the key is unknown — double release must not throw. */
  release(key: string): void {
    const url = this.#urls.get(key);
    if (url === undefined) return;
    this.#urls.delete(key);
    this.#revoke(url);
    this.#onChange?.(this.#urls.size);
  }

  /** Everything for one track: its media URL and its cover. */
  releaseTrack(trackId: string): void {
    this.release(urlKey(trackId, 'media'));
    this.release(urlKey(trackId, 'cover'));
  }

  /** Queue clear and `pagehide` (docs/05 §3). */
  releaseAll(): void {
    if (this.#urls.size === 0) return;
    for (const url of this.#urls.values()) this.#revoke(url);
    this.#urls.clear();
    this.#onChange?.(0);
  }

  /**
   * The docs/05 §3 bound, as a checkable predicate rather than a sentence.
   * The debug panel asserts it; a unit test property-checks it.
   */
  withinBound(queueLength: number): boolean {
    return this.#urls.size <= queueLength + 2;
  }
}
