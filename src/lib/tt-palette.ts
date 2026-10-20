/**
 * The palette values JavaScript needs — docs/03 §1.
 *
 * CSS reads the tokens through `var(--color-tt-*)`; a few places need the
 * NUMBERS instead: the adaptive scrim's contrast maths (TtBackdrop), the
 * visualizer's fallback colour, and the gradient presets' contrast test. Those
 * used to carry their own hex copies, which is how a palette change could
 * quietly void the 4.5:1 guarantee the scrim exists to keep.
 *
 * Mirrors the `@theme` block in src/styles/global.css — and since v2.0 its
 * light override, `html[data-tt-theme='light']`; tests/unit/tt-palette.test.ts
 * parses both and fails if either pair disagrees.
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

/**
 * The light theme (v2.0, docs/03 §1): the same rack in LCD dress — dark
 * segments on a reflective panel, the chassis aluminium. Every text colour holds
 * 4.5:1 on all three surfaces and `outline` 3:1, by the same arithmetic the dark
 * palette was picked with.
 */
export const TT_PALETTE_LIGHT = {
  void: '#e8e4da',
  surface: '#f4f1ea',
  text: '#1c1a16',
  digit: '#1d1f1a',
  signal: '#8f5200',
  danger: '#b8241a',
} as const;

/** The numbers for a theme — what the scrim, the presets and the tests read. */
export function ttPalette(
  theme: 'dark' | 'light',
): Readonly<Record<keyof typeof TT_PALETTE, string>> {
  return theme === 'light' ? TT_PALETTE_LIGHT : TT_PALETTE;
}
