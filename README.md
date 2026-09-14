# Case Forge

**Open-source case intelligence. Organise. Analyse. Prepare.**

[Visit Case Forge](https://caseforgehq.com/) · [Free setup guide](https://caseforgehq.com/setup.md) · [Desktop app waitlist](https://caseforgehq.com/#waitlist)

A free toolkit and a local app in development for organising family-court documents, examining sources and preparing next steps. Built by Kyle Fischer. The repository and existing download identifiers remain `family-court-strategist`.

The website and local app share the [Case Forge brand rules](docs/BRAND-RULES.md). See the [website](website/README.md) for the design-system preview and the [local app](app/README.md) for the document import and review workflow.

## Verified fact locking

The toolkit includes a canonical fact registry, deliberate verification, conflict review and exact Markdown references. The original locking and propagation idea was proposed by **[@bambam624](https://github.com/bambam624)** in [issue #1](https://github.com/CaseForgeHq/family-court-strategist/issues/1). See [implementation and usage](docs/VERIFIED-FACTS.md). The first version is available through the bundled toolkit command; app review screens are still to come.

---

## Start with the free toolkit

The [website setup guide](website/setup.md) gives a folder-capable AI the steps to install Case Forge and help you get started. The website includes a copyable setup message, a one-command CLI and a ZIP download.

From this checkout:

```sh
node cli/case-forge.mjs init "./My-Case"
```

The installer adds the vault templates and AI guidance while preserving existing files. Conflicting paths stop setup before changes are made. Read `CASE-FORGE.md` in the new folder, or ask your AI to read it and help you begin.

The [public website and desktop waitlist](https://caseforgehq.com/) are live on Cloudflare. For a local preview, run `npm run website` (Node 22.13+) and open http://127.0.0.1:4321/. The downloadable paid desktop app remains in development. See [Cloudflare deployment and waitlist access](cloudflare/README.md) for the live service.

The legacy [full prompt](THE-PROMPT.md) and [getting-started guide](GETTING-STARTED.md) remain available for the manual workflows.

---

## What This Is

Family court is overwhelming. Documents pile up. Lawyers miss things. Patterns get buried. And the parent who should be fighting for their kid ends up drowning in paperwork with no system to make sense of it.

This toolkit changes that.

It gives you two things:

1. **An Obsidian Evidence Vault** — A structured system to organise every document, track every communication, and surface every contradiction in your case
2. **A Claude AI Plugin** — An AI assistant trained on family court methodology that can analyse your documents, find patterns, track your lawyer's performance, and help build your strategy

Whether you have a lawyer or you're self-representing, this system puts you in the driver's seat.

---

## Who This Is For

- **Parents with lawyers** who need to stay across their case, catch what's being missed, and hold their solicitor accountable
- **Self-represented parents** who need to build their case with the same rigour as a legal team
- **Anyone** who refuses to be a passenger in their own family court matter

---

## What's Inside

### The Obsidian Vault (`/obsidian-vault/`)

A ready-to-go evidence system with:

| Component | What It Does |
|-----------|-------------|
| **13-Point Forensic Protocol** | Analyses every document for facts, claims, contradictions, patterns, and opportunities |
| **Evidence Matrix** | Maps every allegation against all available evidence with strength ratings |
| **Contradiction Engine** | Cross-references documents to find where stories change and accounts conflict |
| **Coincidence Map** | Tracks suspicious timing alignments between events |
| **8 Document Templates** | Incidents, communications, affidavits, court orders, patterns, legal letters, strategy notes, person profiles |
| **Dataview Dashboard** | Live queries that surface patterns across your entire vault automatically |
| **Attribution Standards** | Legal-grade protocol for recording quotes accurately — including screenshots, recordings, and AI-extracted quotes — because one misattribution can tank your credibility |
| **Security & Privacy Guide** | Five-minute setup that protects the most sensitive folder on your computer — encryption, passwords, sync choices, and the legal lines you must not cross |
| **Lawyer Accountability Tracker** | Track every piece of advice, every cost, and every action your solicitor takes or doesn't take |
| **Current Legal Research** | The Australian framework as it stands after the May 2024 and June 2025 reforms — pre-loaded, in plain language, with a "law current as at" stamp |

### The Claude Plugin (`/plugin/`)

Five AI skills that turn Claude into a family court strategist:

| Skill | What It Does |
|-------|-------------|
| **Case Setup** | Walks you through creating your vault from scratch |
| **Analyse Document** | Runs the full 13-point forensic analysis on any document you upload |
| **Evidence Review** | Cross-references your entire case for contradictions, patterns, and gaps |
| **Lawyer Accountability** | Evaluates solicitor performance, flags red flags, tracks costs |
| **Case Strategy** | Builds evidence-based strategy and hearing preparation checklists |

---

## Quick Start

### Option 0: Just Use The Prompt (Easiest — Nothing to Download)

Don't want to download anything? Open [THE-PROMPT.md](THE-PROMPT.md), copy the entire prompt, paste it into [Claude](https://claude.ai/download) in Cowork mode, and Claude will build the complete system for you from scratch and walk you through every piece of it. That's it.

### Option 1: Obsidian Vault Only (No AI, No Tech Skills)

1. Download `family-court-vault-template.zip` from the [Releases](../../releases) page
2. Unzip it on your computer and rename the folder to your case name
3. Download and install [Obsidian](https://obsidian.md) (free)
4. Open Obsidian → "Open folder as vault" → select your folder
5. Go to Settings → Community plugins → Browse → search "Dataview" → Install → Enable
6. Open `HOME.md` — this is your starting point
7. Fill in `CASE-DETAILS.md` and start adding your documents

### Option 2: Claude Plugin + Vault (Recommended — Still No Tech Skills)

1. Download `family-court-strategist.plugin` from the [Releases](../../releases) page
2. Download the [Claude desktop app](https://claude.ai/download) if you don't have it
3. Open the `.plugin` file — Claude will ask you to install it, click yes
4. Start a new Cowork session and select your case folder
5. Say **"set up my case"** — Claude will build your entire vault and walk you through it
6. Upload any document and say **"analyse this"** — Claude runs the full forensic protocol

### Option 3: The Local Web App (beta — a nicer view than Obsidian)

Prefer software to Markdown? The **local web app** displays your case in a browser. Its development preview supports importing PDFs and text files, requesting AI analysis, reviewing source passages and saving selected findings into your local case. Ordinary viewing remains read-only. Cloud AI receives only the extracted document text you explicitly select and confirm.

```bash
cd app
npm ci
node server.js                 # see a bundled sample case
node server.js /path/to/vault  # see your own vault
node server.js --preview        # try intake with a writable COPY of the sample
```

Requires [Node.js](https://nodejs.org) 22.13+. Connections include a Claude API key, a local Ollama model, and an opt-in Claude Code sign-in bridge for development. Public subscription login, Stripe billing and signed installers are not ready. Details in [app/README.md](app/README.md) and [desktop/README.md](desktop/README.md).

---

## The Methodology

Every document gets processed through a 13-point forensic protocol:

1. **Facts** — only what's verifiable
2. **Claims** — who says what, with paragraph references
3. **Evidence** — strength-rated (★★★ / ★★☆ / ★☆☆)
4. **Inconsistencies** — internal conflicts
5. **Contradictions** — cross-document conflicts
6. **Discrepancies** — subtle but significant gaps
7. **Potentially false/misleading** — unsupported claims
8. **Patterns** — recurring behaviours
9. **Risk & Impact** — effect on the child
10. **Opportunities** — weaknesses to use
11. **Follow-up required** — what's still needed
12. **Event linking** — connects to the timeline
13. **Obsidian output** — structured for queries

This isn't a checklist someone made up. It was developed through 18 months of real proceedings, real documents, and real mistakes. Every part of it exists because something went wrong without it.

---

## The Golden Rules

1. **Every claim needs a source.** If you can't link it to a document, it's not evidence.
2. **Every quote needs attribution.** Who said it, to whom, per whose account, paragraph reference.
3. **Treat repetition carefully.** Repetition may be relevant, but no fixed count proves a legal pattern. Assess dated sources, context, contrary evidence, and reasonable alternative explanations.
4. **Document everything in real time.** The best evidence is contemporaneous.
5. **Be honest about your weaknesses.** Knowing where you're vulnerable is as important as knowing where you're strong.
6. **The child comes first.** Always. In every argument, every strategy, every decision.

---

## Screenshots

<!-- Add screenshots of the vault in action -->
<!-- TODO: Add Obsidian vault screenshot showing HOME.md -->
<!-- TODO: Add Evidence Matrix screenshot -->
<!-- TODO: Add Dashboard with Dataview queries -->
<!-- TODO: Add Claude plugin in action -->

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to help improve this toolkit.

This is an open project. If you've been through family court and have insights that could help others, your contributions are welcome — whether that's improving the analysis framework, adding templates for your jurisdiction, or translating the methodology for different legal systems.

---

## Disclaimer

This is a case organisation and evidence analysis tool. **It is not legal advice.** Always seek independent legal advice for major decisions in your matter. The methodology is based on Australian family law — the Family Law Act 1975 as amended, including the major reforms that commenced in May 2024 and June 2025 (the included parenting-law reference was reviewed 7 September 2026) — but the analytical framework applies to family courts in any jurisdiction. Family law changes: verify any section reference against the current Act before relying on it in court.

---

## License

[MIT](LICENSE) — Free to use, modify, and distribute. Because no parent should have to pay to fight properly for their kid.

---

## The Story

My name is **Kyle Fischer**. I built this because I had no choice.

I was a father in the Federal Circuit and Family Court of Australia with a solicitor who recommended surrender, a system that buried evidence of alienation, and a settlement I was pressured into signing in 48 hours.

After the dust settled, I started organising everything — not just for my own case, but because I realised the tools to fight properly didn't exist. The legal system expects you to trust your lawyer and hope for the best. This toolkit exists for the parents who refuse to do that.

The family court system is broken. Lawyers get paid whether you win or lose. Reports bury what matters. And parents — usually fathers — get told to "accept the process" while their relationship with their child is destroyed.

I'm not accepting it. And if you're reading this, neither should you.

If this helps one parent stay in their kid's life, it was worth building. If it helps expose the system for what it is, even better.

---

*Created by Kyle Fischer. Published by [Case Forge](https://github.com/CaseForgeHq). For parents. Open source forever.*
