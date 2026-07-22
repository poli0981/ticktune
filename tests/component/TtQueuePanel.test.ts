import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import TtQueuePanel from '../../src/app/components/TtQueuePanel.svelte';
import type { TtTrack } from '../../src/app/engine/importer/types';

/**
 * docs/13 §2 — TtQueuePanel.
 *
 * The list was named in docs/13 §2 from the start and never had a test, exactly
 * like TtCountdown before it. What is asserted here is what a rendering bug
 * would look like from the outside: the wrong row highlighted, the wrong track's
 * metadata in the modal, and a totals figure that is confidently wrong.
 */

afterEach(cleanup);

const track = (id: string, over: Partial<TtTrack> = {}): TtTrack => ({
  id,
  source: 'local',
  status: 'ok',
  title: `Bài ${id}`,
  artist: `Nghệ sĩ ${id}`,
  durationMs: 61_000,
  addedAt: 0,
  ...over,
});

function mount(props: Partial<Parameters<typeof TtQueuePanel>[1]> = {}) {
  const onremove = vi.fn();
  const onjump = vi.fn();
  const onshuffle = vi.fn();
  const onrepeat = vi.fn();
  const oninfo = vi.fn();
  render(TtQueuePanel, {
    tracks: [track('a'), track('b'), track('c')],
    variant: 'rail',
    currentId: null,
    shuffle: false,
    repeat: true,
    exhausted: false,
    onremove,
    onjump,
    onshuffle,
    onrepeat,
    oninfo,
    ...props,
  });
  return { onremove, onjump, onshuffle, onrepeat, oninfo };
}

describe('rows', () => {
  it('renders one row per track, in queue order', () => {
    mount();
    const rows = screen.getAllByTestId('tt-queue-row');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.dataset['ttId'])).toEqual(['a', 'b', 'c']);
  });

  it('highlights only the current track', () => {
    mount({ currentId: 'b' });
    const rows = screen.getAllByTestId('tt-queue-row');
    expect(rows.map((r) => r.classList.contains('tt-current'))).toEqual([false, true, false]);
    // aria-current is what a screen reader has to go on; the class alone would
    // announce nothing.
    expect(rows[1]?.querySelector('[aria-current="true"]')).not.toBeNull();
  });

  it('highlights nothing before Start', () => {
    mount({ currentId: null });
    const rows = screen.getAllByTestId('tt-queue-row');
    expect(rows.some((r) => r.classList.contains('tt-current'))).toBe(false);
  });

  it('shows an errored track struck through rather than hiding it', () => {
    // docs/02 §1: it stays visible so the user can see WHY Start is disabled.
    mount({ tracks: [track('a'), track('b', { status: 'error' })] });
    const rows = screen.getAllByTestId('tt-queue-row');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.classList.contains('tt-error')).toBe(true);
  });

  it('applies the N/A fallback to a missing title', () => {
    mount({ tracks: [track('a', { title: '' })] });
    expect(screen.getByText('N/A')).toBeTruthy();
  });
});

describe('the totals footer — docs/03 §2', () => {
  it('counts playable tracks and sums their durations', () => {
    mount();
    expect(screen.getByTestId('tt-queue-totals').textContent).toContain('3 bài');
    // 3 × 61 s = 183 s → 3:03, against the 91:00 cap.
    expect(screen.getByTestId('tt-queue-totals').textContent).toContain('3:03 / 91:00');
  });

  it('renders – when ANY duration is unknown, never a sum over the known subset', () => {
    // The failure this exists to prevent: a partial sum is a wrong number that
    // reads as authoritative. Hard invariant 5 says missing numeric → `–`, and
    // S3 measured ~16% of a real library as having unusable tags, so one
    // untagged file in a 95-track queue is the ordinary case.
    mount({ tracks: [track('a'), track('b', { durationMs: null }), track('c')] });
    const totals = screen.getByTestId('tt-queue-totals').textContent ?? '';
    expect(totals).toContain('3 bài');
    expect(totals).toContain('– / 91:00');
    expect(totals).not.toContain('2:02');
  });

  it('excludes errored tracks from the count', () => {
    mount({ tracks: [track('a'), track('b', { status: 'error' })] });
    expect(screen.getByTestId('tt-queue-totals').textContent).toContain('1 bài');
  });
});

describe('interaction', () => {
  it('opens the info modal for the row that was right-clicked, not the first one', async () => {
    // The bug this pins: the modal was bound to `playback.track` through P2,
    // which is correct for one track and shows row 1 for every row of a queue.
    const { oninfo } = mount();
    const rows = screen.getAllByTestId('tt-queue-row');
    await fireEvent.contextMenu(rows[2]?.querySelector('button') as Element);

    expect(oninfo).toHaveBeenCalledTimes(1);
    expect(oninfo.mock.calls[0]?.[0]).toMatchObject({ id: 'c' });
  });

  it('reaches the same modal from the keyboard', async () => {
    // docs/03 §8 requires a context-menu equivalent via Menu / Shift+F10.
    const { oninfo } = mount();
    const first = screen.getAllByTestId('tt-queue-row')[0]?.querySelector('button') as Element;
    await fireEvent.keyDown(first, { key: 'ContextMenu' });
    expect(oninfo.mock.calls[0]?.[0]).toMatchObject({ id: 'a' });
  });

  it('removes by id', async () => {
    const { onremove } = mount();
    await fireEvent.click(screen.getAllByTestId('tt-queue-remove')[1] as Element);
    expect(onremove).toHaveBeenCalledWith('b');
  });

  it('toggles report the value they are moving TO', async () => {
    const { onshuffle, onrepeat } = mount({ shuffle: false, repeat: true });
    await fireEvent.click(screen.getByTestId('tt-shuffle'));
    await fireEvent.click(screen.getByTestId('tt-repeat'));
    expect(onshuffle).toHaveBeenCalledWith(true);
    expect(onrepeat).toHaveBeenCalledWith(false);
  });

  it('reflects toggle state to assistive tech, not just to CSS', () => {
    mount({ shuffle: true, repeat: false });
    expect(screen.getByTestId('tt-shuffle').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('tt-repeat').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('exhaustion — docs/02 §5.1 rule 6', () => {
  it('says so, and only when it happened', () => {
    mount({ exhausted: false });
    expect(screen.queryByTestId('tt-playlist-ended')).toBeNull();

    cleanup();
    mount({ exhausted: true });
    expect(screen.getByTestId('tt-playlist-ended').textContent).toContain('Đã hết danh sách');
  });
});

describe('empty state', () => {
  it('says the queue is empty instead of rendering a bare footer', () => {
    mount({ tracks: [] });
    expect(screen.getByText('Chưa có bài nào.')).toBeTruthy();
    expect(screen.queryByTestId('tt-queue-totals')).toBeNull();
  });
});
