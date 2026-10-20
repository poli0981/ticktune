# TickTune — Privacy Policy

Version 2.0 · 2026-10-21 · English canonical; Vietnamese at `/legal/privacy/`.

TickTune is built to know as little about you as possible. **Your files, your
playlist and your settings never leave your browser.**

## 1. Who runs TickTune

An independent, non-commercial open-source project run by one developer,
**poli0981** — no company, no staff. Privacy questions: **privacy@poli0981.dev**
(mail to it is delivered by Google Workspace), or a public
[GitHub issue](https://github.com/poli0981/ticktune/issues). We hold nothing that
identifies you, so there is no personal data to export, correct or delete on
request.

## 2. On your device

- **Settings** and your Legal Gate acceptance live in your browser's IndexedDB —
  one database, `ticktune`, holding one row. "Reset app" in Settings deletes it.
- **Your files and playlist** stay in memory for the session and are gone when
  you close or reload the tab. They are never uploaded.
- **The app's own files** — its scripts, styles, fonts and icons — are kept in
  your browser's Cache Storage so that `/app/` can start without a network.
  Nothing you choose or make is ever put there.
- **Finish notifications** (off unless you turn them on): your browser remembers
  that you allowed them for this site. A notification is created on your device,
  says only that time is up, and is not sent through any push service.
- **A settings file** you export is a download you keep; importing one reads a
  file you pick, on your device. Neither is uploaded.
- TickTune sets **no cookies** and uses no `localStorage` or `sessionStorage`.

## 3. What reaches the network

| When | Request | What it carries |
|------|---------|-----------------|
| Every page | The site itself, served by Cloudflare | Ordinary request data, such as your IP address and browser |
| Every page | The **Cloudflare Web Analytics** beacon (`static.cloudflareinsights.com`, reporting to `cloudflareinsights.com`) | The page address, the referring page, your browser and operating system, and page-load timings |
| You add YouTube links | `/api/yt/oembed` on our own domain | The 11-character video ID only |
| You add YouTube links | `/api/yt/durations` on our own domain, which asks the **YouTube Data API** for the videos' lengths | The video IDs only. The request to Google comes from our server with our own key — never from your browser — and carries nothing about you |
| YouTube mode | The YouTube IFrame API (`www.youtube.com`), the player (`youtube-nocookie.com`) and thumbnails (`i.ytimg.com`) | Whatever YouTube's player requests |

Local modes make no request to Google at all.

## 4. Cloudflare Web Analytics

We count visits with Cloudflare Web Analytics. According to Cloudflare it sets
no cookies or local storage, does not fingerprint visitors and does not follow
anyone across websites; Cloudflare derives an approximate country from the
request. We see aggregates only — page views, visits, countries, referring
sites, browsers and loading performance — never one person's history.
Cloudflare processes this data under its own privacy policy.

## 5. YouTube and Google

YouTube mode uses YouTube API Services: the embedded player, and the YouTube
Data API, which our server asks for the length of each video you add — by video
ID, with no information about you. Lengths are kept for up to 24 hours per video
so the same video is not looked up again. Once you interact with the player,
Google may set cookies and process data as described in the
[Google Privacy Policy](https://policies.google.com/privacy). The player is
created on the privacy-enhanced `youtube-nocookie.com` host.

## 6. What the operator can see

- **Cloudflare dashboard — aggregates only:** requests, bandwidth, approximate
  unique visitors, countries, status codes, cache use, blocked threats, and the
  Web Analytics figures in `§4`. No individual IP addresses or browser strings.
- **Worker logs — YouTube lookups only:** each `/api/yt/oembed` and
  `/api/yt/durations` call is logged (the request, the response and the country
  Cloudflare attaches) and deleted by Cloudflare after **7 days**. Loading a page
  never creates one.
- **Rate limiting:** to protect a shared quota, `/api/yt/durations` counts calls
  per IP address for one minute, in the memory of Cloudflare's servers. That
  count is never logged or stored.

This is used to keep the site working, notice abuse, and learn why a YouTube link
would not resolve — never to identify you, build a profile, advertise, or share
with anyone, and it is never joined to anything you do inside the app.

## 7. Diagnostics you choose to share

**Copy diagnostics** builds a JSON snapshot on your device — app version,
browser, settings and the recent coded log, no file names — for you to paste
into a GitHub issue. Nothing is sent unless you paste it yourself.

## 8. Children

TickTune does not collect personal data from anyone, including children.

## 9. Retention and changes

Device data stays until you clear it; Worker logs are deleted after 7 days;
analytics aggregates are kept by Cloudflare under its own retention. Material
changes bring the Legal Gate back; every revision is in the Git repository.

| Version | Date | Change |
|---------|------|--------|
| 2.0 | 2026-10-21 | YouTube lengths via the YouTube Data API; offline cache of the app's own files; optional finish notifications; settings file export/import; per-IP rate limit on lengths |
| 1.1 | 2026-10-20 | Cloudflare Web Analytics; Worker logs kept 7 days (Workers Paid); privacy contact; YouTube and Google links; shortened |
| 1.0 | 2026-07-24 | First non-draft version |
