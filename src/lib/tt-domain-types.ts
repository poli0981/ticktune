/**
 * Cross-cutting domain vocabulary — the few unions that both the engines and
 * the state layer need to name.
 *
 * Why it lives in `src/lib/` rather than in `state/tt-settings-schema.ts` where
 * these were originally declared: the engine-purity zone rule (docs/12 §3.1)
 * makes an import from `src/app/engine/` into `src/app/state/` a lint error,
 * and the base `no-restricted-imports` rule has no `allowTypeImports` escape —
 * so even `import type { TtMode }` from an engine fails `pnpm lint` on the
 * import line. `src/lib/` is deliberately outside that ban list, which is what
 * lets the audio and importer engines share one definition with the settings
 * schema instead of each keeping a copy that can drift.
 *
 * Values, ranges and defaults stay in `state/tt-settings-schema.ts`
 * (docs/02 §3.1 is its specification). This file holds vocabulary only.
 */

/** docs/02 §1 — the three modes. */
export type TtMode = 'single' | 'playlist' | 'youtube';

/** docs/05 §2 — Single-mode loop styles. */
export type TtLoopStyle = 'hard' | 'crossfade';

/** docs/02 §3.3 — what happens at zero. Mutually exclusive by construction. */
export type TtEndAction = 'stay' | 'restart' | 'loop';
