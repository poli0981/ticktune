# DSEG14 Classic — vendored font

The fourteen-segment face offered as the second clock face (`clockFace:
'dseg14'`, `docs/03 §1`, v2.0). Same family, release and licence as
`../dseg7/`, and self-hosted for the same reason: no third-party font request
may leave the user's browser (`legal/PRIVACY-POLICY.md §1`, `docs/09 §1`).

| | |
|---|---|
| Upstream | https://github.com/keshikan/DSEG |
| Release | **v0.46** — the latest *stable* release (2020-03-15), the one `../dseg7/` is vendored from |
| Asset | `fonts-DSEG_v046.zip` (1 095 157 bytes) |
| Asset SHA-256 | `a6c2f43520971ca8067262e78d49025e605f749bf716ec5394bad9a0ee1c238c` — identical to the asset `../dseg7/` records |
| File SHA-256 | `DSEG14Classic-Regular.woff2` → `327c24d55049422f513d59fddc3919bba72186ea6b42ea8e214be06e0faa0530` |
| Retrieved | 2026-10-21 |
| Licence | SIL Open Font License 1.1 — full text in `OFL.txt` (byte-identical to `../dseg7/OFL.txt`) |
| Copyright | © 2017 keshikan (http://www.keshikan.net) |

## Measured before it was offered

The countdown's `22.2cqw` cap is a YouTube ToS floor (`docs/03 §4`) computed
from DSEG7's advance widths. DSEG14 Classic renders `8:88:88` at **4.48 ×
font-size** and `88.888` at **4.08 ×**, exactly as DSEG7 does (headless
Chromium, 2026-10-21), so the same cap holds for both faces — no second cap.

Its all-segments glyph is `~` (U+007E), not `8`: the ghost layer maps `8 → ~`
for this face, and `~` is in the `@font-face` unicode-range for that reason.

## Reserved Font Name — "DSEG"

The same rules as `../dseg7/PROVENANCE.md`: vendored byte-for-byte as released;
a subset or re-encoded build may not keep the name. Only **Regular** is vendored.
