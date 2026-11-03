import { describe, expect, it, vi } from 'vitest';
import { browserLeavePorts, leaveGate } from '../../src/lib/tt-leave';

/**
 * The Legal Gate's way out — docs/03 §3 item 2 (v2.1).
 *
 * Every branch, with the browser calls faked: what Playwright can show is one
 * engine's answer to `window.close()` (legal-gate.spec.ts); what each branch
 * DOES is here.
 */

function ports(over: { length?: number; closes?: boolean } = {}) {
  const calls: string[] = [];
  let closed = false;
  return {
    calls,
    ports: {
      historyLength: () => over.length ?? 1,
      back: () => calls.push('back'),
      close: () => {
        calls.push('close');
        closed = over.closes ?? false;
      },
      closed: () => closed,
      replace: (url: string) => calls.push(`replace:${url}`),
    },
  };
}

describe('leaveGate', () => {
  it('goes back when anything is behind this page — the browser’s own ←', () => {
    const p = ports({ length: 3 });
    expect(leaveGate(p.ports)).toBe('back');
    expect(p.calls).toEqual(['back']);
  });

  it('with nothing behind it, closes the tab when the browser lets script do so', () => {
    const p = ports({ length: 1, closes: true });
    expect(leaveGate(p.ports)).toBe('closed');
    expect(p.calls).toEqual(['close']);
  });

  it('and otherwise opens a blank page — never a home page no page may open', () => {
    const p = ports({ length: 1, closes: false });
    expect(leaveGate(p.ports)).toBe('blank');
    expect(p.calls).toEqual(['close', 'replace:about:blank']);
  });

  it('never waits on a timer after going back', () => {
    // A slow cross-origin back navigation would race one (see the module note).
    vi.useFakeTimers();
    const p = ports({ length: 2 });
    leaveGate(p.ports);
    vi.runAllTimers();
    expect(p.calls).toEqual(['back']);
    vi.useRealTimers();
  });
});

describe('browserLeavePorts', () => {
  it('reads and drives the window it is given', () => {
    const back = vi.fn();
    const close = vi.fn();
    const replace = vi.fn();
    const w = {
      history: { length: 4, back },
      close,
      closed: false,
      location: { replace },
    } as unknown as Window;

    const p = browserLeavePorts(w);
    expect(p.historyLength()).toBe(4);
    p.back();
    p.close();
    p.replace('about:blank');
    expect(p.closed()).toBe(false);
    expect([back, close, replace].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
    expect(replace).toHaveBeenCalledWith('about:blank');
  });
});
