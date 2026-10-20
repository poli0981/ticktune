import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import TtCountdown from '../../src/app/components/TtCountdown.svelte';

/**
 * The clock face — v2.0, docs/03 §1.
 *
 * The ghost layer must light EVERY segment of the face in use, at the same
 * width as the live digits: `8` does that for DSEG7, but DSEG14's `8` leaves
 * its diagonals dark — its all-segments glyph is `~` (measured,
 * public/fonts/dseg14/PROVENANCE.md).
 */

afterEach(cleanup);

const ONE_HOUR_PLUS = 3_723_000; // 1:02:03 — the widest regime

function parts(face?: 'dseg7' | 'dseg14') {
  const { container } = render(TtCountdown, {
    props: { remainingMs: ONE_HOUR_PLUS, ...(face ? { face } : {}) },
  });
  const root = container.querySelector('.tt-countdown') as HTMLElement;
  return {
    root,
    ghost: root.querySelector('.tt-ghost')?.textContent ?? '',
    live: root.querySelector('.tt-live')?.textContent ?? '',
  };
}

describe('TtCountdown face', () => {
  it('defaults to DSEG7 with an all-8 ghost', () => {
    const { root, ghost, live } = parts();
    expect(root.dataset['ttFace']).toBe('dseg7');
    expect(live).toBe('1:02:03');
    expect(ghost).toBe('8:88:88');
  });

  it('lights every DSEG14 segment with ~, keeping the separators and the width', () => {
    const { root, ghost, live } = parts('dseg14');
    expect(root.dataset['ttFace']).toBe('dseg14');
    expect(ghost).toBe('~:~~:~~');
    expect(ghost).toHaveLength(live.length);
  });
});
