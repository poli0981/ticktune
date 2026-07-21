import { expect, type Page } from '@playwright/test';

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
