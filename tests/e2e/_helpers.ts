import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Skip a test that genuinely needs Web Audio, stating **which** reason applies.
 *
 * `docs/13 §3`: skip for the real reason or not at all.
 *
 * - **Firefox** has the API but no output **device** on the CI runner, so
 *   `AudioContext.resume()` hangs. Measured 2026-07-21. Not detectable by
 *   feature test — the constructor exists and lies — so it stays name-based.
 * - **Any build with no `AudioContext` at all** — detected, not assumed.
 *
 * 🔴 **The second clause was `browserName === 'webkit'` for exactly one day, and
 * that was wrong.** Playwright's WebKit on **Windows** exposes no `AudioContext`
 * (`ReferenceError: Can't find variable: AudioContext`, which is how 130 of 166
 * specs failed when desktop WebKit was first added); the **Linux CI build has
 * it**. A skip keyed on the browser name therefore stated a reason that was
 * false on the machine that matters most.
 *
 * `harness-assumptions.spec.ts` caught it on the first CI run after it was
 * written — the guard justified itself within a day. The fix is the real lesson:
 * **skip on the capability, not on a proxy for it.** A feature test cannot drift
 * from the platform, and it needs no guard of its own.
 *
 * ⚠️ Chromium is still the only project asserting audible **output**. Say that
 * rather than implying four-browser coverage.
 */
export async function skipWithoutAudio(page: Page, browserName: string): Promise<void> {
  test.skip(
    browserName === 'firefox',
    'CI Firefox has no audio output device — AudioContext.resume() hangs (docs/13 §3)',
  );

  const hasAudioContext = await page.evaluate(
    () => typeof (globalThis as { AudioContext?: unknown }).AudioContext !== 'undefined',
  );
  test.skip(!hasAudioContext, `this ${browserName} build exposes no AudioContext (docs/13 §3)`);
}

/**
 * Get past the legal gate.
 *
 * Every Playwright context starts with empty storage, so `/app/` always opens
 * on the gate (docs/02 §1) — any test that wants the app itself has to go
 * through it. That is the app behaving correctly, not test friction: the gate
 * is what unlocks autoplay (docs/05 §1), so a test that skipped it would be
 * exercising a state real users never reach.
 *
 * Idempotent: no-ops when the gate is not showing.
 */
export async function acceptLegalGate(page: Page): Promise<void> {
  // Boot is async — settings load from IndexedDB first — so the gate does not
  // exist yet immediately after navigation. Checking for it right away finds
  // nothing and races past the gate that is about to appear.
  await page.waitForFunction(() => !!document.documentElement.dataset['ttBooted']);
  const gate = page.locator('[role=dialog]');
  if ((await gate.count()) === 0) return;
  await page.getByTestId('tt-gate-agree').check();
  await page.getByTestId('tt-gate-accept').click();
  await expect(gate).toBeHidden();
}

/** Open a route and clear the gate in one step. */
export async function gotoApp(page: Page, path = '/app/'): Promise<void> {
  await page.goto(path);
  await acceptLegalGate(page);
}

/**
 * Open the app on Setup **in Single mode**.
 *
 * For specs that drive the file input directly rather than through
 * `stageSingle`. Since P3 a fresh profile boots into Playlist (docs/02 §1's
 * first-run default), so "Single" has to be asked for.
 */
export async function gotoSingleMode(page: Page, path = '/app/'): Promise<void> {
  await gotoApp(page, path);
  await page.getByTestId('tt-tab-single').click();
}

/**
 * Stage a Single-mode track so Start is enabled.
 *
 * From P2, `isReady` requires a playable track (docs/02 §1), so every test that
 * clicks Bắt đầu needs one. Without this the button is disabled for the QUEUE
 * reason and a test named after the countdown range would pass while asserting
 * nothing about it.
 */
export async function stageSingle(page: Page, fixture = 'tone-5s.mp3'): Promise<void> {
  // Select the mode explicitly rather than relying on the default. P3 unlocked
  // the Playlist tab and `TT_DEFAULT_SETTINGS.lastMode` is 'playlist' (docs/02
  // §1's stated first-run default), so a fresh profile now lands there. A helper
  // named `stageSingle` should never have depended on which tab happened to be
  // selected — that it did is why this line is a one-time fix and not a habit.
  await page.getByTestId('tt-tab-single').click();
  await page.getByTestId('tt-file-input').setInputFiles(`tests/e2e/fixtures/${fixture}`);
  await expect(page.getByTestId('tt-staged')).toBeVisible();
}

/**
 * Stage several tracks in Playlist mode.
 *
 * Uses the picker rather than `dropFiles` because the input carries `multiple`
 * in this mode, and because a synthetic drop cannot exercise the picker path at
 * all. Waits on the row count, not on the panel: the panel renders empty too.
 */
export async function stagePlaylist(page: Page, fixtures: string[]): Promise<void> {
  await page.getByTestId('tt-tab-playlist').click();
  await page
    .getByTestId('tt-file-input')
    .setInputFiles(fixtures.map((f) => `tests/e2e/fixtures/${f}`));
  await expect(page.getByTestId('tt-queue-row')).toHaveCount(fixtures.length);
}

/**
 * Stage `count` tracks that are byte-identical but distinctly NAMED.
 *
 * The dedupe key is `name::size::duration` (docs/02 §4 step 5), so renaming is
 * enough to make copies of one fixture count as separate tracks — passing the
 * same path N times would measure dedupe instead, and add exactly one row.
 *
 * Buffers go through `setInputFiles`, which takes them directly; `dropFiles`
 * base64-inlines every byte through one `page.evaluate` argument and does not
 * scale to a long queue.
 */
export async function stageManyTracks(page: Page, count: number): Promise<void> {
  const buffer = readFileSync(join('tests/e2e/fixtures', 'tone-5s.mp3'));
  await page.getByTestId('tt-tab-playlist').click();
  await page.getByTestId('tt-file-input').setInputFiles(
    Array.from({ length: count }, (_, i) => ({
      name: `track-${String(i).padStart(3, '0')}.mp3`,
      mimeType: 'audio/mpeg',
      buffer,
    })),
  );
  await expect(page.getByTestId('tt-queue-row')).toHaveCount(count);
}

/** Set the countdown inputs. They keep the P1 labels deliberately. */
export async function setDuration(page: Page, h: number, m: number, s: number): Promise<void> {
  await page.getByLabel('giờ').fill(String(h));
  await page.getByLabel('phút').fill(String(m));
  await page.getByLabel('giây').fill(String(s));
}

/**
 * The `beforeunload` guard fires whenever a queue is staged (docs/02 §3), and
 * an unhandled dialog hangs the run. Accept it by default in specs that stage.
 */
export function dismissUnloadDialogs(page: Page): void {
  page.on('dialog', (d) => void d.accept());
}

/**
 * Drop real files on the Setup drop zone.
 *
 * Playwright cannot synthesise a native drag, so the files are read here and
 * reconstructed in the page.
 *
 * ⚠️ **What that exercises is engine-dependent, and the previous note here was
 * wrong.** It claimed the synthetic `DataTransfer.items` "have no
 * `webkitGetAsEntry`". Measured 2026-07-25: both Chromium and WebKit expose the
 * method. What differs is what it *returns*:
 *
 * | | `webkitGetAsEntry()` | so the driver takes |
 * |---|---|---|
 * | Chromium | `null` | the flat `dt.files` fallback — works |
 * | WebKit | a real `FileSystemFileEntry` | the **entry-walking** path |
 *
 * and on WebKit the walk then fails: `entry.file()` calls back with
 * `NotFoundError: Path does not exist`, because a `File` built in JS has no
 * filesystem behind it for the entry to resolve against.
 *
 * 🔴 **That is a harness limit, not a product defect.** A real drag in Safari
 * hands over entries backed by real paths and `entry.file()` succeeds; nothing
 * reachable from JS can fake that. It is the same shape as `docs/13 §3`'s
 * pointer-events reorder decision — the browser will not let a script forge a
 * native drag. The real Safari drop path is therefore a **live-checklist** line,
 * not an automatable one.
 */
export async function dropFiles(page: Page, fixtures: string[]): Promise<void> {
  const payload = fixtures.map((name) => ({
    name,
    data: readFileSync(join('tests/e2e/fixtures', name)).toString('base64'),
  }));

  await page.evaluate((files) => {
    const dt = new DataTransfer();
    for (const f of files) {
      const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], f.name));
    }
    const zone = document.querySelector('[data-testid=tt-dropzone]');
    zone?.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  }, payload);
}

/**
 * The settings row as IndexedDB currently holds it — not as the store holds it.
 *
 * `settings.patch()` updates memory synchronously and writes to Dexie
 * asynchronously, and every call site fires it with `void` (docs/05 §1's gesture
 * chain is why). So a spec that clicks a control and reloads immediately can
 * out-run the write and read back the OLD value — which looks exactly like the
 * setting not persisting at all.
 *
 * Poll this before a reload rather than reordering the clicks to hide it:
 *
 *     await expect.poll(() => storedSettings(page)).toMatchObject({ scanlines: false });
 */
export async function storedSettings(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const req = indexedDB.open('ticktune');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    if (!db.objectStoreNames.contains('settings')) return null;
    return new Promise<Record<string, unknown> | null>((res, rej) => {
      const get = db.transaction('settings', 'readonly').objectStore('settings').get('app');
      get.onsuccess = () => res((get.result as Record<string, unknown> | undefined) ?? null);
      get.onerror = () => rej(get.error);
    });
  });
}
