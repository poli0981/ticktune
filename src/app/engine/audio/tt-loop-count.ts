/**
 * Hard-loop wrap detection — docs/05 §2, feeding docs/03 §2's "Loop ×N".
 *
 * `element.loop = true` fires **no `ended` event**. It seeks to 0 and keeps
 * playing, so there is nothing to edge-trigger on and any counter written
 * against `ended` is dead code that silently never increments.
 *
 * What is observable is `currentTime` going backwards, sampled from the ~4 Hz
 * `timeupdate`. The only other thing that moves it backwards is the user
 * seeking, so the rule has to separate the two.
 */

/**
 * Did playback wrap between these two `currentTime` samples?
 *
 * A wrap is a backwards jump of more than half the track: looping from 4.9 s to
 * 0.1 s on a 5 s file moves back 4.8 s, while a user dragging the scrubber back
 * a few seconds moves back a few seconds. Half the duration is the widest
 * threshold that cannot mistake a scrub for a wrap on any track length, and the
 * narrowest that cannot miss a real wrap — a wrap always jumps back by nearly
 * the whole duration, because it happens at the end.
 *
 * Returns false on a non-finite or zero duration: a VBR MP3 whose duration the
 * browser has not settled yet (docs/05 §2) would otherwise produce a threshold
 * of NaN, and every comparison against NaN is false in a way that is accidental
 * rather than intended.
 */
export function detectWrap(prevS: number, currentS: number, durationS: number): boolean {
  if (!Number.isFinite(durationS) || durationS <= 0) return false;
  if (!Number.isFinite(prevS) || !Number.isFinite(currentS)) return false;
  return prevS - currentS > durationS / 2;
}
