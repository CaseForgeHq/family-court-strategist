---
name: case-setup
description: >
  Set up a new family court case vault from scratch. Use when the user says
  "set up my case", "start my case vault", "I need to organise my family court case",
  "help me build a case", "create my evidence vault", or is beginning a new
  family court matter and needs structure.
metadata:
  version: "0.2.0"
---

# Case Setup

Walk the user through setting up a complete family court evidence vault. This is the foundation everything else builds on.

## Verified-fact setup

Use the current Case Forge toolkit installer when available; it includes `_system/verified-facts.md` and `.case-forge/tools/facts-cli.mjs`. Preserve existing registries and evidence. Read the verified-fact convention before creating case records. Do not prepopulate VERIFIED facts or manufacture reviewer identities. Verification is a separate explicit human review; source-matched claims remain proposals. For manually assembled vaults without the command, preserve any existing lock markers and explain that registry enforcement and rendering require the toolkit command.

## Step 1: Gather Case Basics

Ask the user (use AskUserQuestion) for:
- Court and registry (e.g., Federal Circuit and Family Court, Newcastle)
- File number (if they have one yet)
- Their role (applicant/respondent, father/mother)
- Whether they have a solicitor or are self-representing
- The other party's name and whether they have a solicitor
- Child(ren)'s names and dates of birth
- Current living arrangements
- What outcome they're seeking

## Step 2: Create the Vault Structure

Create an Obsidian vault in the user's workspace folder with this structure:

```
[Case Name]/
├── HOME.md                    — Navigation hub
├── CASE-DETAILS.md            — Case basics (fill from Step 1)
├── MASTER-TIMELINE.md         — Chronological event record
├── PEOPLE-MAP.md              — Everyone involved
├── DASHBOARD.md               — Dataview live queries
├── patterns.md                — Behavioural pattern catalogue
├── _system/
│   ├── analysis-framework.md  — 13-point forensic protocol
│   ├── attribution-standards.md — Quote accuracy standards
│   ├── verified-facts.md      — Canonical facts, locking and correction review
│   └── security-and-privacy.md — Protecting the vault and the case
├── _templates/                — 8 document templates
│   ├── incident.md
│   ├── communication.md
│   ├── affidavit_note.md
│   ├── court_order.md
│   ├── pattern_note.md
│   ├── legal_letter.md
│   ├── strategy_note.md
│   └── person_profile.md
├── analysis/
│   ├── INDEX.md
│   ├── EVIDENCE-MATRIX.md
│   ├── CROSS-DOCUMENT-ANALYSIS.md
│   └── COINCIDENCE-MAP.md
├── legal-documents/
│   └── INDEX.md
├── communications/
│   └── INDEX.md
├── timeline/
│   └── INDEX.md
├── people/
│   └── INDEX.md
├── legal-research/
│   └── INDEX.md
└── .obsidian/
    ├── app.json
    ├── core-plugins.json
    └── appearance.json
```

Read the reference files in `references/` for the complete content of each vault file.

## Step 3: Pre-populate

Fill in CASE-DETAILS.md with the information gathered in Step 1. Create initial people profiles for the user, the other parent, and each child.

## Step 4: Guide Next Steps

Tell the user:
1. Read `_system/security-and-privacy.md` first — disk encryption, fresh passwords, deliberate sync choices, and the warning that publishing case material (including on social media) is an offence in Australia
2. Open the vault folder in Obsidian
3. Install the Dataview community plugin (needed for the Dashboard)
4. Start by uploading their first document and using the "analyze document" skill
5. Build the timeline as they go

Emphasise: the vault is only as strong as the evidence in it. Every claim needs a source. Every quote needs attribution. The system works when you feed it.
