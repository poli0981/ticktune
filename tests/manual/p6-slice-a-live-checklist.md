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

- [x] `ticktune.net/` and `ticktune.net/en/` both serve, with the right language.
- [x] `ticktune.net/sitemap-index.xml` and `/robots.txt` resolve.
- [x] Headers still live (`10 §11`): HSTS present, CSP unchanged.
