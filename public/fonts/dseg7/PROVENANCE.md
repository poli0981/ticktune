# DSEG7 Classic — vendored font

The seven-segment face used for the countdown digits (`--font-digit`,
`docs/03 §1`). Self-hosted rather than loaded from a CDN, because no
third-party font request may leave the user's browser
(`legal/PRIVACY-POLICY.md §1`, `docs/09 §1`).

| | |
|---|---|
| Upstream | https://github.com/keshikan/DSEG |
| Release | **v0.46** — the latest *stable* release (2020-03-15). A `v0.50beta1` tag exists; a beta is not vendored into a distributed artifact. |
| Asset | `fonts-DSEG_v046.zip` (1 095 157 bytes) |
| Asset SHA-256 | `a6c2f43520971ca8067262e78d49025e605f749bf716ec5394bad9a0ee1c238c` |
| File SHA-256 | `DSEG7Classic-Regular.woff2` → `8a61b7dbc89367dbc0face2541ed69a2bf0cc05b23d1064f670284ab61044481` |
| Retrieved | 2026-07-21 |
| Licence | SIL Open Font License 1.1 — full text in `OFL.txt` |
| Copyright | © 2017 keshikan (http://www.keshikan.net) |

## Reserved Font Name — "DSEG"

OFL §3 reserves the name. Practical consequences for this repo:

- The file is vendored **byte-for-byte as released**. Do not subset, re-hint,
  re-compress or otherwise regenerate it while keeping the name — a modified
  build may not be distributed as "DSEG".
- If subsetting ever becomes worth the ~5 KB, the derivative must be renamed
  (e.g. `TtSeg`) and `legal/THIRD-PARTY-NOTICES.md` updated to say so.

`OFL.txt` is the upstream `DSEG-LICENSE.txt`, unmodified, renamed only to match
the filename in the `docs/01 §4` directory tree. OFL §2 requires it to travel
with the font, which is why it lives here in `public/` and ships with the build
rather than sitting only in the repo.

Only **Regular** is vendored. The release also contains Bold, plus DSEG14 and
the Modern/Italic families; none are used, and unused bytes in `public/` are
shipped to every visitor.
