/**
 * The palette values JavaScript needs — docs/03 §1.
 *
 * CSS reads the tokens through `var(--color-tt-*)`; a few places need the
 * NUMBERS instead: the adaptive scrim's contrast maths (TtBackdrop), the
 * visualizer's fallback colour, and the gradient presets' contrast test. Those
 * used to carry their own hex copies, which is how a palette change could
 * quietly void the 4.5:1 guarantee the scrim exists to keep.
 *
 * Mirrors the `@theme` block in src/styles/global.css; tests/unit/tt-palette.test.ts
 * parses that block and fails if the two disagree.
 */
export const TT_PALETTE = {
  /** `--color-tt-void` — the chassis, and the `solid` background. */
  void: '#0e0d0b',
  /** `--color-tt-surface`. */
  surface: '#171512',
  /** `--color-tt-text` — ink. */
  text: '#ede6da',
  /** `--color-tt-digit` — the countdown's lit segments; what the scrim protects. */
  digit: '#f5eedc',
  /** `--color-tt-signal` — amber. */
  signal: '#ffb23f',
  /** `--color-tt-danger` — the tally lamp and the < 60 s digits. */
  danger: '#ff3b30',
} as const;
