# Case Forge on Cloudflare

The public marketing website runs as a Cloudflare Worker with static assets. All requests invoke the Worker first so old-domain links, including downloads and images, can redirect to the canonical domain. The local case app and case folders are not deployed.

The `case-forge-waitlist` D1 database stores signup name, email, optional platform, consent version and timestamp. It has no public list/export/admin route. Cloudflare's native rate-limit binding restricts repeated signup attempts; the API also requires the exact configured origin, limits request size, validates fields and saves through a parameterised query. No email is sent automatically.

## Deploy updates

Use Node 22.13+ and Python 3. Sign into the intended Cloudflare account with Wrangler. The checked-in account/database IDs identify resources; they are not credentials. Authentication remains outside this repository.

```sh
npm run test:cloudflare
npm run test:seo
npm run deploy:cloudflare
```

The deploy command builds a public copy in ignored `.dist/cloudflare/site`, using `vars.PUBLIC_ORIGIN` from `cloudflare/wrangler.json` for canonicals, social links, sitemap and robots rules. The checked-in website stays suitable for local preview. Wrangler 4.131.1 is pinned in the command. Downloads are rebuilt from the current source.

For schema changes, review the migration then apply it before deploying the corresponding Worker:

```sh
npx wrangler@4.131.1 d1 migrations apply case-forge-waitlist --remote --config cloudflare/wrangler.json
```

## Waitlist owner access

Public contact: **caseforgehq@proton.me**, matching the CaseForgeHq organisation profile. The site directs correction/removal requests there. Signup submissions are saved in D1; they do not currently email the owner or the subscriber.

To view entries, open the Cloudflare dashboard, choose **Storage & databases → D1 → case-forge-waitlist**, then inspect the `waitlist` table. Only people with the appropriate Cloudflare account access can view these records.

Use Cloudflare's authenticated D1 console or Wrangler. Never publish exports or credentials. For example, count signups without displaying contact details:

```sh
npx wrangler@4.131.1 d1 execute case-forge-waitlist --remote --config cloudflare/wrangler.json --command 'SELECT COUNT(*) AS signups FROM waitlist'
```

The local `services/waitlist/manage.mjs` commands apply to the development SQLite database, not the Cloudflare database. Arrange unsubscribe handling before sending any launch campaign. The public privacy page names Cloudflare D1 as the signup data store.

## Domains and automation

The public address is **https://caseforgehq.com/**. Both `caseforgehq.com` and `www.caseforgehq.com` are bound to the `case-forge` Worker. GoDaddy remains the registrar; DNS is hosted by Cloudflare using `dan.ns.cloudflare.com` and `rachel.ns.cloudflare.com`.

The imported GoDaddy placeholder website records were replaced with Worker domain bindings. The `_domainconnect` and `_dmarc` records were preserved. Cloudflare manages HTTPS certificates for the two custom domains.

`vars.PUBLIC_ORIGIN` is `https://caseforgehq.com`. The build uses this address for canonicals, sharing images, sitemap, robots and setup links; the waitlist API requires the same origin. GET/HEAD requests on `www` and the former `https://case-forge.red-scene-4bab.workers.dev` address redirect to the canonical domain, preserving paths and queries. Requests containing signup bodies on other origins are rejected. Keep `workers_dev: true` so previously shared links continue to work.

[Cloudflare custom-domain documentation](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

Publishing to GitHub does not automatically deploy Cloudflare. The command above performs deployment with the account's authenticated Wrangler session. No long-lived Cloudflare credential has been copied into GitHub. The old Pages workflow is disabled unless `ENABLE_GITHUB_PAGES=true` is deliberately configured.
