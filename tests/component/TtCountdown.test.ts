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

/**
 * v2.2, docs/03 §8 — the spoken twin. The digits are `aria-hidden` (they change
 * every frame below a minute, and DSEG glyphs read badly), so before this a
 * screen reader could hear the time only at the five milestones.
 */
describe('TtCountdown spoken timer (v2.2)', () => {
  const spoken = (remainingMs: number, speak = true) => {
    const { container } = render(TtCountdown, { props: { remainingMs, speak } });
    return container.querySelector('[role=timer]');
  };

  it('is a role=timer — implicitly aria-live off, so it never interrupts', () => {
    const el = spoken(ONE_HOUR_PLUS);
    expect(el).not.toBeNull();
    expect(el?.getAttribute('aria-live')).toBeNull();
    // The label is in the text: a reader in browse mode reads the content.
    expect(el?.getAttribute('aria-label')).toBeNull();
  });

  it('says the remaining time in words, whole seconds only', () => {
    const text = spoken(ONE_HOUR_PLUS)?.textContent ?? '';
    expect(text).toContain('Thời gian còn lại');
    expect(text).toMatch(/1 giờ/);
    expect(text).toMatch(/2 phút/);
    expect(text).toMatch(/3 giây/);
    // Below a minute the digits show milliseconds; the words do not.
    expect(spoken(42_183)?.textContent).toMatch(/42 giây/);
    expect(spoken(42_183)?.textContent).not.toMatch(/183/);
  });

  it('falls back to the unit keys where Intl.DurationFormat is missing', () => {
    const intl = Intl as unknown as { DurationFormat?: unknown };
    const saved = intl.DurationFormat;
    intl.DurationFormat = undefined;
    try {
      expect(spoken(ONE_HOUR_PLUS)?.textContent).toContain('1 giờ 2 phút 3 giây');
      expect(spoken(0)?.textContent).toContain('0 giây');
    } finally {
      intl.DurationFormat = saved;
    }
  });

  it('is not rendered unless asked — Setup’s preview is the input, already named', () => {
    expect(spoken(ONE_HOUR_PLUS, false)).toBeNull();
  });
});
