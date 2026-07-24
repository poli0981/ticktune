import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * The legal documents — P6 slice B, `docs/08 §1`.
 *
 * ## Why a content collection rather than a plain `.md` import
 *
 * The canonical documents live at `legal/*.md` in the **repository root**, not
 * under `src/`, and they have to stay there: `legal/EULA.md` is what the licence
 * links point at and what a reviewer reads on GitHub. The content layer's
 * `glob()` loader takes a `base` resolved from the project root, which is the
 * supported way to source markdown from outside `src/`.
 *
 * ## Why `<Content />` is not the `{@html}` ban
 *
 * `render(entry)` compiles this markdown to **static HTML at build time**, from
 * files in our own repository. `docs/09 §4` bans `{@html}` because it renders an
 * unsanitised string at runtime; neither half of that applies here. This is the
 * same trust level as hand-writing the markup, and the build fails rather than
 * silently injecting if a document is malformed.
 *
 * ## Two collections, not one
 *
 * `legalEn` is the canonical set and `legalVi` the translations. Keeping them
 * separate means "the canonical set" is literally one collection rather than a
 * filter over a merged one, and it keeps the EN pages zero-drift by
 * construction — they render the very file the licence points at.
 *
 * Parity between the two is enforced by `tests/unit/tt-legal-parity.test.ts`,
 * which a schema cannot do: the requirement is that the same four documents
 * exist on both sides at the same version, not that each has some shape.
 */
const legalEn = defineCollection({
  loader: glob({ pattern: '*.md', base: './legal' }),
});

const legalVi = defineCollection({
  loader: glob({ pattern: '*.md', base: './legal/vi' }),
});

export const collections = { legalEn, legalVi };
