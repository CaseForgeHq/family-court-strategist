# Case Forge — website and app rules

Source: the supplied **Case_Forge_Brand_Guidelines.pdf**, 28 pages. These rules translate the guide into the current website, local web app and shared desktop interface. The PDF is a design reference, not authorization to publish, enable billing or make unsupported product claims.

## Identity

- Public name: **Case Forge**. Use the fixed **CASE FORGE** artwork for the logo; keep the space in prose.
- Descriptor: **Open-source case intelligence.** Supporting line: **Organise. Analyse. Prepare.** Hero: **Build your case from the evidence.**
- Keep existing repository paths, application ID, API identifiers and case folder formats stable. “Family Court Strategist” remains a legacy repository identifier.
- Use `brand/logo.svg` on light surfaces, `logo-reversed.svg` on ink, `symbol.svg` for larger symbol-only placements, and `favicon.svg` for the small monochrome browser icon.
- Logo artwork was extracted as vectors from the guide's page 10, including its outlined lettering. Do not reconstruct it with text, generic icons or traced screenshots.
- Clear space: at least one quarter of symbol height; the standard SVG viewBoxes include this. Horizontal artwork must be at least 180px wide (use an image width of at least 200px including its embedded margins). Symbol artwork minimum 24px tall, except the dedicated favicon. Do not distort, rotate, outline or add effects. No tiny tagline: at least 12px on screen or 9pt in print.

## Shared tokens

| Token | Value | Use |
| --- | --- | --- |
| `--cf-ink` | `#0D0D0D` | Headings and dark surfaces |
| `--cf-cream` | `#F8F4EC` | Page background |
| `--cf-copper` | `#C65A2E` | Logo and large graphics |
| `--cf-action` | `#A84424` | Small links and primary buttons |
| `--cf-graphite` | `#444444` | Body and supporting text |
| `--cf-stone` | `#D9D5CC` | Dividers and borders |
| `--cf-paper` | `#FFFFFF` | Working cards and print pages |

The logo's highlight, shadow and fold colours belong to the supplied artwork. Warm neutral surface shades and muted, labelled success/error colours are implementation extensions for the working app; they are not additional brand primaries. Never convey state through colour alone.

Brand copper does not provide sufficient contrast for ordinary small text on cream, or small white button text. Action copper does. Focus indicators use action copper with a visible offset.

## Typography and layout

- **EB Garamond Regular**: website hero 56–72px (48px on small screens), sections 36–48px, app page titles 28–32px. Line height about 1.05–1.15.
- **Inter**: website body 16–18px with 1.55–1.6 line height; main card titles 20–24px semibold; labels and actions 12–14px. Dense app tables may use 12–14px; secondary metadata may be smaller. These are density adaptations, not the marketing body style.
- Use 400 for body, 500 for labels, 600 for actions. The wordmark is supplied outlined artwork.
- Bundle fonts locally, retaining the SIL Open Font Licences. No remote font requests in either surface.
- The English public website uses Latin WOFF2 subsets of the same font designs; other scripts use the system fallback. The local app retains its complete original font assets. `scripts/sync-brand.mjs` applies this delivery difference without changing the colour, type or logo rules.
- Use an 8px rhythm, with 4px refinements. Groups 24–32px; marketing sections 64–96px, reduced on mobile. Body lines roughly 50–75 characters where layout allows.
- Control radius 6px; card radius 12px. White cards, stone hairlines and quiet cream backgrounds. Avoid heavy shadows, glass panels and decorative motion in working screens.
- Outline interface icons should share a 24px grid and roughly 1.5–2px stroke. No scales, gavels, shields, “AI brain” animations or institutional legal symbols.
- Use actual links/buttons, accessible names, visible keyboard focus and responsive layouts. Respect reduced motion. Never hide essential content behind animation or JavaScript.

## Product language and truthfulness

Calm, precise, capable and supportive. Help people organise, examine and prepare. Avoid combative slogans, invented confidence scores, endorsements, statistics, guarantees and “court-ready” promises.

Use names that match implemented functionality: Case overview, Evidence Vault, Case Timeline, Evidence Matrix, Patterns, People, Document Studio and Legal Research. Proposed modules in the guide do not establish that those modules exist.

Make these distinctions visible:

1. The GitHub toolkit is free and available now.
2. The local application is a development preview. A public paid installer, onboarding, Stripe billing and verified subscription access are not complete.
3. Case files are stored locally. Cloud analysis sends user-selected document text to the chosen provider after consent; local storage does not mean all processing stays offline.
4. AI-provider charges are separate. The development Claude Code bridge does not establish an approved subscription connection for a distributed commercial app.
5. “Source matched” means quoted words were found. It does not mean a claim is proven. Findings require user review before saving.
6. Cancellation with retained files and read-only access is the intended paid-product behaviour; do not describe billing integration as live before it exists.

## Preparation documents

Predominantly white pages, small logo, readable text (11–12pt body), source/event references and an explicit draft status. Do not add marketing treatments to official court forms. The app's chronology is a preparation draft; its event IDs allow users to trace notes back to the case.

## Assets and maintenance

Canonical assets: `brand/`. Run `node scripts/sync-brand.mjs` after modifying them. This copies the same files into `website/brand/` and `app/public/brand/`, so the static site and packaged app work independently. The server serves only explicitly allowed brand assets.

Font sources:
- EB Garamond: https://github.com/google/fonts/tree/main/ofl/ebgaramond
- Inter: https://github.com/rsms/inter/tree/master/docs/font-files

Original logo extraction is reproducible with `python3 scripts/extract-brand-assets.py /path/to/Case_Forge_Brand_Guidelines.pdf` (requires PyMuPDF). Normal development does not require the original PDF or Python.

Visual examples: `website/style-guide.html`. This is a component showcase, not a billing or account screen.

Before release, check: asset sync; all app views and dialogs; keyboard focus and mobile layout; no missing local fonts; print readability; and accuracy of availability, AI connection, pricing and privacy wording. Download links, domain ownership and payment configuration require their own implementation checks.

## Homepage composition and message

The homepage must make the audience and purpose explicit: parents organising family-court records, examining documents and preparing questions and next steps. Lead with the toolkit's evidence vault, matrix and chronology. Use the guide's concrete “Start with the prompt” action and keep getting-started guidance and limitations easy to find.

Use the cover's cream-and-ink contrast and the supplied copper folded mark as a strong identity reference. Keep editorial headings, clear margins and fine dividers. Avoid enclosing the hero mark in a generic beige card or adding ornamental linework. The website concept on page 19 provides the content hierarchy; the cover and identity examples provide the broader visual character.

Offer the free setup and planned paid desktop app as two clear routes. Keep detailed app availability and third-party costs in supporting copy. Do not make development internals the main explanation of the brand. `website/home.css` owns this homepage composition; `styles.css` also supports the separate component specimen.

## Setup, product previews and desktop waitlist

Give visitors two clear routes: set up the free toolkit with their AI, or join the paid desktop app waitlist. Keep the setup message copyable and the terminal command optional. Offer the same prepared files as a ZIP. Explain folder access in one sentence; never imply a browser-only chatbot can install local files.

Use actual app screenshots with fictional data inside restrained device frames. Mark desktop screens as development previews and phone screens as responsive layout previews, not a released iPhone product. Device frames may use a subtle physical shadow; working app screens remain flat. Do not use real case data for marketing images.

The waitlist collects only signup details and explicit launch-update consent. Show success only after persistence. Display the planned monthly subscription clearly, alongside the ability to cancel and keep files; keep prices and launch dates unspecified until confirmed. Static hosting must not pretend that an unconnected form is accepting signups.
