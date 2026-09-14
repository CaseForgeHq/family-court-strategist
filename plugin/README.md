# Family Court Strategist

A Claude Cowork plugin that turns Claude into a legal intelligence assistant for parents navigating family court. Built by a father who's been through it.

## What This Plugin Does

This plugin gives Claude five specialised skills for family court cases:

### Skills

| Skill | What It Does | Trigger Phrases |
|-------|-------------|-----------------|
| **Case Setup** | Creates a complete Obsidian evidence vault from scratch | "set up my case", "create my vault", "organise my case" |
| **Analyse Document** | Runs the 13-point forensic analysis on any court document | "analyse this document", "review this affidavit", "break down this report" |
| **Evidence Review** | Cross-references the entire vault for contradictions and patterns | "review my evidence", "find contradictions", "what am I missing" |
| **Lawyer Accountability** | Tracks solicitor performance, costs, and flags concerns | "is my lawyer doing their job", "review my legal costs", "hold my lawyer accountable" |
| **Case Strategy** | Develops evidence-based strategy and preparation checklists | "what should I do next", "build my strategy", "prepare for court" |

## Who This Is For

- **Parents with lawyers** who need to stay on top of their case, catch what's being missed, and hold their solicitor accountable
- **Self-represented parents** who need to build their own case from scratch with the rigour of a legal team

## How to Use

1. Install this plugin in Claude Cowork
2. Start with "set up my case" to create your evidence vault
3. Upload documents and say "analyse this" to process them
4. Periodically say "review my evidence" for a strategic overview
5. Use "what should I do next" for prioritised action steps

## Important Notes

- This is a case organisation and analysis tool, not a substitute for legal advice
- Always seek independent legal advice for major decisions
- The system is only as strong as the evidence you put into it
- Based on Australian family law (Family Law Act 1975) but the methodology applies to family courts in any jurisdiction

## The Methodology

Every document is analysed through a 13-point forensic protocol:

1. Facts — only what's verifiable
2. Claims — who says what
3. Evidence — strength-rated support
4. Inconsistencies — internal conflicts
5. Contradictions — cross-document conflicts
6. Discrepancies — subtle gaps
7. Potentially false/misleading — unsupported claims
8. Patterns — recurring behaviours
9. Risk & Impact — on the child
10. Opportunities — weaknesses to exploit
11. Follow-up — what's still needed
12. Event Linking — connect to the timeline
13. Obsidian Output — structured for queries

## Attribution Standards

All quotes follow strict legal documentation standards:
- WHO said it
- TO WHOM
- PER WHOSE ACCOUNT
- PARAGRAPH/PAGE REFERENCE

This prevents misattribution — one of the most common and dangerous mistakes in family court preparation.

## Verified facts

The skills preserve canonical verified facts and route corrections through explicit human review. The toolkit bundles a runnable registry command; see the [verified-fact convention](../obsidian-vault/_system/verified-facts.md). Original locking and propagation idea: [@bambam624, issue #1](https://github.com/CaseForgeHq/family-court-strategist/issues/1).
