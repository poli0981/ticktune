/**
 * Countdown milestone announcements — docs/03 §8.
 *
 * > Countdown `aria-live`: **off** for per-second ticks (screen-reader spam);
 * > polite announcements at 10 min / 5 min / 1 min / 10 s / zero.
 *
 * Filed as a P5 exit criterion and unwritten until slice 4. Pure, because every
 * interesting case is a boundary and none of them need a DOM.
 *
 * Engines return KEYS, never strings (`12 §3.1`) — `TtMilestone` is an i18n key
 * stem the component translates, the same shape `trackInfoRows` and
 * `TtYtOverlayState` already use.
 */

/** Milliseconds, descending. The order is load-bearing — see `milestoneFor`. */
const THRESHOLDS = [600_000, 300_000, 60_000, 10_000, 0] as const;

export type TtMilestone = 'min10' | 'min5' | 'min1' | 'sec10' | 'zero';

const KEYS: Record<(typeof THRESHOLDS)[number], TtMilestone> = {
  600_000: 'min10',
  300_000: 'min5',
  60_000: 'min1',
  10_000: 'sec10',
  0: 'zero',
};

/**
 * Which milestone this tick crossed, or null.
 *
 * Three rules, and each rules out a wrong announcement:
 *
 * 1. **Downward crossings only** (`previousMs > t >= currentMs`). A 30-second
 *    countdown starts already below the 1-minute threshold, and "one minute
 *    remaining" at the moment the user pressed Start would be nonsense. This
 *    also makes the function safe to call on a paused-then-resumed timer, where
 *    the remaining value does not move.
 *
 * 2. **Only the LOWEST threshold crossed**, when a single tick crosses several.
 *    `04 §2` is explicit that a backgrounded tab can be throttled for minutes,
 *    so a tick genuinely can go from 12 min to 30 s. Announcing four milestones
 *    back to back would talk over itself and the last one — the only one still
 *    true — would arrive last. Returning "10 seconds" is both the shortest and
 *    the only accurate statement.
 *
 * 3. **Zero is `<= 0`, not `=== 0`.** The timer overshoots (`04 §2`), routinely
 *    by a whole throttled interval, so equality would silently never fire the
 *    one announcement that matters most.
 */
export function milestoneFor(previousMs: number, currentMs: number): TtMilestone | null {
  if (!(previousMs > currentMs)) return null;

  let crossed: TtMilestone | null = null;
  for (const t of THRESHOLDS) {
    if (previousMs > t && currentMs <= t) crossed = KEYS[t];
  }
  return crossed;
}
