/**
 * Mobile-gate criteria — single source of truth (docs/07 §2).
 *
 * The predicate below is ALSO inlined verbatim into the `<head>` of
 * TtBase.astro as an `is:inline` script, because it must run before the parser
 * reaches any module script. Keep the two byte-identical in behaviour; the
 * inline copy is what the CSP hash covers (docs/10 §7).
 */
export const TT_GATE = {
  /** px — blocks phones and portrait tablets. */
  minWidth: 1024,
  /** Touch-only (no hover) is blocked even above minWidth. */
  blockCoarseOnly: true,
} as const;

/**
 * Evaluated ONCE at load, deliberately (docs/07 §2): resizing a desktop window
 * below 1024 px mid-session must not eject the user, because window snapping is
 * normal desktop behaviour.
 */
export function ttIsBlocked(win: Window = window): boolean {
  return (
    win.innerWidth < TT_GATE.minWidth ||
    (TT_GATE.blockCoarseOnly &&
      win.matchMedia('(pointer: coarse)').matches &&
      !win.matchMedia('(hover: hover)').matches)
  );
}
