import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
 * reconstructed in the page. Note the resulting `DataTransfer.items` have no
 * `webkitGetAsEntry`, which means this also exercises the importer's documented
 * fallback to the flat `dt.files` list (docs/02 §4 step 0) — the path older
 * Firefox and every synthetic event take.
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
