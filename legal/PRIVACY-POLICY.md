# TickTune — Privacy Policy (Draft)

Version 1.0-draft · 2026-07-21 · English canonical; VI translation in P6.

TickTune is built to know as little about you as possible.

## 1. What we do NOT do

- No accounts, no sign-in.
- No analytics, tracking pixels, fingerprinting, or advertising.
- No upload of your files: audio, images, and playlists are processed entirely
  in your browser and are **never transmitted** to our servers.
- No cookies set by TickTune itself.
- Fonts are self-hosted — no third-party font CDN requests.

## 2. Data stored on your device

Settings (language, appearance, playback preferences) and your Legal Gate
acceptance are stored locally via IndexedDB/localStorage on your device. Your
playlist and files exist only in memory for the current session and disappear on
reload. "Reset app" in Settings clears all locally stored data.

## 3. Network requests the app makes

- **Static assets** of the site itself, served via Cloudflare.
- **`/api/yt/oembed`** (only when you add YouTube links): the app sends the
  11-character video ID to our edge endpoint, which asks YouTube's public oEmbed
  service for the title/author/thumbnail. No other data is sent.
- **YouTube thumbnails** (`i.ytimg.com`) when YouTube links are in your queue.

## 4. Third parties

- **YouTube / Google.** Only if you use YouTube mode: the official embedded
  player (privacy-enhanced `youtube-nocookie.com` host) loads Google code and
  may set cookies and collect data as described in Google's Privacy Policy once
  you interact with the player. Local modes make no Google requests.
- **Cloudflare.** The site is delivered by Cloudflare, which processes technical
  request data (such as IP addresses) transiently at the network level to serve
  and protect the site, per Cloudflare's privacy documentation. TickTune does
  not use this data to identify you and stores no server-side logs of its own
  about you. Basic abuse protections (rate limiting, bot mitigation) run at
  this layer.

## 5. Diagnostics you choose to share

The **Copy Diagnostics** feature builds a JSON snapshot (app version, browser
user-agent, settings, recent internal log) locally, so *you* can paste it into a
GitHub issue. Nothing is sent anywhere unless you paste it yourself. Review it
before sharing.

## 6. Children

TickTune collects no personal data from anyone, including children, and has no
age-gated features.

## 7. Changes

Material changes re-trigger the Legal Gate. Document history is visible in the
Git repository: `https://github.com/poli0981/ticktune`.
