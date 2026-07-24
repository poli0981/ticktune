# TickTune — Privacy Policy (Draft)

Version 1.1-draft · 2026-07-24 · English canonical; Vietnamese at `/legal/privacy`.

TickTune is built to know as little about you as possible.

## 1. What we do NOT do

- No accounts, no sign-in.
- No analytics scripts, tracking pixels, fingerprinting, or advertising. (Traffic
  statistics do exist at the network level, and §4.1 sets out exactly what they
  are and what we can see.)
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
  request data (such as IP addresses) at the network level to serve and protect
  the site, per Cloudflare's privacy documentation. Basic abuse protections such
  as rate limiting run at this layer. Cloudflare stores and processes that data
  under **its own policies and retention**, which are not ours to set. What
  reaches *us* is described next.

### 4.1 What the site operator can see

Running a site produces operational data, and you should know how much of it
reaches the people who run this one. Two separate things do.

**Cloudflare's dashboard analytics — aggregates only.** As the domain owner we
can see totals: how many requests and how much bandwidth the site served, an
approximate unique-visitor count, which **countries** requests came from, HTTP
status codes, how much was answered from cache, and how many requests a security
rule blocked. On our plan these are aggregates delayed by 24 hours. The dashboard
does **not** show individual IP addresses or User-Agent strings — per-request raw
logs are an enterprise feature we do not have — and Cloudflare's analytics do not
follow an individual across visits by IP, User-Agent or any fingerprint.

**Our own Worker logs — API calls only, three days.** The `/api/yt/oembed`
endpoint runs a Cloudflare Worker with observability enabled, which records one
entry per call: the request, the response, and the country Cloudflare attaches to
it. **Loading a page does not create one** — the pages are static files served
without invoking the Worker — so an entry exists only because you added a YouTube
link. Cloudflare deletes these after **3 days**, and we cannot extend that.

**What all of it is for.** Knowing the site is up and what is failing; seeing how
much traffic and bandwidth it uses and whether caching is working; noticing abuse
or a traffic spike; and — the reason the Worker logs exist at all — being able to
tell *why* a YouTube link would not resolve, since that endpoint's whole job is
to distinguish a video that is private, age-restricted, region-blocked or deleted
from our own service having failed.

**What none of it is for.** Identifying you, building a profile, following you
between visits, advertising, or sharing with anyone. None of it is joined to
anything you do inside the app: your files, your queue and your settings never
leave your browser (`§1`, `§2`), so nothing above can be connected to what you
actually played.

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

**1.1-draft — 2026-07-24.** Added `§4.1`. The previous version stated that
TickTune "stores no server-side logs of its own about you", and **that was not
correct**: the `/api/yt/oembed` Worker has had observability enabled since it was
built, which retains one entry per call for three days. Nothing about how the app
behaves has changed — the policy now describes what was already happening. The
Legal Gate is being shown again because the wording you previously accepted was
inaccurate, and consent given to an inaccurate description is not consent.
