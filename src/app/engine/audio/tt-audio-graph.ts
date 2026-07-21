import type { TtAudioPorts, TtGainPort } from './types';

/**
 * Volume and mute — the `userGain` half of docs/05 §1's split master stage.
 *
 * Deliberately the ONLY writer of `userGain`, and it never touches `fadeGain`.
 * That separation is the whole reason there are two nodes: a volume change
 * during the End-Behavior fade would otherwise be an automation write inside an
 * active `setValueCurveAtTime` window, which Web Audio rejects with
 * NotSupportedError. With two nodes the collision cannot be expressed.
 */
export function applyVolume(ports: TtAudioPorts, volume: number, muted: boolean): void {
  const clamped = Math.min(1, Math.max(0, volume));
  ports.userGain.setValue(muted ? 0 : clamped, ports.ctx.nowS);
}

/**
 * Reset the fade stage to unity, cancelling anything still scheduled.
 *
 * Needed by Restart and by Back-to-setup: both can land mid-fade, and a second
 * run that started at gain 0 because the previous fade was never cleared is
 * silent for its whole duration with nothing on screen to explain it.
 */
export function restoreFadeGain(ports: TtAudioPorts): void {
  const now = ports.ctx.nowS;
  ports.fadeGain.cancelScheduled(now);
  ports.fadeGain.setValue(1, now);
}

/** Both deck gains to a known state — used on stop (docs/05 §1). */
export function silenceDecks(ports: TtAudioPorts): void {
  const now = ports.ctx.nowS;
  for (const id of [0, 1] as const) {
    const gain: TtGainPort = ports.deckGain(id);
    gain.cancelScheduled(now);
    gain.setValue(0, now);
  }
}
