# Case Forge: search, AI discovery and launch

Implemented 13 September 2026. This is the release checklist for the public marketing website, not the local case app.

## What is ready

| Area | Implemented |
| --- | --- |
| Search results | Unique titles and descriptions, canonical URLs, index controls and a seven-page sitemap generated from the deployment URL. |
| Understandable content | Static HTML guides on document organisation, timelines and AI review; visible answers to product and privacy questions; an about page with source and availability details. |
| Structured data | Organisation, WebSite and WebPage entities; Article and BreadcrumbList on guides; SoftwareSourceCode for the free toolkit. No invented ratings, legal credentials or released desktop product. |
| AI discovery | Readable HTML, connected guides, a portable `setup.md` and optional `llms.txt` content index. Public robots rules allow crawling. |
| Sharing | Branded 1200×630 Open Graph / Twitter card with an absolute production URL. |
| Loading and access | Local font subsets, lossless WebP previews with smaller screen variants, lazy images, font preloads, gzip and ETag support on the Node host, mobile layouts, keyboard access and visible labels. |
| Conversion | Free setup message, CLI copy, downloadable ZIP and a persistent desktop waitlist. The public form requires a deployed API. |
| Release checks | Public versus preview builds, deployment subpaths, schema parsing, links, waitlist persistence, consent, compression and cache revalidation. |

Google says the usual SEO foundations apply to AI Overviews and AI Mode; there is no special schema or AI text file required. Inclusion and ranking are not guaranteed. [Google AI-search guidance](https://developers.google.com/search/docs/appearance/ai-features)

`llms.txt` is an optional content-index proposal, not a search submission mechanism. OpenAI's OAI-SearchBot controls ChatGPT Search crawling independently from its GPTBot training crawler. The website's public wildcard rule permits both; choose any different training policy explicitly at the public host. [llms.txt proposal](https://llmstxt.org/), [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots)

## Public launch status and remaining search setup

Launched on Cloudflare on 13 September 2026: [https://case-forge.red-scene-4bab.workers.dev/](https://case-forge.red-scene-4bab.workers.dev/). The repository is `CaseForgeHq/family-court-strategist`; its homepage now links to the live site. The waitlist uses a private Cloudflare D1 database. No Case Forge custom domain was present in the account, so the initial launch uses the Cloudflare address. Google/Bing verification and sitemap submission remain to be completed; deployment does not imply search indexing.

The repository transfer to CaseForgeHq has been verified. Public project links and generated metadata use that organisation. Kyle Fischer remains the creator; promotional creator credits do not link to a personal developer profile. Existing licence notices and Git history are retained. This wording change does not remove historic authorship or copies held elsewhere.

The Cloudflare hosting, waitlist and public-build work below is complete. Items 4–6 cover remaining search-console setup and ongoing checks; item 7’s repository homepage is already set.

1. Choose the real public address and hosting. For Pages, enable GitHub Actions as the Pages source. The workflow reads the actual Pages base URL; set `SITE_URL` only to override it with an approved custom address. For Node hosting, set the real HTTPS `SITE_URL` when building and `PUBLIC_ORIGIN` when running the service.
2. Deploy the waitlist service with HTTPS, a private persistent database and the correct allowed origin. For a separate static site, set `WAITLIST_API_URL`. Validate a test signup and deletion before inviting real users; arrange launch-message unsubscribe handling before sending emails.
3. Build downloads and the public site. Confirm homepage and guides return 200, missing paths return 404, canonical URLs resolve, the social card loads, and public HTML has no `noindex`. Keep utility pages and APIs out of search. Configure the host's compression/cache rules if using a host other than the Node service.
4. Verify ownership in Google Search Console and Bing Webmaster Tools. Optional repository variables `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` inject the supplied public meta tokens. DNS verification is also possible through the domain owner. These tags do not create or verify accounts by themselves.
5. Submit the generated sitemap in both consoles. Inspect the homepage and each guide after deployment. Review indexing errors and canonical selection. A sitemap is a discovery hint, not an indexing guarantee. [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
6. Check `robots.txt` at the origin root and allow required HTML, CSS, images, fonts and search crawlers through any firewall. A file at `/family-court-strategist/robots.txt` cannot set rules for `caseforgehq.github.io`; use the origin's root configuration or a custom domain. Keep private case files outside the public server entirely.
7. Set the repository's homepage to the live site, add accurate topic labels, and link to the public setup guide from the README. Share the approved launch copy below only after the free download and signup work publicly.

## What to measure

Start with Search Console and Bing reporting: indexed pages, impressions, clicks, queries and landing pages. Review weekly for the first month. Search queries show which useful guide to improve next; do not generate thin keyword or city pages.

The owner can count desktop waitlist entries with `node services/waitlist/manage.mjs count`. The current site does **not** attribute signups to campaigns or collect browser analytics. If attribution is needed, add a chosen analytics service deliberately and update the privacy information. Track only coarse events such as `setup_message_copied`, `toolkit_downloaded` and `waitlist_joined`; never send entered names, email addresses, document text, local paths or case identifiers as analytics properties. A download click is not proof of a completed installation.

Use a mobile performance audit on the real public host after launch. Local Lighthouse results are lab checks, not field Core Web Vitals or evidence of rankings. Inspect referral traffic where available for AI-search visits, while recognising that not every AI visit supplies a referrer. Google includes AI-feature traffic in the Search Console Web search reporting described in its guidance above.

## First distribution work

Use one clear product description consistently on the website and repository:

> Case Forge is a free, open-source toolkit for organising family-court documents, timelines and working notes in a folder you control. Download the files or give the setup link to an AI with local folder access. Prefer one desktop app? Join the waitlist for the planned paid version.

Lead with a fictional-data demo: add a document, inspect the source, review a suggestion and decide what to save. Publish the demo with captions and a transcript that explains the actual available workflow. Show the free setup and desktop waitlist as separate choices.

Share useful guides in relevant open-source and parent-support communities only where their rules permit it. Seek feedback on the tool and clarity of the instructions; do not promise outcomes or post case material. No posts, emails, directory submissions or outreach were sent as part of this implementation.

For the next month, prioritise one genuinely useful improvement each week: a better setup walkthrough, a fictional document-index example, a clearer AI privacy explanation, or an answer to a recurring user question. Use real feedback and the search data to choose. Avoid paid backlink packages and mass-produced promotional pages.

## Verification record — 13 September 2026

The final Lighthouse 12.8.2 mobile audit of a temporary local production build scored performance **97**, accessibility **100**, best practices **100**, and SEO **100**. First contentful paint was 0.9 seconds, largest contentful paint 2.6 seconds, total blocking time 70 milliseconds, and cumulative layout shift 0. These are simulated mobile lab results from the development machine. No public ranking, indexing or field-performance claim follows from them.

The report is saved locally at `output/brand-preview/lighthouse-mobile.report.html` with its JSON beside it. The output directory is ignored by Git. Remaining lab opportunities include longer versioned-asset caching and smaller image transfers; the current one-day asset cache avoids indefinitely serving unversioned files.

Four installer tests, five SEO/build tests and five waitlist/server tests passed. Isolated Chrome checks confirmed fonts, no horizontal page overflow at phone and desktop widths, preview switching, mobile navigation, copy-message/link/CLI actions and successful signup against a separate temporary database, with no JavaScript exceptions. Public guide links and assets resolve. Public-schema and sitemap tests include a project-path deployment. The running local website stays deliberately unindexed.


## Public deployment verification

The live homepage and six supporting pages return 200 with public canonical URLs. Sitemap, robots rules, AI content index, sharing image, setup guide and both download archives load. Missing and private paths return 404. A fresh Chrome profile verified desktop and mobile layouts, fonts, preview switching, setup-copy and successful signup through the real form. The synthetic signup was checked in D1 and removed; no launch email was sent. Cloudflare deployment instructions are in `cloudflare/README.md`.
