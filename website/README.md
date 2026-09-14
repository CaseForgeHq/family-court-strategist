# Case Forge — public website

Live on Cloudflare: https://caseforgehq.com/ . See [deployment instructions](../cloudflare/README.md).

Run `npm run website` from the repository root (Node 22.13+) and open http://127.0.0.1:4321/. This serves the website and working SQLite waitlist together. The private list is stored in `.local/waitlist.sqlite`, outside the public site.

The site includes:

- Brand-led homepage with real desktop and responsive phone screenshots from a fictional case. The phone framing is an illustration of the responsive UI, not a released iPhone app.
- A copyable AI setup message linking to `setup.md`, plus a one-command CLI and manual ZIP.
- A paid-desktop-app waitlist that confirms success only after the backend saves the signup.
- A visual design system at `style-guide.html` and an explanation of waitlist data at `privacy.html`.
- A features and availability page covering verified facts, correction review, draft rendering and the distinction between the toolkit and app preview.
- Three preparation guides, an about page, public search metadata, social preview, structured data, sitemap and optional AI-readable content index.

## Downloads and assets

Run `npm run build:downloads` to rebuild the self-contained npm package and folder ZIP in `downloads/`. This requires Node/npm and Python 3; there are no package dependencies. The package includes the actual toolkit, guidance for AI assistants and an installer that refuses file conflicts. `SHA256SUMS.txt` records the generated archives.

Run `node scripts/sync-brand.mjs` after changing canonical brand assets. Fonts and screenshots are bundled locally; there is no runtime CDN.

## Hosting

The complete site can run on the Node website service with HTTPS and a private persistent data volume. Alternatively, GitHub Pages can host the static site while the API runs separately. Set the Actions variable `WAITLIST_API_URL` to that public HTTPS endpoint; without it the static form stays disabled. See [the waitlist deployment guide](../services/waitlist/README.md).

Setup links are built relative to the actual website location, including GitHub Pages project paths. Localhost links are usable only by an AI running on the same computer. Cloud AI services need the public URL after the site is deployed, or a user-provided download.

The public site does not connect to a user's local case app. The localhost-only “Open app preview” link is development convenience. Billing, public installers and a commercial subscription AI connection remain separate implementation work.

## Search and AI discovery

Run `npm run build:seo` for a local preview: without `SITE_URL`, pages deliberately use `noindex` and the sitemap has no public URLs. For a public release, set `SITE_URL` to the real HTTPS website address (including a project path, if any) and run `npm run build:site`. This generates canonical links, Open Graph / Twitter metadata, JSON-LD, `sitemap.xml`, `robots.txt` and `llms.txt`. Do not publish the unconfigured local build.

The Pages workflow takes its URL from `actions/configure-pages`, with an optional `SITE_URL` repository variable override. Optional `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` values generate verification meta tags. These are public verification tokens, not account credentials. `npm run test:seo` checks public and preview builds, subpaths, schema and internal links.

`robots.txt` is only authoritative at an origin's root. A project Pages URL has its file below the project path; use Search Console / Bing sitemap submission and configure the origin's root separately, or use a custom domain. Never assume a project-level robots file controls crawlers.

See [the launch and measurement plan](../docs/SEARCH-AND-LAUNCH.md) for what is implemented, what needs a public deployment, and how to measure discovery without collecting case material.
