# Case Forge product previews

These four PNGs were captured from the actual local app with a temporary fictional case and deterministic test-provider responses. They contain no user case files. Desktop views are 1440×1000; responsive phone crops are 390×780.

- `desktop-overview.png` / `phone-overview.png`: case overview after saving fictional source-backed findings.
- `desktop-review.png` / `phone-review.png`: a separate fictional document's review screen, before approval.

The webpage supplies the device frames in HTML/CSS. A phone frame illustrates the responsive layout; it is not a claim of a released native iPhone app. The local model shown in the review screenshot is a test fixture, not an advertised model or a live AI connection.

To refresh, use a separate temporary case with synthetic text and the app's import, analyse and approve workflow. Never capture the user's active case for public marketing assets.

The website serves lossless WebP copies of these PNGs (about 61% smaller in total). Keep the PNGs as capture sources. When refreshing, export WebP with lossless compression and retain the same dimensions and filenames; both preview states must be updated together.

The `*-small.webp` variants use high-quality compression at 720px desktop / 240px phone widths. `srcset` and `sizes` let the browser choose an appropriate image. Run `scripts/optimise-website-assets.py` with Pillow and fonttools installed in an isolated environment to refresh these assets and the website's Latin font subsets. Other scripts use the committed outputs and do not require those Python packages.

`case-forge-social.png` is the 1200×630 sharing card, rendered from `scripts/social-preview.html` after local fonts and brand images load. It contains only brand artwork and product copy. The SEO build publishes its absolute URL for social sharing.
