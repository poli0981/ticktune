/**
 * The end-of-countdown chime — docs/05 §7.
 *
 * **Synthesised, not an asset.** Two oscillators and an envelope, so there is
 * no `public/audio/chime.opus` to license, to attribute, to fetch at the exact
 * moment a backgrounded tab is least able to fetch anything, or to fail on a
 * Safari that docs/05 §4 flags for Opus.
 *
 * ⚠️ This is NOT, and must never become, the keep-alive source of docs/04 §2.
 * That remedy was measured twice and withdrawn. This is a bounded two-note
 * one-shot at zero; anything that keeps a source alive to make the tab audible
 * is the withdrawn design wearing this module as a disguise.
 */

/** ≈ −6 dB, per docs/05 §7. Fixed: this is a signal, not program material. */
export const CHIME_PEAK_GAIN = 0.501;

/**
 * A rising major sixth — two notes, so it reads as a deliberate cue rather than
 * a system beep, and high enough to cut through whatever was playing.
 */
export const CHIME_NOTES_HZ = [880, 1_318.5] as const;

const NOTE_SPACING_S = 0.18;
const NOTE_DECAY_S = 0.55;

/* Reachable through TtChimePlan; not exported until a module names it (knip). */
interface TtChimeNote {
  hz: number;
  /** Absolute time on the AudioContext clock. */
  startS: number;
  stopS: number;
  /** Envelope: peak immediately, then exponential-ish decay to silence. */
  peak: number;
}

export interface TtChimePlan {
  notes: TtChimeNote[];
  /** When the whole thing is over — the seam that says "the chime ran". */
  endsAtS: number;
}

/**
 * @param audioNowS `AudioContext.currentTime` at scheduling time.
 * @param offsetS delay before the first note — the end fade's duration, so the
 *   chime lands as the music finishes rather than over it.
 */
export function planChime(audioNowS: number, offsetS: number): TtChimePlan {
  const start = audioNowS + Math.max(0, offsetS);
  const notes = CHIME_NOTES_HZ.map((hz, i) => ({
    hz,
    startS: start + i * NOTE_SPACING_S,
    stopS: start + i * NOTE_SPACING_S + NOTE_DECAY_S,
    peak: CHIME_PEAK_GAIN,
  }));
  return { notes, endsAtS: notes[notes.length - 1]!.stopS };
}
