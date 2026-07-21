import { describe, it, expect, vi } from 'vitest';
import {
  TtLog,
  TT_LOG_CAPACITY,
  TT_DIAGNOSTICS_TAIL,
  installGlobalCapture,
} from '../../src/app/engine/log/tt-log';

/** docs/13 §1: "ring-buffer wrap at 500; level filter; diagnostics payload shape". */

const at = (t = 1_000) => {
  let n = t;
  return () => n++;
};

describe('ring buffer', () => {
  it('defaults to the documented capacity of 500', () => {
    expect(TT_LOG_CAPACITY).toBe(500);
  });

  it('keeps everything below capacity, oldest first', () => {
    const log = new TtLog(500, at());
    for (let i = 0; i < 10; i++) log.info('TT-IMP-005', `n${i}`);
    const e = log.entries();
    expect(e).toHaveLength(10);
    expect(e[0]?.message).toBe('n0');
    expect(e[9]?.message).toBe('n9');
  });

  it('wraps at capacity, discarding the oldest', () => {
    const log = new TtLog(500, at());
    for (let i = 0; i < 600; i++) log.info('TT-IMP-005', `n${i}`);

    expect(log.size).toBe(500);
    expect(log.written).toBe(600); // total ever seen, not slots used
    const e = log.entries();
    expect(e).toHaveLength(500);
    expect(e[0]?.message).toBe('n100'); // n0..n99 evicted
    expect(e[499]?.message).toBe('n599');
  });

  it('stays ordered across the wrap point, not rotated', () => {
    // The bug a naive modulo implementation produces: reading slot 0 first, so
    // the newest entries appear before the oldest.
    const log = new TtLog(4, at());
    for (const m of ['a', 'b', 'c', 'd', 'e', 'f']) log.info('TT-IMP-005', m);
    expect(log.entries().map((x) => x.message)).toEqual(['c', 'd', 'e', 'f']);
  });

  it('clear() empties it', () => {
    const log = new TtLog(10, at());
    log.warn('TT-SYS-202');
    log.clear();
    expect(log.entries()).toEqual([]);
    expect(log.size).toBe(0);
  });
});

describe('entries', () => {
  it('filters by level for the diagnostics viewer', () => {
    const log = new TtLog(10, at());
    log.info('TT-IMP-005', 'i');
    log.warn('TT-SYS-202', 'w');
    log.error('TT-PLY-101', 'e');

    expect(log.entries('warn').map((x) => x.code)).toEqual(['TT-SYS-202']);
    expect(log.entries('error').map((x) => x.code)).toEqual(['TT-PLY-101']);
    expect(log.entries()).toHaveLength(3);
  });

  it('records level, code, timestamp and optional trackId', () => {
    const log = new TtLog(10, () => 4_242);
    const e = log.error('TT-PLY-101', 'decode failed', 'abc123');
    expect(e).toEqual({
      ts: 4_242,
      level: 'error',
      code: 'TT-PLY-101',
      message: 'decode failed',
      trackId: 'abc123',
    });
  });

  it('omits trackId entirely when absent rather than writing undefined', () => {
    // exactOptionalPropertyTypes (docs/12 §2) — and it keeps the JSON clean.
    const log = new TtLog(10, at());
    expect('trackId' in log.info('TT-IMP-005')).toBe(false);
  });
});

describe('subscribe', () => {
  it('notifies listeners and can be unsubscribed', () => {
    const log = new TtLog(10, at());
    const seen = vi.fn();
    const off = log.subscribe(seen);
    log.info('TT-IMP-005');
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    log.info('TT-IMP-005');
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('diagnostics payload (docs/02 §7)', () => {
  it('has the documented shape', () => {
    const log = new TtLog(500, () => 1_700_000_000_000);
    log.info('TT-IMP-005', 'dup');
    const d = log.diagnostics({
      version: '0.1.0',
      ua: 'test-ua',
      mode: 'playlist',
      settings: { volume: 0.8 },
    });

    expect(d.app).toBe('TickTune');
    expect(d).toMatchObject({ version: '0.1.0', ua: 'test-ua', mode: 'playlist' });
    expect(d.settings).toEqual({ volume: 0.8 });
    expect(d.capturedAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(d.log).toHaveLength(1);
  });

  it('carries only the tail, not the whole buffer', () => {
    const log = new TtLog(500, at());
    for (let i = 0; i < 300; i++) log.info('TT-IMP-005', `n${i}`);
    const d = log.diagnostics({ version: '0', ua: '', mode: 'single', settings: {} });

    expect(TT_DIAGNOSTICS_TAIL).toBe(50);
    expect(d.log).toHaveLength(50);
    expect(d.log[0]?.message).toBe('n250');
    expect(d.log[49]?.message).toBe('n299');
  });

  it('contains no file paths or user strings — the bug template promises this', () => {
    // docs/12 §6 message-content rule. The payload is only safe to paste into a
    // public issue if nothing user-supplied can reach it, so assert on the
    // serialised blob rather than trusting each call site.
    const log = new TtLog(500, at());
    log.warn('TT-IMP-007', 'tag unreliable', 'nanoid123');
    const blob = JSON.stringify(
      log.diagnostics({ version: '0.1.0', ua: 'ua', mode: 'single', settings: {} }),
    );
    expect(blob).not.toMatch(/[A-Za-z]:\\|\/home\/|\/Users\//);
    expect(blob).not.toContain('.mp3');
  });
});

describe('global capture (docs/02 §7)', () => {
  function fakeWindow() {
    const handlers = new Map<string, EventListener>();
    return {
      handlers,
      addEventListener: (t: string, h: EventListener) => handlers.set(t, h),
      removeEventListener: (t: string) => handlers.delete(t),
    } as unknown as Window & { handlers: Map<string, EventListener> };
  }

  it('records window.onerror as TT-SYS-300, name only', () => {
    const log = new TtLog(10, at());
    const w = fakeWindow();
    installGlobalCapture(w, log);

    (w as unknown as { handlers: Map<string, EventListener> }).handlers.get('error')?.({
      error: new TypeError('Cannot read /Users/me/song.mp3'),
    } as unknown as Event);

    const e = log.entries()[0];
    expect(e?.code).toBe('TT-SYS-300');
    expect(e?.level).toBe('error');
    // The message would have leaked a real path into a "safe to paste" payload.
    expect(e?.message).toBe('TypeError');
    expect(e?.message).not.toContain('song.mp3');
  });

  it('records unhandledrejection as TT-SYS-301', () => {
    const log = new TtLog(10, at());
    const w = fakeWindow();
    installGlobalCapture(w, log);

    (w as unknown as { handlers: Map<string, EventListener> }).handlers.get('unhandledrejection')?.(
      { reason: new RangeError('nope') } as unknown as Event,
    );

    expect(log.entries()[0]?.code).toBe('TT-SYS-301');
    expect(log.entries()[0]?.message).toBe('RangeError');
  });

  it('uninstalls cleanly', () => {
    const w = fakeWindow();
    const off = installGlobalCapture(w, new TtLog(10, at()));
    expect((w as unknown as { handlers: Map<string, EventListener> }).handlers.size).toBe(2);
    off();
    expect((w as unknown as { handlers: Map<string, EventListener> }).handlers.size).toBe(0);
  });
});
