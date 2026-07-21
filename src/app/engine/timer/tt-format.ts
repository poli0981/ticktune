import type { TtFormatted, TtFormatRegime } from './types';

/**
 * Countdown display formats — implements docs/04 §4, which is the SINGLE
 * SOURCE OF TRUTH. No other module may restate these rules (CLAUDE.md
 * invariant 3).
 *
 *   >= 1 h        H:MM:SS   1 Hz aligned      1:24:07
 *   60 s - 1 h    MM:SS     1 Hz aligned      09:41
 *   < 60 s        SS.mmm    every rAF frame   42.183
 *   0             0.000     held
 *
 * Boundaries are inclusive at the lower edge: 3_600_000 -> "1:00:00",
 * 3_599_999 -> "59:59", 60_000 -> "01:00", 59_999 -> "59.999".
 */

export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;

/** Countdown input range, docs/04 §4. */
export const TT_MIN_COUNTDOWN_MS = 1_000;
export const TT_MAX_COUNTDOWN_MS = 24 * HOUR_MS;

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
const pad3 = (n: number): string => n.toString().padStart(3, '0');

export function regimeFor(remainingMs: number): TtFormatRegime {
  if (remainingMs >= HOUR_MS) return 'hours';
  if (remainingMs >= MINUTE_MS) return 'minutes';
  return 'seconds';
}

/**
 * The all-lit ghost layer rendered behind the digits at 6% opacity (docs/03 §1).
 *
 * Derived from the text rather than hardcoded: the three formats are 7, 5 and 6
 * glyphs wide, so a fixed "888:88:88" would be the wrong width in two of the
 * three regimes and would reintroduce exactly the layout shift the ghost exists
 * to prevent. Separators are preserved so the glyph advance matches.
 */
export function ghostFor(text: string): string {
  let out = '';
  for (const ch of text) out += ch === ':' || ch === '.' ? ch : '8';
  return out;
}

export function formatRemaining(remainingMs: number): TtFormatted {
  const ms = Math.max(0, Math.floor(remainingMs));
  const regime = regimeFor(ms);

  let text: string;
  if (regime === 'hours') {
    const h = Math.floor(ms / HOUR_MS);
    const m = Math.floor((ms % HOUR_MS) / MINUTE_MS);
    const s = Math.floor((ms % MINUTE_MS) / 1000);
    // Hours are not zero-padded: past 9 h this widens to 8 glyphs and the ghost
    // widens with it, because it is derived from this string.
    text = `${h}:${pad2(m)}:${pad2(s)}`;
  } else if (regime === 'minutes') {
    const m = Math.floor(ms / MINUTE_MS);
    const s = Math.floor((ms % MINUTE_MS) / 1000);
    text = `${pad2(m)}:${pad2(s)}`;
  } else {
    const s = Math.floor(ms / 1000);
    text = `${pad2(s)}.${pad3(ms % 1000)}`;
  }

  return { text, ghost: ghostFor(text), regime, danger: ms < MINUTE_MS };
}

/**
 * Delay until the next visible change.
 *
 * In the 1 Hz regimes the display must flip ON the second boundary, so the next
 * wake is `remaining % 1000` — not a flat 1000, which would drift the flip away
 * from the boundary by however late the previous tick was (docs/04 §4).
 * Below 60 s the caller drives rAF instead and this is not used.
 */
export function nextTickDelayMs(remainingMs: number): number {
  if (remainingMs <= 0) return 0;
  if (remainingMs < MINUTE_MS) return 0;
  const rem = remainingMs % 1000;
  return rem === 0 ? 1000 : rem;
}
