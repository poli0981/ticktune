import { test, expect, type Page } from '@playwright/test';
import { dismissUnloadDialogs, setDuration } from './_helpers';
import { gotoYouTubeApp, stageLinks } from './_helpers-yt';

/**
 * docs/06 §1.2 / docs/03 §2 — the player is visible and unobscured, end to end.
 *
 * ## Why this file exists separately from `youtube.spec.ts`
 *
 * `youtube.spec.ts` says, correctly for P4, that there is "deliberately no
 * Focus-mode spec" because `TtApp` passed `focusMode={false}` as a literal.
 * P5 slice 2 makes Focus reachable, and `16 §P4` files the carve-out end to end
 * as a **P5 exit item**. This is that item.
 *
 * ## And why it sweeps viewport widths
 *
 * Measured 2026-07-23 while planning the slice, and it found a bug that was
 * **already live in v0.5.2**: in docs/04 §4's `>= 1 h` regime the countdown is
 * 4.48 em wide (against 3.46 for `88:88`), neither flex item could shrink below
 * its min-content size, and the overflow went off the right edge — taking the
 * player with it. At 1280 px, 224 px of the 384 px player was off screen. Every
 * existing YouTube spec used a one-minute countdown, so every one of them ran
 * in the narrowest regime and passed.
 *
 * ⚠️ Never assert this with `Element.checkVisibility({ checkOpacity: true })`.
 * Spike S1 measured it returning **true** at opacity 0.06 — it only catches
 * exactly 0. Computed opacity plus the box is the assertion.
 */

const ID = 'jNQXAC9IVRw';

interface PlayerGeometry {
  box: { x: number; y: number; w: number; h: number };
  opacity: number;
  display: string;
  fullyOnScreen: boolean;
  /** Any element painted above the player that intersects its rect. */
  covering: string[];
}

async function playerGeometry(page: Page): Promise<PlayerGeometry> {
  return page.evaluate(() => {
    const player = document.querySelector('[data-testid=tt-yt-player]') as HTMLElement;
    const r = player.getBoundingClientRect();
    const style = getComputedStyle(player);

    /*
     * Everything painted over the player rect that is not part of it. Stricter
     * than naming each overlay by hand: a future one inherits the check.
     *
     * ⚠️ Sampled across a GRID, not at the centre. A centre-only probe was
     * written first and measured useless: with the countdown's size cap removed
     * the digits overlapped the player's left edge by 79 px and the centre
     * point still saw nothing but the player. The failure mode this exists for
     * arrives from one side, which is exactly where a single sample is blind.
     */
    const covering = new Set<string>();
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        const x = Math.min(r.right - 1, r.x + 1 + ((r.width - 2) * i) / 4);
        const y = Math.min(r.bottom - 1, r.y + 1 + ((r.height - 2) * j) / 4);
        for (const el of document.elementsFromPoint(x, y)) {
          if (player.contains(el) || el.contains(player)) continue;
          covering.add(el.getAttribute('data-testid') ?? el.tagName.toLowerCase());
        }
      }
    }

    return {
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
      opacity: parseFloat(style.opacity),
      display: style.display,
      fullyOnScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      covering: [...covering],
    };
  });
}

/** Every ToS condition in one place, so no caller can assert half of them. */
function expectPlayerCompliant(g: PlayerGeometry) {
  expect(g.display).not.toBe('none');
  // The floor is 200×200 and SQUARE (docs/06 §1.2) — not an aspect-derived
  // height, which would let 200×113 pass.
  expect(g.box.w).toBeGreaterThanOrEqual(200);
  expect(g.box.h).toBeGreaterThanOrEqual(200);
  // S1 measured 0.06 passing `checkVisibility`. Assert the number.
  expect(g.opacity).toBe(1);
  expect(g.fullyOnScreen).toBe(true);
  expect(g.covering).toEqual([]);
}

/** Stage a video and run a countdown long enough to stay in the given regime. */
async function playing(page: Page, h: number, m: number): Promise<void> {
  dismissUnloadDialogs(page);
  await gotoYouTubeApp(page);
  await stageLinks(page, [ID]);
  await setDuration(page, h, m, 0);
  await page.getByRole('button', { name: 'Bắt đầu' }).click();
  await expect(page.getByTestId('tt-yt-frame')).toBeVisible();
}

test.describe('the player survives every viewport width', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  // 1024 is docs/07 §2's `TT_GATE.minWidth`, and the gate is evaluated ONCE at
  // load on purpose — a desktop window snapped narrower mid-session stays in
  // the app, so these widths are all reachable by a real user.
  for (const width of [1920, 1600, 1366, 1280, 1152, 1024]) {
    test(`>= 1 h countdown at ${width} px leaves the player fully visible`, async ({ page }) => {
      // TWO HOURS. The widest of docs/04 §4's three regimes, and the one every
      // other YouTube spec skips by using a one-minute countdown.
      await playing(page, 2, 0);
      await page.setViewportSize({ width, height: 800 });
      expectPlayerCompliant(await playerGeometry(page));

      // No horizontal scroll either: a player that is "on screen" only because
      // the page scrolls sideways is not visible in any useful sense.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    });
  }
});

test.describe('Focus mode keeps the player — docs/03 §2 carve-out', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('H hides the queue and the chrome, and never the player', async ({ page }) => {
    await playing(page, 0, 5);
    await expect(page.getByTestId('tt-yt-rail')).toBeVisible();

    await page.keyboard.press('h');

    // Z5/Z6/Z7 go, as in every other mode...
    await expect(page.getByTestId('tt-brand')).toHaveCount(0);
    await expect(page.getByTestId('tt-chrome')).toHaveCount(0);
    // ...but the rail stays, reduced to the player alone.
    await expect(page.getByTestId('tt-yt-rail')).toBeVisible();
    await expect(page.getByTestId('tt-queue-row')).toHaveCount(0);
    expectPlayerCompliant(await playerGeometry(page));
  });

  test('] is inert in YouTube mode and says why', async ({ page }) => {
    // docs/03 §2: "the key is a no-op and the collapse control is not rendered;
    // a 3 s hint chip explains why".
    await playing(page, 0, 5);
    await page.keyboard.press(']');

    await expect(page.getByTestId('tt-yt-rail')).toBeVisible();
    await expect(page.getByTestId('tt-hint')).toBeVisible();
    expectPlayerCompliant(await playerGeometry(page));
  });

  test('the rail renders no collapse control at all', async ({ page }) => {
    // Enforced in markup rather than by remembering (docs/03 §2), so a future
    // `]` implementation cannot reach it even by mistake.
    await playing(page, 0, 5);
    await expect(page.getByTestId('tt-yt-rail').getByTestId('tt-rail-collapse')).toHaveCount(0);
  });
});

test.describe('overlays stop at the rail — docs/03 §2', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test('the settings sheet does not reach the player', async ({ page }) => {
    await playing(page, 0, 5);
    await page.keyboard.press('s');
    await expect(page.getByTestId('tt-settings')).toBeVisible();
    expectPlayerCompliant(await playerGeometry(page));
  });

  test('the track-info modal does not reach the player', async ({ page }) => {
    /*
     * This one was a LIVE violation in v0.5.2, and the modal box was never the
     * problem: `.tt-backdrop` was `inset: 0` at 75% opaque void, so
     * right-clicking a queue row during playback laid a scrim over a playing
     * player. The kind of thing a markup review does not catch, because the
     * markup that covers the player is the part with no content in it.
     */
    await playing(page, 0, 5);
    // Right-click opens the context menu (docs/02 §8); the modal is one item in.
    await page.getByTestId('tt-queue-row').first().click({ button: 'right' });
    await page.getByTestId('tt-menu-info').click();
    await expect(page.getByTestId('tt-trackinfo')).toBeVisible();
    expectPlayerCompliant(await playerGeometry(page));
  });
});
