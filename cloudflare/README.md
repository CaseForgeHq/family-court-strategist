# Case Forge on Cloudflare

The public marketing website runs as a Cloudflare Worker with static assets. Waitlist requests, runtime site configuration and the homepage/index redirect invoke the Worker first. The local case app and case folders are not deployed.

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

The initial address is `https://case-forge.red-scene-4bab.workers.dev`. A Case Forge custom domain can be attached later; update `PUBLIC_ORIGIN`, rebuild and redeploy so canonical URLs and signup-origin checks move together. Configure redirects from the old address when switching.

Publishing to GitHub does not automatically deploy Cloudflare. The command above performs deployment with the account's authenticated Wrangler session. No long-lived Cloudflare credential has been copied into GitHub. The old Pages workflow is disabled unless `ENABLE_GITHUB_PAGES=true` is deliberately configured.
