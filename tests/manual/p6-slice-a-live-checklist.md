# P6 slice A live checklist — the landing pages

Filtered to what slice A ships: the bilingual landing (`/` and `/en/`), the FAQ,
the 404 mirror, the SEO plumbing (hreflang, sitemap, robots, favicon, Open
Graph), and the self-hosted UI fonts. The **legal pages are slice B** and are
listed under "Known-absent".

Run on a **desktop** browser against the **PR preview, before the merge** — the
ritual v0.6.0 corrected and every slice since has used.

⚠️ **This is the first release where the public landing page is real.** Until now
`/` was a P1 stub. Read it as a stranger would: if a sentence is confusing or a
claim sounds wrong, say so — the copy is as much the deliverable as the code.

## Blocking — a failure here means don't merge

### Both languages render

- [x] **`/` is Vietnamese**, and reads properly — headline, three feature cards,
      three modes, the limits table, the FAQ, the legal links, the footer.
- [x] **`/en/` is English**, same structure, nothing left in Vietnamese.
- [x] **The language link works both ways** — top right, `English` on `/` and
      `Tiếng Việt` on `/en/`.
- [x] **Nothing reads like a key or a placeholder.** No `landing.heroHeadline`,
      no `undefined`, no empty box.
- [x] **Vietnamese diacritics look right** — `Đồng hồ của bạn`, `Nhạc`, `phía`.
      This is the release that self-hosts the UI font; if the text looks like
      the plain system font, or the marks sit wrong, say so.

### The two things the copy must contain

- [x] **The FAQ's first answer explains the background-tab behaviour.** It must
      say the countdown is accurate while the tab is visible and best-effort
      while it is in the background. This is a promise we re-scoped after
      measuring a hidden tab finish nearly three minutes late — it has to be
      stated here, not buried in the terms.
- [x] **The footer carries `Mã nguồn — GPL-3.0` linking to GitHub.** This is a
      licence obligation for the hosted build, not decoration.

### The limits table matches the app

Open `/app/` in another tab and confirm the published numbers are the ones the
app actually enforces:

- [x] Single: one file, 10:02 · Playlist: 95 files, 10:02 each, 91:00 total ·
      YouTube: 50 links · Countdown: 1 second – 24 hours.

### CTA and 404

- [x] **`Mở TickTune →` opens `/app/`** and the app still works normally.
- [x] **A made-up URL** (e.g. `/nope`) shows the styled Vietnamese 404.
- [x] **`/en/404` renders in English.** ⚠️ Note: a made-up URL *under* `/en/`
      still shows the **Vietnamese** 404. That is expected — Cloudflare serves
      one 404 file for the whole site. Do not report it.

### SEO plumbing

- [x] **`/sitemap-index.xml` loads** and leads to a list containing exactly `/`
      and `/en/` — **not** `/app`, not the spikes, not the 404s.
- [x] **`/robots.txt` loads** and points at the sitemap.
- [x] **The favicon shows** in the browser tab (a red dot on dark).
- [x] **Paste the preview URL into a link-preview tool** (or a Discord/Slack
      message you then delete). A card with the countdown image should appear.

### Nothing regressed

- [x] **The app still works end to end** — gate, a local file, a countdown, the
      settings panel. Slice A touched the shared layout and the global stylesheet,
      so this is the regression surface.
- [x] **On a phone** (or a narrow window, then reload): the mobile block screen
      still appears on `/` and `/en/`.

## Non-blocking

- [x] **Lighthouse ≥ 95** on `/` and `/en/` — desktop, all four categories
      (Performance, Accessibility, Best Practices, SEO). This is the P6 exit
      criterion; report any category that falls short and its top finding.

      ⚠️ **It took three runs, and the first two failed on the same number for
      two different reasons.** Kept here in full because the shortfall was
      three points both times — exactly the size of gap that gets rounded up to
      "all green", and both times it was a real live defect.

      | Run | P / A / **BP** / SEO | Cause of the BP shortfall |
      |---|---|---|
      | 1 | 99 / 100 / **92** / 100 | Four console errors. **Three** were fontsource subsets Vite inlined as `url(data:font;base64,…)` under its ~4 KB default, refused by `font-src 'self'`. Fixed in `eb45be8` by refusing to inline fonts — **not** by adding `data:` to the policy |
      | 2 | 100 / 100 / **92** / 100 | The **fourth** error, which run 1 had wrongly folded in with the fonts. An inline script at `(index):19` — **not ours**. Cloudflare **JavaScript Detections** injecting its `/cdn-cgi/challenge-platform` loader into our HTML, on `/`, `/en/` *and* `/app/` |
      | 3 | **100 / 100 / 100 / 100** | ✅ Pass |

      **The score not moving between runs 1 and 2 was the tell** that the
      symptom had two causes. Confirmation that #2 was Cloudflare's and not
      ours: the injected script embeds a per-request token
      (`__CF$cv$params = {r:…, t:…}`), so three measurements demanded three
      different hashes (`82UoSh…`, `XsgfYB…`, `qED2jw…`). **A script that
      varies per request is unhashable by construction** — no CSP hash could
      ever have allowed it, and `unsafe-inline` would have gutted the policy
      for a script we do not want.

      Fixed at the **zone**, not in the CSP: `enable_js: false`,
      `fight_mode: false`. That also restores two promises the CSP was the only
      thing holding up — `legal/PRIVACY-POLICY.md §1`'s "no … fingerprinting"
      and §4's "transiently **at the network level**" — so no legal text needed
      changing and the gate does not re-prompt anyone.

      Verified after the toggle by **hashing the served bytes**, which is the
      method that works: `/`, `/en/` and `/app/` contain exactly **one** inline
      script, its `sha256-cuTkHuZ…` equals the `script-src` hash, and the CSP
      header is byte-identical. ⚠️ A browser console reporting no errors is
      **not** evidence of a clean CSP — it was silent on this violation.
- [x] Real Firefox: one pass of `/` and `/en/`.
- [x] The hero illustration looks intentional rather than broken.

## Known-absent — do not report

| Missing | Why |
|---------|-----|
| The legal pages (`/legal/*`) | **P6 slice B.** The footer links still point at the GitHub markdown until then |
| A real demo video in the hero | **P7.** The illustration is a deliberate placeholder and says so under it |
| A language-correct 404 under `/en/*` | Cloudflare serves one 404 file site-wide; a per-language fallback would need a Worker route, and the Worker exists only for `/api` |
| An axe accessibility scan | **P7** (`13 §6`) |
| A bundle-size number | **P7** (`13 §5`). Lighthouse above is the P6 gate |

## Production re-check — after the tag deploys to `ticktune.net`

⚠️ **These were once ticked before the tag existed, and were reset.** Everything
above genuinely ran against `ticktune.net` — but that was the *branch*, because
Cloudflare's own Workers Build deploys every pushed branch straight to
production. A block that exists to verify the tag's deploy cannot be answered by
a different one.

✅ **Re-run 2026-07-24 after `v0.9.0` deployed, and every line passed.** All six
were measured from the shell rather than by eye, so they are reproducible:

- [x] `ticktune.net/app/` → ⚙ → Giới thiệu reads **0.9.0**. This is the line
      that actually proves the *tag* deployed rather than some other push —
      given two deploy paths race on a tag, it is the only one that can tell
      them apart. Measured in the deployed island bundle, where
      `Qi.textContent = "0.9.0"` **is** the About panel's `tt-set-version` node:
      one occurrence of `0.9.0`, zero of `0.8.0`.
- [x] `ticktune.net/` and `ticktune.net/en/` both serve, with the right language
      (`<html lang="vi">` and `<html lang="en">`).
- [x] `ticktune.net/sitemap-index.xml` and `/robots.txt` resolve (200, 200), and
      `robots.txt` is byte-identical to the repo's — worth checking because a
      Cloudflare-managed `robots.txt` would silently replace it
      (`is_robots_txt_managed: false`).
- [x] Headers still live (`10 §11`): CSP, HSTS, Permissions-Policy,
      Referrer-Policy, X-Content-Type-Options all present.
- [x] `/api/yt/oembed` answers on the custom domain — 200,
      `application/json; charset=utf-8`. The one thing no preview can speak for,
      since it is the Worker route rather than an asset.
- [x] Exactly **one** inline script site-wide, and its hash equals the
      `script-src` hash. Added after run 2 above: this is the check that would
      have caught the Cloudflare injection on day one, and it is three lines of
      shell rather than a Lighthouse run.

```bash
curl -s https://ticktune.net/ -o /tmp/p.html && node -e "const f=require('fs'),c=require('crypto');const h=f.readFileSync('/tmp/p.html','utf8');const r=/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;let m;while((m=r.exec(h)))console.log('sha256-'+c.createHash('sha256').update(m[1]).digest('base64'))"
```
