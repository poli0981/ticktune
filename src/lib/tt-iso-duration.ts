/**
 * ISO 8601 durations as the YouTube Data API writes them — docs/06 §3.
 *
 * `contentDetails.duration` is `PT4M13S`, `PT1H2M`, `P1DT2H` for the rare video
 * over a day — and `P0D` for a live stream or a premiere that has not aired,
 * which has no length yet. The Worker converts once, here, and the app only
 * ever sees milliseconds.
 *
 * Anything that is not a positive duration is `null`, never 0: a 0 would sum
 * into the queue total and "Match queue length" as a real, wrong number, where
 * null renders `–` and disables the button with its reason (docs/03 §3).
 * Years and months are rejected rather than guessed — YouTube never sends them,
 * and their length depends on a calendar.
 */
const ISO = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export function isoDurationMs(text: string): number | null {
  const m = ISO.exec(text);
  // `P` and `PT` match the pattern with every group empty; neither is a duration.
  if (m === null || text === 'P' || text.endsWith('T')) return null;
  const [, w, d, h, min, s] = m;
  const days = Number(w ?? 0) * 7 + Number(d ?? 0);
  const minutes = (days * 24 + Number(h ?? 0)) * 60 + Number(min ?? 0);
  const ms = minutes * 60_000 + Math.round(Number(s ?? 0) * 1000);
  return ms > 0 ? ms : null;
}
