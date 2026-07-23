import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import TtYouTubeRail from '../../src/app/components/TtYouTubeRail.svelte';
import { YT_HEIGHT, YT_WIDTH } from '../../src/app/engine/youtube/tt-yt-player-driver';
import type { TtTrack } from '../../src/app/engine/importer/types';

/**
 * docs/03 §2 Z4 YouTube rail — and specifically the ToS carve-out.
 *
 * Spike S1 measured what the *naive* rail does with a video playing: collapsed
 * left the player 0×0 under `display: none`, and Focus left it at opacity 0.06.
 * Both violate docs/06 §1.2. docs/03 §2 says the carve-out is "enforced in the
 * component, not left to layout discipline" — this is what enforces that claim.
 */

afterEach(cleanup);

const track = (id: string): TtTrack => ({
  id,
  source: 'youtube',
  status: 'ok',
  title: `Video ${id}`,
  artist: 'Channel',
  durationMs: null,
  videoId: `${id}0000000000`.slice(0, 11),
  addedAt: 0,
});

function mount(props: Partial<Parameters<typeof TtYouTubeRail>[1]> = {}) {
  const onskip = vi.fn();
  const onmount = vi.fn();
  render(TtYouTubeRail, {
    tracks: [track('a'), track('b')],
    currentId: 'a',
    shuffle: false,
    repeat: true,
    exhausted: false,
    overlay: null,
    skipInSeconds: null,
    focusMode: false,
    onmount,
    onskip,
    onremove: vi.fn(),
    onjump: vi.fn(),
    onshuffle: vi.fn(),
    onrepeat: vi.fn(),
    oninfo: vi.fn(),
    onmove: vi.fn(),
    ...props,
  });
  return { onskip, onmount };
}

describe('the player slot is the ToS size — docs/06 §1.2', () => {
  it('reserves exactly 384×216 in pixels, not a percentage', () => {
    // The floor is 200×200 and 16:9 was chosen so the native controls render
    // fully. A percentage could be shrunk below that by a future layout change
    // with nothing to notice.
    mount();
    const style = screen.getByTestId('tt-yt-player').getAttribute('style') ?? '';
    expect(style).toContain(`width: ${YT_WIDTH}px`);
    expect(style).toContain(`height: ${YT_HEIGHT}px`);
    // The ToS floor is SQUARE — 200×200. Deriving the height bound from the
    // aspect ratio made it 112.5, which passes at 200×113: measured 2026-07-23
    // by setting YT_HEIGHT to 150, where this file stayed green while the
    // player was well under the floor. A check that cannot fail is not a check.
    expect(YT_WIDTH).toBeGreaterThanOrEqual(200);
    expect(YT_HEIGHT).toBeGreaterThanOrEqual(200);
  });

  it('hands its mount element to the caller exactly once', () => {
    const { onmount } = mount();
    expect(onmount).toHaveBeenCalledTimes(1);
    expect(onmount.mock.calls[0]?.[0]).toBeInstanceOf(HTMLElement);
  });
});

describe('the carve-out — docs/03 §2, measured as broken by S1', () => {
  it('renders NO collapse control, so the `]` affordance cannot reach it', () => {
    // S1: a collapsed rail left the player 0×0 with audio still playing. The
    // control simply not existing here is stronger than disabling it.
    mount();
    const rail = screen.getByTestId('tt-yt-rail');
    const labels = [...rail.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(labels.some((l) => /thu gọn|collapse|\]/i.test(l))).toBe(false);
  });

  it('keeps the player mounted and the rail displayed in Focus mode', () => {
    // S1: Focus left the player at opacity 0.06 with the video still running.
    // The rail dims its own chrome; the player is never in the dimmed subtree.
    mount({ focusMode: true });
    expect(screen.getByTestId('tt-yt-player')).toBeTruthy();
    expect(screen.getByTestId('tt-yt-rail')).toBeTruthy();
  });

  it('drops the QUEUE in Focus mode, never the player', () => {
    mount({ focusMode: true });
    expect(screen.queryByTestId('tt-queue-panel')).toBeNull();
    expect(screen.getByTestId('tt-yt-player')).toBeTruthy();
  });

  it('shows the queue again when Focus is off', () => {
    mount({ focusMode: false });
    expect(screen.getByTestId('tt-queue-panel')).toBeTruthy();
  });
});

describe('typed overlays — docs/06 §4', () => {
  it('renders nothing when there is no error', () => {
    mount();
    expect(screen.queryByTestId('tt-yt-overlay')).toBeNull();
  });

  it('renders inside the player area, not as a routed page', () => {
    // A routed page would break the running countdown; an overlay elsewhere
    // would leave a failed video looking like a frozen player.
    mount({ overlay: { key: 'yt.err.blocked', code: 'TT-YT-150', ambiguous: true } });
    const player = screen.getByTestId('tt-yt-player');
    expect(player.contains(screen.getByTestId('tt-yt-overlay'))).toBe(true);
  });

  it('names BOTH age and region as possible causes', () => {
    // The wording S1 forced: the two are indistinguishable from the outside —
    // both 200 from oEmbed, both onError 150 — so naming one would be a guess
    // stated as a fact.
    mount({ overlay: { key: 'yt.err.blocked', code: 'TT-YT-150', ambiguous: true } });
    const text = screen.getByTestId('tt-yt-overlay').textContent ?? '';
    expect(text).toContain('tuổi');
    expect(text).toContain('khu vực');
    expect(text).toContain('nhúng');
  });

  it('carries the log code, so a screenshot is enough to file a bug', () => {
    mount({ overlay: { key: 'yt.err.gone', code: 'TT-YT-100', ambiguous: false } });
    expect(screen.getByTestId('tt-yt-overlay').textContent).toContain('TT-YT-100');
    expect(screen.getByTestId('tt-yt-overlay').dataset['ttKey']).toBe('yt.err.gone');
  });

  it('offers Skip now rather than only a countdown', () => {
    const { onskip } = mount({
      overlay: { key: 'yt.err.blocked', code: 'TT-YT-150', ambiguous: true },
    });
    void fireEvent.click(screen.getByTestId('tt-yt-skip'));
    expect(onskip).toHaveBeenCalled();
  });

  it("shows the countdown-to-skip docs/06 §4 lists among the card's parts", () => {
    // Without it the card sat still and then vanished, which reads as the app
    // losing its place rather than as a decision it announced.
    mount({
      overlay: { key: 'yt.err.blocked', code: 'TT-YT-150', ambiguous: true },
      skipInSeconds: 3,
    });
    expect(screen.getByTestId('tt-yt-skip-in').textContent).toContain('3');
  });

  it('renders no countdown when nothing is counting', () => {
    mount({ overlay: { key: 'yt.err.gone', code: 'TT-YT-100', ambiguous: false } });
    expect(screen.queryByTestId('tt-yt-skip-in')).toBeNull();
  });

  it('marks the one card whose cause cannot be narrowed, and only that one', () => {
    // `ambiguous` was declared with a paragraph of rationale, written on all four
    // branches, and read by nothing — a field whose only consumers were tests.
    mount({ overlay: { key: 'yt.err.blocked', code: 'TT-YT-150', ambiguous: true } });
    expect(screen.getByTestId('tt-yt-overlay').textContent).toContain('chưa rõ');
  });

  it('does not hedge a cause the edge named exactly', () => {
    mount({ overlay: { key: 'yt.err.gone', code: 'TT-YT-100', ambiguous: false } });
    expect(screen.getByTestId('tt-yt-overlay').textContent).not.toContain('chưa rõ');
  });

  it('is announced — role=alert, because it appears without user action', () => {
    mount({ overlay: { key: 'yt.err.player', code: 'TT-YT-005', ambiguous: false } });
    expect(screen.getByTestId('tt-yt-overlay').getAttribute('role')).toBe('alert');
  });
});

describe('the queue beneath', () => {
  it('shows no total-duration cap — docs/06 §5 imposes none', () => {
    mount();
    const totals = screen.getByTestId('tt-queue-totals').textContent ?? '';
    expect(totals).not.toContain('91:00');
  });
});
