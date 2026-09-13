# Case Forge website and waitlist

The public website uses the [Cloudflare Worker and D1 adapter](../../cloudflare/README.md). The Node service below remains the local-development and optional self-hosted version.

`npm run website` starts the website at http://127.0.0.1:4321 with a working waitlist. Requires Node 22.13+ for built-in SQLite. No npm dependencies, email service or database account is needed for the local preview.

The form saves name, normalized email, optional computer type, consent version and signup timestamp in `.local/waitlist.sqlite`. That private folder is outside `website/` and excluded from Git. Duplicate emails are ignored without disclosing list membership. The service sends no emails automatically.

## Owner access

```sh
node services/waitlist/manage.mjs count
node services/waitlist/manage.mjs export .local/desktop-waitlist.csv
node services/waitlist/manage.mjs remove someone@example.com
```

Exports must go outside the public website directory; the command refuses to overwrite a file. Keep exported signup data private. Launch communications and unsubscribe handling must be connected before sending campaign emails.

## Deploy the complete website

Run this service on a Node host with an HTTPS reverse proxy and persistent storage. Example environment (replace the example origin):

First run `npm run build:downloads`, then run `SITE_URL=https://your-approved-domain.example npm run build:site` using the real public HTTPS URL. Without a public SEO build, the static HTML deliberately remains `noindex`. `PUBLIC_ORIGIN` is a runtime security setting and does not replace this build step. The Node service enables its own waitlist endpoint automatically.

```sh
HOST=0.0.0.0 PORT=8080 PUBLIC_ORIGIN=https://your-approved-domain.example WAITLIST_DB=/data/waitlist.sqlite node services/waitlist/server.mjs
```

`PUBLIC_ORIGIN` must match the actual public origin, with no trailing slash. Store the database on a persistent private volume and back it up. An ephemeral serverless filesystem is unsuitable. The service configures the form automatically when it serves the whole site. A per-connection-address rate limit helps restrain repeated submissions; use your reverse proxy's limits for public traffic. Do not pass untrusted forwarding headers as client identities.

## Keep GitHub Pages and host only the API separately

GitHub Pages can serve the website, setup guide, device images and downloadable toolkit, but cannot run SQLite or receive the form. Deploy this service separately, set `ALLOWED_ORIGINS` to the exact Pages origin (e.g. `https://your-account.github.io`), and set the repository Actions variable `WAITLIST_API_URL` to the deployed HTTPS `/api/waitlist` endpoint. The Pages workflow writes that public endpoint into `site-config.js`. It is a public URL, not a secret.

Until an endpoint is configured, the static site keeps signup disabled and explains its availability. It never claims to have saved a name in browser storage. The local Node preview works independently. The primary public deployment uses Cloudflare Worker assets and D1; see the Cloudflare guide above.

## Verification

`npm run test:waitlist` uses temporary SQLite databases and loopback ports to exercise persistence, duplicates, consent, validation, allowed origins, private-file isolation and rate limiting. No test emails are sent.

Static text responses support gzip and ETag revalidation. Public fonts and preview images have a one-day browser cache; HTML, scripts and styles revalidate. Rename an image or font when an urgent visual update must bypass cached assets. Local preview responses carry `X-Robots-Tag: noindex`; API responses are never cached or indexed. None of this exposes the local app or its case folders.
