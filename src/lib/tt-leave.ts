/**
 * The Legal Gate's way out — docs/03 §3 item 2 (v2.1).
 *
 * The owner asked for a button back to "the browser's default home page".
 * No page can open that: `about:home`, `about:newtab` and `chrome://newtab` are
 * refused to web content, and Firefox's old `window.home()` is gone. So the
 * button does what the browser's own ← does, which is the same place when the
 * app was opened from a new tab — that tab's page is the entry behind it.
 *
 * 1. Anything behind this page → `history.back()`.
 * 2. Nothing behind it → `window.close()`. A tab with one history entry, and
 *    the installed app's window, may be closed by script.
 * 3. Still open → `about:blank`, the closest thing to an empty tab.
 *
 * No timer after `back()`. A slow cross-origin back navigation would race it,
 * and the user would land on a blank page instead of where they came from.
 * Not the Navigation API's `canGoBack` either: it counts same-origin entries
 * only, so it is false exactly when the user came from another site or from
 * the new-tab page. The one edge left — a tab with only FORWARD history — does
 * nothing, as the browser's own disabled ← does.
 *
 * The browser calls are injected so every branch is a unit test.
 */

interface TtLeavePorts {
  historyLength: () => number;
  back: () => void;
  close: () => void;
  closed: () => boolean;
  replace: (url: string) => void;
}

export function leaveGate(ports: TtLeavePorts): 'back' | 'closed' | 'blank' {
  if (ports.historyLength() > 1) {
    ports.back();
    return 'back';
  }
  ports.close();
  if (ports.closed()) return 'closed';
  ports.replace('about:blank');
  return 'blank';
}

export function browserLeavePorts(w: Window): TtLeavePorts {
  return {
    historyLength: () => w.history.length,
    back: () => w.history.back(),
    close: () => w.close(),
    closed: () => w.closed,
    replace: (url) => w.location.replace(url),
  };
}
