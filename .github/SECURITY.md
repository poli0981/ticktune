# Security Policy

## Supported versions

Only the latest deployed release is supported. TickTune is a static client-side
app with no server-side state, so "patched" means "redeployed" — hard-reload
(`Ctrl+F5`) to pick up a fix.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's [Private Vulnerability Reporting](https://github.com/poli0981/ticktune/security/advisories/new)
— the Security tab of this repository. No email address is published anywhere on
the site by design (`docs/10 §4` keeps email obfuscation off precisely because
there are no addresses to protect), so this is the only private channel.

Expect an acknowledgement within a week. This is a solo, unpaid project: there is
no bounty and no formal SLA, but genuine reports are taken seriously and credited
unless you prefer otherwise.

## What is in scope

The deployed site and this repository's code — in particular:

- Anything that causes user-supplied audio, images or playlist data to leave the
  browser. That is hard invariant 1 (`CLAUDE.md`) and the central promise of
  `legal/PRIVACY-POLICY.md`; a break here is the most serious class of bug the
  project can have.
- XSS, including via crafted ID3/Vorbis tags or YouTube titles. All such strings
  are untrusted input; `{@html}` is banned repo-wide (`docs/09 §5`, lint-enforced).
- CSP bypasses, or a build that ships a stale/incorrect `script-src` hash
  (`docs/09 §4`, `docs/10 §7`).
- Abuse of the single edge endpoint `GET /api/yt/oembed` — it validates an
  11-character video id and is deliberately not a general URL proxy
  (`docs/09 §1`).
- Supply-chain issues in shipped dependencies (`docs/11 §5`).

## What is out of scope

- Missing headers or behaviour on Cloudflare-generated edge error pages: the zone
  is on the Free plan and those are Cloudflare-branded by decision (`docs/10 §8`).
- Rate limiting being reachable — 429 on `/api/*` is intended (`docs/10 §6`).
- The mobile gate being bypassable by spoofing a viewport. It is a product
  decision, not a security control (`docs/07`).
- Anything requiring the user's own device or browser to already be compromised.
- Reports that a user can load copyrighted audio into their own browser. That is
  the user's responsibility under `legal/EULA.md §3`; the app never transmits it.
