import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import TtSettings from '../../src/app/components/TtSettings.svelte';
import { settings } from '../../src/app/state/settings.svelte';
import { session } from '../../src/app/state/session.svelte';
import { ttLog } from '../../src/app/engine/log/tt-log';
// Aliased: the component under test is also called `TtSettings`.
import {
  TT_DEFAULT_SETTINGS,
  type TtSettings as TtSettingsShape,
} from '../../src/app/state/tt-settings-schema';

/**
 * docs/13 §2's long-filed row — "TtSettings (End Behavior controls persist
 * calls)" — and rather more, because of what P5 is.
 *
 * `16 §P5` measured that 14 of the 26 `TtSettings` fields were declared,
 * clamped, persisted and **read by nothing**. So the thing worth asserting here
 * is not that a control renders: it is that pressing it reaches `settings.patch`
 * with the field the panel claims to own. A control that renders and writes
 * nowhere is this project's signature defect, and it is exactly what
 * `TtSingleRail` shipped for three phases.
 *
 * `settings.patch` is spied rather than run, because the real one opens Dexie —
 * and what is under test is the WIRE, not the store (which has its own tests).
 */

afterEach(cleanup);

type Patch = (partial: Partial<TtSettingsShape>) => Promise<void>;
let patch: ReturnType<typeof vi.fn<Patch>>;

beforeEach(() => {
  patch = vi.fn<Patch>().mockResolvedValue(undefined);
  vi.spyOn(settings, 'patch').mockImplementation(patch);
  // A fresh, known baseline. `current` is the runes proxy the panel reads.
  vi.spyOn(settings, 'current', 'get').mockReturnValue({ ...TT_DEFAULT_SETTINGS });
  ttLog.clear();
});

afterEach(() => vi.restoreAllMocks());

function mount(over: Partial<Parameters<typeof TtSettings>[1]> = {}) {
  const onclose = vi.fn();
  const onvolume = vi.fn();
  const onreset = vi.fn();
  render(TtSettings, { onclose, onvolume, onreset, ...over });
  return { onclose, onvolume, onreset };
}

describe('the groups that ship, and the ones that deliberately do not', () => {
  it('renders the eight groups that have a renderer behind them', () => {
    mount();
    for (const id of [
      'tt-set-general',
      // Display joined in slice 3, WITH the Z1 renderer — the group ships with
      // its feature, never before it (docs/03 §6).
      'tt-set-display',
      'tt-set-countdown',
      'tt-set-audio',
      'tt-set-playback',
      'tt-set-hotkeys',
      'tt-set-diagnostics',
      'tt-set-about',
    ]) {
      expect(screen.getByTestId(id), id).toBeTruthy();
    }
  });

  it('renders no Visualizer group — its renderer does not exist yet', () => {
    /*
     * The guard against the defect this very panel fixes elsewhere. `03 §6`
     * lists nine groups; slice 4 builds the last one. Shipping it disabled
     * would put an inert control in production, which is what
     * `TtSingleRail`'s loop-style pair was.
     */
    mount();
    expect(screen.queryByTestId('tt-set-visualizer')).toBeNull();
  });

  it('offers no crossfade or loop-style control while spike S4b is open', () => {
    // Same rule, one level down: `crossfadeMs` and `singleLoopStyle` have no
    // implementation to drive, so the Audio group says so instead.
    mount();
    expect(screen.queryByTestId('tt-set-crossfade')).toBeNull();
    expect(screen.queryByTestId('tt-set-loopstyle')).toBeNull();
  });
});

describe('End Behavior controls reach the field they name — docs/02 §3.3', () => {
  it('writes endFadeMs from the slider', async () => {
    mount();
    const slider = screen.getByTestId('tt-set-endfade') as HTMLInputElement;
    await fireEvent.input(slider, { target: { value: '3500' } });
    expect(patch).toHaveBeenCalledWith({ endFadeMs: 3500 });
  });

  it('writes endChime and endFlash from their checkboxes', async () => {
    mount();
    // Defaults are chime ON, flash OFF (docs/02 §3.1), so each click flips it.
    await fireEvent.click(screen.getByTestId('tt-set-endchime'));
    expect(patch).toHaveBeenCalledWith({ endChime: false });
    await fireEvent.click(screen.getByTestId('tt-set-endflash'));
    expect(patch).toHaveBeenCalledWith({ endFlash: true });
  });

  it('writes all three endAction values', async () => {
    mount();
    await fireEvent.click(screen.getByTestId('tt-set-endaction-restart'));
    expect(patch).toHaveBeenCalledWith({ endAction: 'restart' });
    await fireEvent.click(screen.getByTestId('tt-set-endaction-loop'));
    expect(patch).toHaveBeenCalledWith({ endAction: 'loop' });
    await fireEvent.click(screen.getByTestId('tt-set-endaction-stay'));
    expect(patch).toHaveBeenCalledWith({ endAction: 'stay' });
  });

  it('shows the fade in seconds, not milliseconds', () => {
    mount();
    // 2000 ms is the default. A raw `2000` beside a slider labelled "fade out"
    // reads as a bug in a way `2.00 s` does not.
    expect(screen.getByTestId('tt-set-endfade-value').textContent).toContain('2.00');
  });
});

describe('countdownSize — the one field with no reader at all before this slice', () => {
  it('writes each of s/m/l', async () => {
    mount();
    await fireEvent.click(screen.getByTestId('tt-set-size-s'));
    expect(patch).toHaveBeenCalledWith({ countdownSize: 's' });
    await fireEvent.click(screen.getByTestId('tt-set-size-l'));
    expect(patch).toHaveBeenCalledWith({ countdownSize: 'l' });
  });

  it('marks the stored size as pressed', () => {
    mount();
    expect(screen.getByTestId('tt-set-size-m').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('tt-set-size-s').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('glow, volume, mute and allowDuplicates', () => {
  it('writes glowIntensity', async () => {
    mount();
    await fireEvent.input(screen.getByTestId('tt-set-glow'), { target: { value: '0.35' } });
    expect(patch).toHaveBeenCalledWith({ glowIntensity: 0.35 });
  });

  it('pushes volume at the engine after persisting it — docs/03 §7', async () => {
    /*
     * Both halves matter. `settings` is the single source of truth so a level
     * survives a mode switch, but nothing HEARS it until the shell forwards it
     * to whichever engine is making sound — in YouTube mode the Web Audio gain
     * node is not in the path at all.
     */
    const { onvolume } = mount();
    await fireEvent.input(screen.getByTestId('tt-set-volume'), { target: { value: '0.3' } });
    expect(patch).toHaveBeenCalledWith({ volume: 0.3 });
    await vi.waitFor(() => expect(onvolume).toHaveBeenCalled());
  });

  it('writes allowDuplicates', async () => {
    mount();
    await fireEvent.click(screen.getByTestId('tt-set-duplicates'));
    expect(patch).toHaveBeenCalledWith({ allowDuplicates: true });
  });
});

describe('shuffle and repeat go through the session, not straight to the row', () => {
  it('calls session.setShuffle and session.setRepeat', async () => {
    // docs/02 §5.1: the store patches the field AND re-derives the play order.
    // Writing `shuffle` directly would persist a preference over a stale order.
    const setShuffle = vi.spyOn(session, 'setShuffle').mockImplementation(() => {});
    const setRepeat = vi.spyOn(session, 'setRepeat').mockImplementation(() => {});
    mount();
    await fireEvent.click(screen.getByTestId('tt-set-shuffle'));
    expect(setShuffle).toHaveBeenCalledWith(true);
    await fireEvent.click(screen.getByTestId('tt-set-repeat'));
    expect(setRepeat).toHaveBeenCalledWith(false);
    expect(patch).not.toHaveBeenCalledWith(expect.objectContaining({ shuffle: true }));
  });
});

describe('Reset — two steps, and the second one names the cost', () => {
  it('does not reset on the first press', async () => {
    const reset = vi.spyOn(settings, 'reset').mockResolvedValue(undefined);
    const { onreset } = mount();
    await fireEvent.click(screen.getByTestId('tt-set-reset'));
    expect(reset).not.toHaveBeenCalled();
    expect(onreset).not.toHaveBeenCalled();
    expect(screen.getByTestId('tt-set-reset-warning')).toBeTruthy();
  });

  it('warns that the legal gate will come back', async () => {
    /*
     * `settings.reset()` deletes the row, so `legalAccepted` goes null and the
     * gate blocks at next boot. That is what "clears Dexie" means (docs/03 §6)
     * — the defect was that nothing said so, and an unannounced re-block is
     * indistinguishable from the app having broken.
     */
    mount();
    await fireEvent.click(screen.getByTestId('tt-set-reset'));
    const text = screen.getByTestId('tt-set-reset-warning').textContent ?? '';
    expect(text).toMatch(/điều khoản|terms/i);
  });

  it('resets, logs TT-USR-101 and hands the transition back to the shell', async () => {
    const reset = vi.spyOn(settings, 'reset').mockResolvedValue(undefined);
    const { onreset } = mount();
    await fireEvent.click(screen.getByTestId('tt-set-reset'));
    await fireEvent.click(screen.getByTestId('tt-set-reset-yes'));
    await vi.waitFor(() => expect(onreset).toHaveBeenCalled());
    expect(reset).toHaveBeenCalled();
    expect(ttLog.entries().map((e) => e.code)).toContain('TT-USR-101');
  });

  it('cancels back to a single button', async () => {
    const reset = vi.spyOn(settings, 'reset').mockResolvedValue(undefined);
    mount();
    await fireEvent.click(screen.getByTestId('tt-set-reset'));
    await fireEvent.click(screen.getByTestId('tt-set-reset-no'));
    expect(screen.queryByTestId('tt-set-reset-warning')).toBeNull();
    expect(reset).not.toHaveBeenCalled();
  });
});

describe('Diagnostics — the docs/02 §7 API that had no caller', () => {
  it('renders log entries and filters by level', async () => {
    ttLog.info('TT-USR-100', 'accepted');
    ttLog.warn('TT-SYS-204', 'settings unreadable');
    mount();
    expect(screen.getByTestId('tt-set-log').textContent).toContain('TT-USR-100');
    expect(screen.getByTestId('tt-set-log').textContent).toContain('TT-SYS-204');

    await fireEvent.click(screen.getByTestId('tt-set-log-warn'));
    expect(screen.getByTestId('tt-set-log').textContent).not.toContain('TT-USR-100');
    expect(screen.getByTestId('tt-set-log').textContent).toContain('TT-SYS-204');
  });

  it('stays live while it is open — ttLog.subscribe had no caller before this', async () => {
    mount();
    expect(screen.getByTestId('tt-set-log-empty')).toBeTruthy();
    ttLog.error('TT-PLY-101', 'decode failed');
    await vi.waitFor(() =>
      expect(screen.getByTestId('tt-set-log').textContent).toContain('TT-PLY-101'),
    );
  });

  it('clears the buffer', async () => {
    ttLog.info('TT-USR-100', 'accepted');
    mount();
    await fireEvent.click(screen.getByTestId('tt-set-log-clear'));
    expect(ttLog.entries()).toEqual([]);
    expect(screen.getByTestId('tt-set-log-empty')).toBeTruthy();
  });

  it('copies a payload that parses as JSON and carries the real version', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    ttLog.info('TT-USR-100', 'accepted');
    mount();
    await fireEvent.click(screen.getByTestId('tt-set-log-copy'));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());

    const payload = JSON.parse(String(writeText.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload['app']).toBe('TickTune');
    expect(payload['version']).toBe(__TT_VERSION__);
    expect(Array.isArray(payload['log'])).toBe(true);
  });

  it('offers the payload to copy by hand when the clipboard refuses', async () => {
    // Failing silently looks exactly like succeeding — docs/01 §2 principle 5.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    mount();
    await fireEvent.click(screen.getByTestId('tt-set-log-copy'));
    const area = await vi.waitFor(() => screen.getByTestId('tt-set-log-payload'));
    expect((area as HTMLTextAreaElement).value).toContain('"app"');
  });
});

describe('About — __TT_VERSION__ finally has a reader', () => {
  it('renders the injected version, not a placeholder', () => {
    // Declared in src/env.d.ts since P1 with the comment "read by the About
    // panel", and read by nothing until now.
    mount();
    expect(screen.getByTestId('tt-set-version').textContent?.trim()).toBe(__TT_VERSION__);
    expect(screen.getByTestId('tt-set-version').textContent).not.toContain('__TT_VERSION__');
  });
});

describe('the sheet is a panel, not a modal — docs/03 §2', () => {
  it('carries no aria-modal, because the page behind really is still live', () => {
    /*
     * A full-bleed backdrop would cover the YouTube player rect, which docs/06
     * §1.2 forbids. So this genuinely is non-modal, and claiming `aria-modal`
     * would tell a screen reader something the pointer can disprove.
     */
    mount();
    const sheet = screen.getByTestId('tt-settings');
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBeNull();
  });

  it('closes on Escape and on the close button', async () => {
    const { onclose } = mount();
    await fireEvent.click(screen.getByTestId('tt-settings-close'));
    expect(onclose).toHaveBeenCalledTimes(1);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onclose).toHaveBeenCalledTimes(2);
  });
});
