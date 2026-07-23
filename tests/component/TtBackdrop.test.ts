import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import TtBackdrop from '../../src/app/components/TtBackdrop.svelte';
import { settings } from '../../src/app/state/settings.svelte';
import { backdrop } from '../../src/app/state/backdrop.svelte';
import { TT_DEFAULT_SETTINGS, type TtSettings } from '../../src/app/state/tt-settings-schema';
import { TT_GRADIENT_PRESETS } from '../../src/app/engine/visuals/tt-gradient';

/**
 * Z1 — docs/03 §2, P5 slice 3.
 *
 * The premise of the whole phase is that a field can be declared, clamped,
 * persisted, unit-tested and read by NOBODY (`16 §P5`). Eight of the fourteen
 * that were in that state are Display fields, so what this file asserts is not
 * that the stack renders — it is that changing each field changes the DOM.
 */

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

function withSettings(over: Partial<TtSettings>) {
  vi.spyOn(settings, 'current', 'get').mockReturnValue({ ...TT_DEFAULT_SETTINGS, ...over });
}

beforeEach(() => {
  // happy-dom has no matchMedia by default and the component reads it for
  // reduced motion. Default to "no preference"; the reduced-motion test
  // overrides it.
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  backdrop.clearImages();
});

describe('the base layer — background, gradientPreset, gradientCustom', () => {
  it('paints a gradient by default and names the mode on the root', () => {
    withSettings({ background: 'gradient', gradientPreset: 0 });
    render(TtBackdrop, {});
    expect(screen.getByTestId('tt-backdrop').getAttribute('data-tt-background')).toBe('gradient');
    const style = screen.getByTestId('tt-backdrop-base').getAttribute('style') ?? '';
    expect(style).toContain('linear-gradient');
  });

  it('reads gradientPreset — a different preset paints different stops', () => {
    withSettings({ background: 'gradient', gradientPreset: 3 });
    render(TtBackdrop, {});
    const style = screen.getByTestId('tt-backdrop-base').getAttribute('style') ?? '';
    expect(style).toContain(TT_GRADIENT_PRESETS[3]![0]);
    expect(style).not.toContain(TT_GRADIENT_PRESETS[0]![1]);
  });

  it('reads gradientCustom, and it beats the preset', () => {
    withSettings({
      background: 'gradient',
      gradientPreset: 0,
      gradientCustom: ['#123456', '#654321'],
    });
    render(TtBackdrop, {});
    const style = screen.getByTestId('tt-backdrop-base').getAttribute('style') ?? '';
    expect(style).toContain('#123456');
    expect(style).toContain('#654321');
  });

  it('reads background: solid — no gradient at all', () => {
    withSettings({ background: 'solid' });
    render(TtBackdrop, {});
    const style = screen.getByTestId('tt-backdrop-base').getAttribute('style') ?? '';
    expect(style).not.toContain('linear-gradient');
    expect(style).toContain('--color-tt-void');
  });
});

describe('the picture layers', () => {
  const file = (name: string): File =>
    new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });

  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => `blob:${Math.random().toString(36).slice(2)}`),
      revokeObjectURL: vi.fn(),
    });
  });

  it('renders nothing extra when the mode wants pictures but there are none', () => {
    /*
     * The reload case, and it has to be graceful rather than blank. Hard
     * invariant 1 keeps these files in RAM, so `background: 'slideshow'`
     * survives a reload and the pictures do not — the gradient underneath is
     * already painted, which is why the stack composites rather than switches.
     */
    withSettings({ background: 'slideshow' });
    render(TtBackdrop, {});
    expect(screen.queryAllByTestId('tt-backdrop-photo')).toHaveLength(0);
    expect(screen.getByTestId('tt-backdrop-base')).toBeTruthy();
  });

  it('renders one element per picture so the 400 ms crossfade has two to fade', () => {
    // docs/03 §2: "Crossfades 400 ms between slideshow images". Swapping one
    // element's `src` would cut instead.
    backdrop.setImages([file('a.png'), file('b.png'), file('c.png')]);
    withSettings({ background: 'slideshow' });
    render(TtBackdrop, {});
    expect(screen.getAllByTestId('tt-backdrop-photo')).toHaveLength(3);
  });

  it('shows exactly one picture at a time', () => {
    backdrop.setImages([file('a.png'), file('b.png')]);
    withSettings({ background: 'slideshow' });
    render(TtBackdrop, {});
    const on = screen
      .getAllByTestId('tt-backdrop-photo')
      .filter((el) => el.className.includes('tt-on'));
    expect(on).toHaveLength(1);
  });

  it('reads background: cover — the blurred artwork layer appears only then', () => {
    withSettings({ background: 'gradient' });
    const { unmount } = render(TtBackdrop, { coverArtUrl: 'blob:cover' });
    expect(screen.queryByTestId('tt-backdrop-cover')).toBeNull();
    unmount();

    withSettings({ background: 'cover' });
    render(TtBackdrop, { coverArtUrl: 'blob:cover' });
    expect(screen.getByTestId('tt-backdrop-cover')).toBeTruthy();
  });

  it('does not render the cover layer with no artwork to blur', () => {
    withSettings({ background: 'cover' });
    render(TtBackdrop, { coverArtUrl: null });
    expect(screen.queryByTestId('tt-backdrop-cover')).toBeNull();
  });
});

describe('the scrim — scrimStrength and scrimAuto', () => {
  it('reads scrimStrength straight through when auto is off', () => {
    withSettings({ scrimAuto: false, scrimStrength: 0.55 });
    render(TtBackdrop, {});
    expect(screen.getByTestId('tt-backdrop-scrim').getAttribute('data-tt-scrim')).toBe('0.550');
  });

  it('never goes below the user’s number with auto ON over a dark background', () => {
    // docs/02 §3.1: scrimAuto "may RAISE scrimStrength; it never lowers it".
    // The default gradient is already far past 4.5:1, so auto has nothing to
    // add and the user's figure has to survive untouched.
    withSettings({ scrimAuto: true, scrimStrength: 0.6, background: 'gradient' });
    render(TtBackdrop, {});
    expect(Number(screen.getByTestId('tt-backdrop-scrim').getAttribute('data-tt-scrim'))).toBe(0.6);
  });
});

describe('scanlines and reduced motion — docs/03 §8', () => {
  it('reads the scanlines field', () => {
    withSettings({ scanlines: true });
    const { unmount } = render(TtBackdrop, {});
    expect(screen.getByTestId('tt-backdrop-scanlines')).toBeTruthy();
    unmount();

    withSettings({ scanlines: false });
    render(TtBackdrop, {});
    expect(screen.queryByTestId('tt-backdrop-scanlines')).toBeNull();
  });

  it('suppresses scanlines under prefers-reduced-motion WITHOUT rewriting the setting', () => {
    /*
     * docs/02 §3.1 is explicit: reduced motion "does not rewrite these values —
     * it suppresses them at render time". The stored preference has to survive
     * so that turning the OS setting off restores the user's choice, and the
     * only way to see the difference is to check both at once.
     */
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    const patch = vi.spyOn(settings, 'patch');
    withSettings({ scanlines: true, slideshowTransition: 'kenburns' });
    render(TtBackdrop, {});

    expect(screen.queryByTestId('tt-backdrop-scanlines')).toBeNull();
    expect(settings.current.scanlines).toBe(true);
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('Focus dims Z1 — docs/03 §4', () => {
  it('adds the dim layer only in Focus', () => {
    /*
     * It lives here rather than as a background on `.tt-main`, and that is not
     * cosmetic: since slice 3 `.tt-main` paints ABOVE Z1, so a colour there
     * would hide the backdrop rather than dim it.
     */
    const { unmount } = render(TtBackdrop, { focusMode: false });
    expect(screen.queryByTestId('tt-backdrop-focus-dim')).toBeNull();
    unmount();

    render(TtBackdrop, { focusMode: true });
    expect(screen.getByTestId('tt-backdrop-focus-dim')).toBeTruthy();
  });
});
