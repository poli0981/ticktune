/**
 * The decisions the drop traversal makes — docs/02 §4 step 0.
 *
 * The traversal itself is unavoidably impure (`webkitGetAsEntry`,
 * `FileSystemDirectoryReader`, neither of which happy-dom implements), so it
 * lives in `tt-import-driver.ts`. What is *decidable* — ordering and the cap —
 * lives here, inside the coverage gate, because "which 500 of these 900 files
 * did we keep, and in what order" is a rule worth testing and a driver is where
 * rules go to be untested.
 */

/**
 * Hard cap on entries taken from one drop.
 *
 * Not the same thing as the queue cap: this bounds the *scan*, before any
 * per-file work, so dropping a music library on the window cannot spend minutes
 * walking directories to import at most 95 tracks. Exceeding it is TT-IMP-008.
 */
export const TT_DROP_MAX_ENTRIES = 500;

/** A materialised drop entry: either a file, or a directory with children. */
export interface TtDropNode {
  name: string;
  file?: File;
  children?: TtDropNode[];
}

/**
 * Depth-first flatten, siblings ordered by locale-aware collation.
 *
 * Ordering matters more than it looks: a drop is inherently unordered (the OS
 * hands entries over in whatever order the filesystem enumerated them), and in
 * Single mode the pipeline keeps the FIRST accepted file. Without a stable rule,
 * dropping the same folder twice could import a different track each time.
 *
 * `numeric` so `track2` sorts before `track10`, which is what someone who named
 * their files that way meant.
 */
export function orderEntries(nodes: readonly TtDropNode[]): File[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const out: File[] = [];

  const walk = (list: readonly TtDropNode[]): void => {
    for (const node of [...list].sort((a, b) => collator.compare(a.name, b.name))) {
      if (node.file) out.push(node.file);
      if (node.children) walk(node.children);
    }
  };

  walk(nodes);
  return out;
}

/** Applies TT_DROP_MAX_ENTRIES. `dropped > 0` ⇒ the caller logs TT-IMP-008. */
export function applyEntryCap(files: readonly File[]): { files: File[]; dropped: number } {
  if (files.length <= TT_DROP_MAX_ENTRIES) return { files: [...files], dropped: 0 };
  return {
    files: files.slice(0, TT_DROP_MAX_ENTRIES),
    dropped: files.length - TT_DROP_MAX_ENTRIES,
  };
}
