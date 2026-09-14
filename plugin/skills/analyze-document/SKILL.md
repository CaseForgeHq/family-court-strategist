---
name: analyze-document
description: >
  Forensically analyse a family court document using the 13-point protocol.
  Use when the user says "analyse this document", "review this affidavit",
  "what does this report say", "break down this letter", uploads a court
  document, affidavit, family report, solicitor letter, or any legal
  document related to their family court case.
metadata:
  version: "0.2.0"
---

# Analyse Document

Apply the full 13-point forensic analysis protocol to any family court document. Think like a legal strategist, not a note taker.

## Protect verified facts

Read the case's `_system/verified-facts.md` when present. Source matching is not truth verification. Treat extracted claims as proposals; preserve existing VERIFIED statements exactly and use canonical fact references in downstream notes. Competing evidence requires a conflict review, never an overwrite. Do not run verification or conflict-resolution commands without the user's explicit review of the exact statement and sources. Never edit registry JSON or generated lock blocks directly. Use the toolkit fact command and run `check` before sharing generated documents. If the toolkit command is unavailable, preserve existing locks and report the conflict without changing the registry.

Original fact-locking and propagation proposal: [@bambam624, issue #1](https://github.com/CaseForgeHq/family-court-strategist/issues/1).

## The 13-Point Protocol

For every document, extract and organise:

1. **FACTS** — Only verifiable facts, no assumptions. Separate what is proven from what is claimed.

2. **CLAIMS** — Who is saying what, with paragraph references. Track the speaker, the reporter, and the audience.

3. **EVIDENCE** — What supports each claim. Rate strength:
   - ★★★ Strong — Multiple independent sources, professional findings, documentary evidence
   - ★★☆ Moderate — Single credible source, consistent with pattern, some corroboration
   - ★☆☆ Weak — Single party claim, no corroboration, potentially self-serving

4. **INCONSISTENCIES** — Conflicting details within this document (dates, times, sequences, names).

5. **CONTRADICTIONS** — Direct conflicts with OTHER documents already in the vault. Cross-reference.

6. **DISCREPANCIES** — Subtle differences or missing details that may be significant.

7. **POTENTIALLY FALSE/MISLEADING** — Claims that lack support or conflict with known evidence. Be specific about why.

8. **PATTERNS** — Repeated behaviours, themes, or language that connect to broader case patterns.

9. **RISK & IMPACT** — How does this affect the child? What are the legal implications?

10. **OPPORTUNITIES** — Weaknesses in the opposing side. Points for cross-examination. Arguments this document supports.

11. **FOLLOW-UP REQUIRED** — Missing information, documents to subpoena, questions to ask, evidence to gather.

12. **EVENT LINKING** — Assign event IDs and link to existing events in the vault.

13. **OBSIDIAN OUTPUT** — Structure the analysis with YAML frontmatter, internal links, and tags for Dataview queries.

## Attribution Standards

CRITICAL: Every quote must include:
- WHO said it (the speaker)
- TO WHOM (the audience)
- PER WHOSE ACCOUNT (which document reports this)
- PARAGRAPH/PAGE REFERENCE

When accounts conflict, present BOTH versions and flag with ⚠️.

Read `references/attribution-rules.md` for the full protocol.

## Document-Specific Guidance

### Affidavits
Read paragraph by paragraph. For each claim: who made it, what evidence supports it, does anything contradict it? Flag every unsupported claim. Count the paragraphs. Note annexures.

### Family/Expert Reports
Focus on: what the expert OBSERVED vs what they were TOLD. Were all relevant people assessed? Do the recommendations follow from the findings? What was buried or downplayed? What recommendations were conditional?

### Solicitor Letters/Advice
Assess: is this advice in the client's interest? What options were NOT presented? Was the client pressured? Does the advice align with the evidence?

### Court Orders
Track: what was ordered vs what actually happened. Every unfollowed order or recommendation is ammunition.

### Communications (SMS, Email)
Note: date, sender, recipient, tone, what was requested, what was the response. Calculate response rates. Build engagement vs avoidance patterns.

## Output Format

Save the analysis as a markdown file in the vault's `legal-documents/` folder using the naming convention: `YYYY-MM-DD_description_analysis.md`

Include YAML frontmatter:
```yaml
---
date: YYYY-MM-DD
type: legal
event_id: [appropriate prefix]-###
people: []
issue: []
source_file: [original filename]
reliability: primary
---
```
