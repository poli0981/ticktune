<script lang="ts">
  /**
   * Spike S5 harness — docs/15 §S5: a finish notification from a dedicated
   * worker while the tab is hidden and silent.
   *
   * Grant notifications, pick a length, Start, then hide the tab (switch tabs,
   * minimise, or cover the window) and wait past the deadline. The worker
   * notifies at the deadline only if this page last said it was hidden, and
   * writes everything to IndexedDB `ticktune-s5`, so the table below survives
   * a discarded tab. `pnpm s5` opens it as `?auto=<min>&label=<run>&collect=1`
   * in browsers it launches without automation.
   */
  import { onMount } from 'svelte';
  import type { TtS5Record } from './tt-s5.worker';

  let permission = $state(typeof Notification === 'undefined' ? 'n/a' : Notification.permission);
  let minutes = $state(25);
  let notify = $state(true);
  let runs = $state<TtS5Record[]>([]);
  let active = $state<string | null>(null);
  let worker: Worker | null = null;
  let collect = false;

  function db(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('ticktune-s5', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('runs', { keyPath: 'runId' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('ticktune-s5 open failed'));
    });
  }

  async function patch(runId: string, p: Partial<TtS5Record>): Promise<void> {
    if (collect)
      void fetch('/__s5', { method: 'POST', body: JSON.stringify({ runId, patch: p }) }).catch(
        () => {},
      );
    const d = await db();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = d.transaction('runs', 'readwrite');
        const store = tx.objectStore('runs');
        const get = store.get(runId);
        get.onsuccess = () => store.put({ ...(get.result as object | undefined), ...p, runId });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('patch failed'));
      });
    } finally {
      d.close();
    }
  }

  async function load(): Promise<TtS5Record[]> {
    const d = await db();
    try {
      return await new Promise<TtS5Record[]>((resolve, reject) => {
        const get = d.transaction('runs', 'readonly').objectStore('runs').getAll();
        get.onsuccess = () => resolve(get.result as TtS5Record[]);
        get.onerror = () => reject(get.error ?? new Error('load failed'));
      });
    } finally {
      d.close();
    }
  }

  async function clear(): Promise<void> {
    const d = await db();
    d.transaction('runs', 'readwrite').objectStore('runs').clear();
    d.close();
    runs = [];
  }

  const visibility: Array<[number, boolean]> = [];

  function onVisibility(): void {
    visibility.push([Date.now(), document.hidden]);
    worker?.postMessage({ type: 'visibility', hidden: document.hidden });
    if (active) void patch(active, { visibility: [...visibility] });
  }

  function start(mins = minutes, withNotify = notify, label?: string): string {
    worker ??= new Worker(new URL('./tt-s5.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (
      e: MessageEvent<{ type: string; runId: string; at?: number; firedAt?: number }>,
    ) => {
      const m = e.data;
      if (m.type === 'fired') {
        const seen = Date.now();
        void patch(m.runId, {
          pageSawFireAt: seen,
          pageLateMs: seen - (m.firedAt ?? seen) + 0,
        }).then(refresh);
      } else if (m.type === 'click') {
        window.focus();
        setTimeout(
          () =>
            void patch(m.runId, {
              clickAt: m.at ?? Date.now(),
              focusedAfterClick: document.hasFocus(),
            }),
          2000,
        );
      }
    };
    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    active = runId;
    visibility.length = 0;
    visibility.push([Date.now(), document.hidden]);
    worker.postMessage({
      type: 'start',
      runId,
      minutes: mins,
      endAtEpoch: Date.now() + mins * 60_000,
      notify: withNotify,
      hidden: document.hidden,
      title: 'TickTune — S5',
      body: `${mins} min deadline reached`,
      label,
      collect,
    });
    return runId;
  }

  async function refresh(): Promise<void> {
    runs = (await load()).sort((a, b) => b.startedAt - a.startedAt);
  }

  const report = () => JSON.stringify({ ua: navigator.userAgent, runs }, null, 2);

  onMount(() => {
    document.addEventListener('visibilitychange', onVisibility);
    void refresh();
    // `?auto=<minutes>`: start at once. `pnpm s5` opens the harness this way in
    // a browser launched WITHOUT automation — under Playwright every page
    // reports 'visible', background tab or not (measured), so a hidden run can
    // only be honest in a browser nobody is driving.
    const q = new URLSearchParams(location.search);
    collect = q.get('collect') === '1';
    const auto = Number(q.get('auto'));
    if (auto > 0) start(auto, true, q.get('label') ?? undefined);
    (window as unknown as { __ttS5: unknown }).__ttS5 = {
      start,
      results: async () => {
        await refresh();
        return runs;
      },
      clear,
      caps: () => ({
        permission: typeof Notification === 'undefined' ? 'n/a' : Notification.permission,
        serviceWorker: 'serviceWorker' in navigator,
        ua: navigator.userAgent,
      }),
    };
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });
</script>

<section class="mx-auto max-w-5xl p-8 font-mono text-sm">
  <h1 class="mb-1 text-xl font-semibold">S5 — finish notification from a worker, tab hidden</h1>
  <p class="mb-6 text-xs text-tt-muted">
    docs/15 §S5. Grant, Start, then hide this tab and keep it silent until after the deadline. Come
    back and press Copy JSON.
  </p>

  <div class="flex flex-wrap items-center gap-4">
    <button
      class="tt-b"
      onclick={async () => {
        permission = await Notification.requestPermission();
      }}>notifications: {permission}</button
    >
    <label
      >minutes
      <select bind:value={minutes} class="ml-1 border border-tt-line bg-tt-surface px-2 py-1">
        <option value={1}>1</option>
        <option value={5}>5</option>
        <option value={25}>25</option>
        <option value={30}>30</option>
        <option value={90}>90</option>
      </select>
    </label>
    <label><input type="checkbox" bind:checked={notify} /> notify</label>
    <button class="tt-b" data-testid="s5-start" onclick={() => start()}>start</button>
    <button class="tt-b" onclick={() => void refresh()}>refresh</button>
    <button class="tt-b" onclick={() => void navigator.clipboard.writeText(report())}
      >copy JSON</button
    >
    <button class="tt-b" onclick={() => void clear()}>clear</button>
  </div>

  <table class="mt-6 w-full text-xs">
    <thead>
      <tr class="text-left text-tt-muted">
        <th>run</th>
        <th>min</th>
        <th>hidden at zero</th>
        <th>worker late</th>
        <th>shown late</th>
        <th>page late</th>
        <th>max tick gap</th>
        <th>notified</th>
        <th>error</th>
      </tr>
    </thead>
    <tbody>
      {#each runs as r (r.runId)}
        <tr class:bad={r.lateMs !== undefined && r.lateMs > 2000}>
          <td>{r.runId}</td>
          <td>{r.minutes}</td>
          <td>{r.hiddenAtFire ?? '…'}</td>
          <td>{r.lateMs ?? '…'}</td>
          <td>{r.shownLateMs ?? '–'}</td>
          <td>{r.pageSawFireAt && r.endAtEpoch ? r.pageSawFireAt - r.endAtEpoch : '–'}</td>
          <td>{r.maxTickGapMs ?? '–'}</td>
          <td>{r.notified ?? '–'}</td>
          <td>{r.error ?? ''}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  .tt-b {
    border: 1px solid var(--color-tt-line);
    background: var(--color-tt-surface);
    color: var(--color-tt-signal);
    border-radius: 0.25rem;
    padding: 0.3rem 0.9rem;
  }
  .bad {
    color: var(--color-tt-danger);
  }
</style>
