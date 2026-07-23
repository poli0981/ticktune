import { test, expect } from '@playwright/test';
import { dismissUnloadDialogs, setDuration } from './_helpers';
import {
  fireYt,
  fireYtError,
  flashSeen,
  gotoYouTubeApp,
  gotoYouTubeAppReturning,
  mockOembed,
  stageLinks,
  watchForFlash,
  ytCalls,
  ytProbe,
} from './_helpers-yt';

/**
 * docs/13 §3 — YouTube mode, P4.
 *
 * **This tier did not exist.** P4 shipped two slices to `main` with 451 unit,
 * component and worker tests and not one end-to-end assertion about YouTube, and
 * `docs/13 §1` excludes `*-driver.ts` from the coverage gate on the stated
 * grounds that "they are covered where they actually run: Playwright (§3)" — a
 * promise that was unkept for both YouTube drivers. Everything the store, the
 * driver and the rail do together was unobserved, and that is exactly where the
 * four defects fixed alongside this file were living.
 *
 * Firefox is NOT skipped here. The audio is inside a cross-origin iframe, so no
 * `AudioContext` is involved and the CI runner's missing audio device (docs/13
 * §3) is irrelevant — skipping would state a reason that is not true and would
 * make the matrix look thinner than it is.
 *
 * ⚠️ There is deliberately no Focus-mode spec. `TtApp` passes
 * `focusMode={false}` as a literal — Focus and the `]` collapse arrive in P5
 * (`docs/13 §2`) — so the `03 §2` carve-out branch cannot execute in production
 * yet and a spec for it would assert a prop nobody can set. The geometry
 * assertions below are the part that IS measurable today; the Focus half is a
 * P5 exit item.
 */

const ONE = 'jNQXAC9IVRw';
const TWO = '9bZkp7q19f0';

test.describe('youtube mode', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop projects only');

  test.describe('the player actually starts', () => {
    test('the first Start cues and plays the first video', async ({ page }) => {
      // The regression this file exists for. `onStart` is synchronous but the
      // rail mounts a microtask later, so `yt.load()` used to run against a null
      // player: no iframe, and `iframe_api` never even requested.
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page);
      await stageLinks(page, [ONE, TWO]);
      await setDuration(page, 0, 1, 0);
      await page.getByRole('button', { name: 'Bắt đầu' }).click();

      await expect(page.getByTestId('tt-yt-frame')).toBeVisible();
      await expect
        .poll(() => ytCalls(page))
        .toEqual(expect.arrayContaining([`loadVideoById:${ONE}`, 'playVideo']));
    });

    test('requests the IFrame API exactly once, from youtube.com', async ({ page }) => {
      const requested: string[] = [];
      page.on('request', (r) => {
        if (r.url().includes('iframe_api')) requested.push(r.url());
      });

      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page);
      await stageLinks(page, [ONE]);
      await setDuration(page, 0, 1, 0);
      await page.getByRole('button', { name: 'Bắt đầu' }).click();
      await expect(page.getByTestId('tt-yt-frame')).toBeVisible();

      expect(requested).toEqual(['https://www.youtube.com/iframe_api']);
    });

    test('Stop then Start builds a NEW player rather than a black box', async ({ page }) => {
      // Leaving `playing` destroys the rail and the iframe with it. The player
      // used to survive bound to the detached node, and the second run showed an
      // empty 384×216 slot for its whole duration.
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page);
      await stageLinks(page, [ONE]);
      await setDuration(page, 0, 1, 0);

      await page.getByRole('button', { name: 'Bắt đầu' }).click();
      await expect(page.getByTestId('tt-yt-frame')).toBeVisible();
      expect((await ytProbe(page)).built).toBe(1);

      await page.getByTestId('tt-stop').click();
      await expect(page.getByTestId('tt-yt-rail')).toHaveCount(0);

      await page.getByRole('button', { name: 'Bắt đầu' }).click();
      await expect(page.getByTestId('tt-yt-frame')).toBeVisible();
      await expect.poll(async () => (await ytProbe(page)).built).toBe(2);
    });
  });

  test.describe('the ToS carve-out — docs/06 §1.2, invariant 2', () => {
    test.beforeEach(async ({ page }) => {
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page);
      await stageLinks(page, [ONE]);
      await setDuration(page, 0, 1, 0);
      await page.getByRole('button', { name: 'Bắt đầu' }).click();
      await expect(page.getByTestId('tt-yt-frame')).toBeVisible();
    });

    test('constructs the player on youtube-nocookie.com', async ({ page }) => {
      const { opts } = await ytProbe(page);
      // `host` defaults to www.youtube.com, which sets cookies, and the shipped
      // CSP still permits that origin in frame-src — so omitting it would break
      // the invariant with nothing to catch it.
      expect(opts.host).toBe('https://www.youtube-nocookie.com');
    });

    test('creates no frame on the cookie-setting origin', async ({ page }) => {
      const origins = page.frames().map((f) => f.url());
      expect(origins.some((u) => u.startsWith('https://www.youtube.com'))).toBe(false);
    });

    test('renders the player at or above the 200×200 floor', async ({ page }) => {
      const box = await page.getByTestId('tt-yt-frame').boundingBox();
      expect(box).not.toBeNull();
      // The floor is SQUARE. Deriving the height bound from 16:9 would pass at
      // 200×113, which is the violation the assertion exists to prevent.
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(200);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(200);
    });

    test('leaves the player fully opaque, itself and every ancestor', async ({ page }) => {
      // ⚠️ NOT `checkVisibility({ checkOpacity: true })`. Spike S1 measured it
      // returning TRUE at opacity 0.06 with the video still playing — it only
      // catches exactly 0, so it cannot be the guard here.
      const opacities = await page.getByTestId('tt-yt-frame').evaluate((el) => {
        const out: number[] = [];
        for (let n: Element | null = el; n; n = n.parentElement) {
          out.push(Number(getComputedStyle(n).opacity));
        }
        return out;
      });
      expect(Math.min(...opacities)).toBe(1);
    });

    test('is the topmost element at its own centre — nothing overlaps it', async ({ page }) => {
      const box = await page.getByTestId('tt-yt-frame').boundingBox();
      const hit = await page.evaluate(
        (p) => document.elementFromPoint(p.x, p.y)?.getAttribute('data-testid') ?? null,
        { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 },
      );
      expect(hit).toBe('tt-yt-frame');
    });

    test('offers no collapse control anywhere in the rail', async ({ page }) => {
      // S1 measured a collapsed rail leaving the player 0×0 under display:none
      // with audio still running. The control not existing is stronger than
      // disabling it.
      const labels = await page.getByTestId('tt-yt-rail').locator('button').allTextContents();
      expect(labels.some((l) => /thu gọn|collapse|\]/i.test(l))).toBe(false);
    });
  });

  test.describe('the edge names the cause — docs/06 §3, spike S1', () => {
    test('keeps a 401 out of the queue and says embedding is off', async ({ page }) => {
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page, { [TWO]: { status: 401, body: { error: 'embed_off' } } });
      await stageLinks(page, [ONE, TWO], 1);
      await expect(page.getByTestId('tt-toast')).toContainText('TT-YT-101');
    });

    test('keeps a 404 out of the queue and says the video is gone', async ({ page }) => {
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page, { [TWO]: { status: 404, body: { error: 'not_found' } } });
      await stageLinks(page, [ONE, TWO], 1);
      await expect(page.getByTestId('tt-toast')).toContainText('TT-YT-100');
    });

    test('KEEPS a 502 as pending — the edge failed, not the video', async ({ page }) => {
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page, {
        [TWO]: { status: 502, body: { error: 'upstream_unreachable' } },
      });
      // Two rows: the transient one survives. docs/02 §1 — pending counts
      // toward Start, because blocking on a flaky metadata lookup would be wrong.
      await stageLinks(page, [ONE, TWO], 2);
      await expect(page.getByTestId('tt-toast')).toContainText('TT-YT-001');
    });

    test('a non-JSON 404 is transient, not the owner being blamed', async ({ page }) => {
      // The regression found by USING the app: under `astro preview` the Worker
      // does not run, so this route really does hit the static 404 page. A 404
      // maps to not_found, so three known-good videos were once all reported as
      // deleted. Only a body our own endpoint produced earns a status the right
      // to be read as a cause.
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page, { [TWO]: { status: 404, html: true } });
      await stageLinks(page, [ONE, TWO], 2);
      await expect(page.getByTestId('tt-toast')).toContainText('TT-YT-001');
      await expect(page.getByTestId('tt-toast')).not.toContainText('TT-YT-100');
    });
  });

  test.describe('playback and the typed overlay — docs/06 §4', () => {
    test.beforeEach(async ({ page }) => {
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page);
      await stageLinks(page, [ONE, TWO]);
      await setDuration(page, 0, 2, 0);
      await page.getByRole('button', { name: 'Bắt đầu' }).click();
      await expect(page.getByTestId('tt-yt-frame')).toBeVisible();
    });

    test('advances the queue when the player reports ENDED', async ({ page }) => {
      // docs/06 §2: onStateChange: ENDED is YouTube's equivalent of the media
      // element's `ended`, and it is the only advance signal in this mode.
      await expect(page.getByTestId('tt-queue-row').first()).toHaveClass(/tt-current/);
      await fireYt(page, 'ended');
      await expect(page.getByTestId('tt-queue-row').nth(1)).toHaveClass(/tt-current/);
      await expect.poll(() => ytCalls(page)).toContain(`loadVideoById:${TWO}`);
    });

    test('shows the typed card inside the player area, naming both causes', async ({ page }) => {
      await fireYtError(page, 150);
      const overlay = page.getByTestId('tt-yt-overlay');
      await expect(overlay).toBeVisible();
      await expect(overlay).toHaveAttribute('data-tt-key', 'yt.err.blocked');
      // S1: age-restricted and region-blocked are identical from the outside, so
      // naming one would be a guess stated as a fact.
      await expect(overlay).toContainText('tuổi');
      await expect(overlay).toContainText('khu vực');
      await expect(overlay).toContainText('TT-YT-150');
    });

    test('Bỏ qua ngay advances without waiting out the card', async ({ page }) => {
      await fireYtError(page, 150);
      await page.getByTestId('tt-yt-skip').click();
      await expect(page.getByTestId('tt-yt-overlay')).toHaveCount(0);
      await expect(page.getByTestId('tt-queue-row').nth(1)).toHaveClass(/tt-current/);
    });

    test('⏭ past the last track pauses the VIDEO, not the audio graph', async ({ page }) => {
      // `onNext` used to call `playback.stop()` with no mode branch, so the
      // video played on past a queue that had already reported itself exhausted.
      await page.getByTestId('tt-repeat').click();
      await page.getByTestId('tt-next').click();
      await page.getByTestId('tt-next').click();
      await expect(page.getByTestId('tt-playlist-ended')).toBeVisible();
      await expect.poll(() => ytCalls(page)).toContain('pauseVideo');
    });
  });

  test.describe('the overlay clears itself — OVERLAY_SKIP_MS', () => {
    test('the queue moves on 5 s later, with no click', async ({ page }) => {
      /*
       * Its own describe because `page.clock.install()` has to run BEFORE
       * navigation — it is installed as an init script, so timers scheduled by a
       * page that had already loaded stay on the real clock and `fastForward`
       * does nothing to them. Learned the hard way here; the working pattern is
       * `finished-late.spec.ts`.
       *
       * Worth the seam rather than a real 5 s sleep: the wait is the product
       * behaviour docs/06 §4 specifies ("the card is readable, then the queue
       * moves on by itself"), and a test that sleeps through it teaches the
       * suite that five seconds of wall clock is an acceptable price per
       * assertion.
       */
      dismissUnloadDialogs(page);
      await page.clock.install();
      await gotoYouTubeApp(page);
      await stageLinks(page, [ONE, TWO]);
      await setDuration(page, 0, 2, 0);
      await page.getByRole('button', { name: 'Bắt đầu' }).click();
      await expect(page.getByTestId('tt-yt-frame')).toBeVisible();

      await fireYtError(page, 150);
      await expect(page.getByTestId('tt-yt-overlay')).toBeVisible();

      // docs/06 §4 lists a countdown-to-skip among the card's five parts, and it
      // was the one nobody built: the card sat still and then vanished, which
      // reads as the app losing its place rather than announcing a decision.
      await expect(page.getByTestId('tt-yt-skip-in')).toContainText('5');
      await page.clock.fastForward(2_000);
      await expect(page.getByTestId('tt-yt-skip-in')).toContainText('3');

      await page.clock.fastForward(6_000);
      await expect(page.getByTestId('tt-yt-overlay')).toHaveCount(0);
      await expect(page.getByTestId('tt-queue-row').nth(1)).toHaveClass(/tt-current/);
    });
  });

  test.describe('the countdown ending', () => {
    test('pauses the video and fires the End Behavior for a RETURNING user', async ({ page }) => {
      /*
       * Two assertions in one run because they share the one condition that made
       * both fail: the audio driver is built lazily, and in YouTube mode nothing
       * built it. The legal gate is the only other unlock site and it does not
       * render on a second visit, so `runEndBehavior()` returned null and the
       * chime, the flash and `endAction` were all silently dead — while the
       * countdown still finished and the Finished screen still rendered.
       *
       * Every other spec in this suite starts with empty storage and therefore
       * always passes the gate, which is why this needs its own helper.
       */
      dismissUnloadDialogs(page);
      await watchForFlash(page);
      // endFlash is off by default, so the End Behavior would have nothing
      // VISIBLE to prove — and a spec that only asserted the Finished screen
      // would have passed against the bug, which rendered that screen perfectly.
      await gotoYouTubeAppReturning(page, {}, { endFlash: true });
      await stageLinks(page, [ONE]);
      await setDuration(page, 0, 0, 2);
      await page.getByRole('button', { name: 'Bắt đầu' }).click();
      await expect(page.getByTestId('tt-yt-frame')).toBeVisible();

      await expect(page.getByTestId('tt-finished')).toBeVisible({ timeout: 15_000 });
      // docs/06 §2: "pauseVideo() + UI dim (no audio-graph fade available)".
      await expect.poll(() => ytCalls(page)).toContain('pauseVideo');
      // …and "chime still plays locally". The chime itself is inaudible to
      // Playwright; the flash rides the same `runEndBehavior()` plan, so it is
      // the observable end of the same wire.
      await expect.poll(() => flashSeen(page)).toBe(true);
    });
  });

  test.describe('the backfill — docs/06 §2', () => {
    test('a pending track gets its title, channel and duration from the player', async ({
      page,
    }) => {
      /*
       * The gap this closes. A transient lookup leaves `title: ''` and
       * `artist: ''`, so the row renders `N/A N/A –` for a video that then plays
       * perfectly — and `durationMs` stayed null for EVERY YouTube track, so the
       * queue footer read `–` for the whole session.
       *
       * `getDuration()` and `getVideoData()` were specified from revision 1;
       * neither ran, because the session had no track writer at all.
       */
      dismissUnloadDialogs(page);
      // ONE fails transiently and is the row under test; TWO answers, which is
      // what keeps Start enabled — a batch where NOTHING reached the edge now
      // raises the offline banner and blocks Start (`06 §8`), so a queue built
      // entirely from failures could not be started at all.
      await gotoYouTubeApp(page, {
        [ONE]: { status: 502, body: { error: 'upstream_unreachable' } },
      });
      await stageLinks(page, [ONE, TWO], 2);
      await expect(page.getByTestId('tt-queue-row').first()).toContainText('N/A');
      await expect(page.getByTestId('tt-offline')).toHaveCount(0);

      await setDuration(page, 0, 1, 0);
      await page.getByRole('button', { name: 'Bắt đầu' }).click();
      await expect(page.getByTestId('tt-yt-frame')).toBeVisible();

      const row = page.getByTestId('tt-queue-row').first();
      await expect(row).toContainText('Từ trình phát');
      await expect(row).toContainText('Kênh trình phát');
      await expect(row).toContainText('3:32');
      await expect(row).not.toContainText('N/A');
      // The footer is the surface nobody would have thought to check, and it is
      // still honest here: track 2 has not played, so its duration is unknown
      // and a queue total would be a guess. `–` is the right answer until every
      // row is known (hard invariant 5) — before this release it was the answer
      // FOREVER, because nothing ever wrote a duration to a track at all.
      await expect(page.getByTestId('tt-queue-totals')).toContainText('–');
    });

    test('never overwrites what oEmbed already answered', async ({ page }) => {
      // oEmbed is the better source — the channel's own title, before the
      // player's normalisation. Blanks only is the whole rule.
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page);
      await stageLinks(page, [ONE]);
      await setDuration(page, 0, 1, 0);
      await page.getByRole('button', { name: 'Bắt đầu' }).click();
      await expect(page.getByTestId('tt-yt-frame')).toBeVisible();

      const row = page.getByTestId('tt-queue-row').first();
      await expect(row).toContainText(`Video ${ONE}`);
      await expect(row).not.toContainText('Từ trình phát');
      // …but the duration, which oEmbed does not carry, still lands.
      await expect(row).toContainText('3:32');
    });
  });

  test.describe('the re-check on Start — docs/02 §1, docs/06 §8', () => {
    test('a pending track that now resolves is named without ever being played', async ({
      page,
    }) => {
      /*
       * The toast says "sẽ thử lại khi bắt đầu". For a whole phase it was the
       * only thing in the app that retried anything.
       *
       * The pending track is the SECOND one, deliberately. The `06 §2` backfill
       * fills the PLAYING track from `getVideoData()` within a tick, so asserting
       * on row 1 would pass whether or not the re-check exists — measured here on
       * the first run of this spec, where the player won the race and the row read
       * "Từ trình phát". Row 2 is never cued, so the re-check is the only thing
       * that can name it.
       */
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page, {
        [TWO]: { status: 502, body: { error: 'upstream_unreachable' } },
      });
      await stageLinks(page, [ONE, TWO], 2);
      await expect(page.getByTestId('tt-queue-row').nth(1)).toContainText('N/A');

      // The edge recovers before Start — the ordinary case, since the failure
      // that made it pending was transient by definition.
      await mockOembed(page, {});
      await setDuration(page, 0, 1, 0);
      await page.getByRole('button', { name: 'Bắt đầu' }).click();

      const second = page.getByTestId('tt-queue-row').nth(1);
      await expect(second).toContainText(`Video ${TWO}`);
      await expect(second).not.toContainText('N/A');
    });

    test('a pending track the video itself has broken is struck through', async ({ page }) => {
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page, {
        [ONE]: { status: 200 },
        [TWO]: { status: 502, body: { error: 'upstream_unreachable' } },
      });
      await stageLinks(page, [ONE, TWO], 2);

      // …and on the retry the edge answers properly: the video is gone.
      await mockOembed(page, { [TWO]: { status: 404, body: { error: 'not_found' } } });
      await setDuration(page, 0, 1, 0);
      await page.getByRole('button', { name: 'Bắt đầu' }).click();

      const second = page.getByTestId('tt-queue-row').nth(1);
      await expect(second).toHaveClass(/tt-error/);
    });
  });

  test.describe('the mode boundary — docs/06 §5', () => {
    test('sources do not mix: the drop zone is not offered in YouTube mode', async ({ page }) => {
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page);
      // A queue is all-local or all-links, decided by the mode. The caps differ,
      // the 91:00 aggregate is meaningless against durations the player has not
      // backfilled, and playback would have to hand the cursor between a media
      // element and a cross-origin iframe while the ToS requires the player
      // visible throughout.
      await expect(page.getByTestId('tt-dropzone')).toHaveCount(0);
      await expect(page.getByTestId('tt-yt-input')).toBeVisible();
    });

    test('imposes no total-duration cap on a link queue', async ({ page }) => {
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page);
      await stageLinks(page, [ONE, TWO]);
      await expect(page.getByTestId('tt-queue-totals')).not.toContainText('91:00');
    });
  });

  test.describe('offline — docs/06 §8', () => {
    test('blocks Start and says why, rather than failing five seconds at a time', async ({
      page,
      context,
    }) => {
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page);
      await stageLinks(page, [ONE]);
      await setDuration(page, 0, 1, 0);

      await context.setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));

      await expect(page.getByTestId('tt-offline')).toBeVisible();
      // Not "allowed and then failing": every track would report onError 150
      // five seconds apart while the countdown ran, which is the worst version.
      await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled();
    });

    test('raises the banner from the IMPORT, while the hint still says connected', async ({
      page,
    }) => {
      /*
       * The live v0.5.0 finding, and the reason `06 §8` calls the import result
       * the authority. The user turned their network off, every link imported as
       * `N/A` — which only happens when the lookup fails — and no banner
       * appeared, because `navigator.onLine` stayed `true`. Chrome reports it
       * from whether an interface is up, not from whether anything is reachable.
       *
       * Note there is deliberately NO `setOffline` here and no synthetic event:
       * the hint is left saying "connected" for the whole test, exactly as it
       * did live. Only the failed requests can raise this banner.
       */
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page, {
        [ONE]: { status: 502, body: { error: 'upstream_unreachable' } },
        [TWO]: { status: 502, body: { error: 'upstream_unreachable' } },
      });
      expect(await page.evaluate(() => navigator.onLine)).toBe(true);
      await expect(page.getByTestId('tt-offline')).toHaveCount(0);

      await stageLinks(page, [ONE, TWO], 2);

      await expect(page.getByTestId('tt-offline')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled();
    });

    test('the banner offers a way out — it must not be able to trap Start', async ({ page }) => {
      /*
       * A deadlock I built, found by testing v0.5.1 on production rather than
       * by reading it: the banner blocks Start (§8), and `recheckPending` runs
       * just AFTER Start — so on a machine whose `navigator.onLine` never flips,
       * the evidence that would lift the banner could only be gathered by the
       * one action the banner forbids. Banner up, Start disabled, nothing able
       * to change either.
       *
       * §8 rejects a poll, so the user says when to try.
       */
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page, {
        [ONE]: { status: 502, body: { error: 'upstream_unreachable' } },
        [TWO]: { status: 502, body: { error: 'upstream_unreachable' } },
      });
      await stageLinks(page, [ONE, TWO], 2);
      await expect(page.getByTestId('tt-offline')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled();

      // The connection comes back, and nothing in the browser says so.
      await mockOembed(page, {});
      await page.getByTestId('tt-offline-retry').click();

      await expect(page.getByTestId('tt-offline')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeEnabled();
      // …and the tracks it re-checked are named, not left as N/A.
      await expect(page.getByTestId('tt-queue-row').first()).toContainText(`Video ${ONE}`);
    });

    test('a batch that never reached the network does not raise it', async ({ page }) => {
      // Malformed links are rejected by the regex before any fetch, so they are
      // evidence of nothing. Treating them as offline would put the banner up
      // on a perfectly good connection.
      dismissUnloadDialogs(page);
      await gotoYouTubeApp(page);
      await page.getByTestId('tt-yt-input').fill('not-a-link\nalso not one');
      await page.getByTestId('tt-yt-add').click();
      await expect(page.getByTestId('tt-toast')).toContainText('TT-YT-002');

      await expect(page.getByTestId('tt-offline')).toHaveCount(0);
    });
  });
});
