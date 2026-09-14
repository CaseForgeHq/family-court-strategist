---
name: evidence-review
description: >
  Cross-reference evidence across the entire case vault to find contradictions,
  patterns, and gaps. Use when the user says "review my evidence", "find
  contradictions", "what patterns do you see", "cross-reference my documents",
  "update the evidence matrix", "what am I missing", "analyse my whole case",
  or wants a strategic overview of their evidence position.
metadata:
  version: "0.2.0"
---

# Evidence Review

Perform a comprehensive cross-document analysis of the user's case vault. This is where individual document analyses get connected into case-level insights.

Read `_system/verified-facts.md` when present. Preserve VERIFIED facts and use their canonical references. Conflicting evidence must become a conflict review with the new source, never a silent replacement of the existing fact. Source-matched findings remain proposals until explicit human verification. Do not self-verify, resolve conflicts without human review, edit registry JSON or alter generated lock blocks. Use the toolkit fact command and run `check` before sharing dependent documents; if unavailable, preserve locks and report conflicts without changing the registry.

## What to Do

### 1. Read the Vault
Read the key structural files first:
- CASE-DETAILS.md (case basics)
- MASTER-TIMELINE.md (chronology)
- EVIDENCE-MATRIX.md (current evidence map)
- CROSS-DOCUMENT-ANALYSIS.md (existing contradictions)

Then read individual document analyses in `legal-documents/` and `communications/`.

### 2. Cross-Document Analysis

Run every document against every other document looking for:

**Timeline Conflicts** — Same event described with different dates or sequences across documents. Create a table showing Document A vs Document B.

**Statement Evolution** — How someone's story changes over time. Track specific claims from affidavit → report interview → court hearing. Changes in detail, emphasis, or framing are significant.

**Professional Opinion Conflicts** — Where experts, caseworkers, or other professionals disagree. Which opinion is better supported by independent evidence?

**Internal Contradictions** — Where a single document contradicts itself. Note both statements with paragraph references.

**Credibility Vulnerabilities** — Specific points where a party's credibility can be challenged. Build a list with evidence links.

### 3. Pattern Detection

Look across all evidence for:
- Contact blocking or avoidance patterns (track frequency, excuses, timing)
- Relationship interference indicators — often called "alienation" (child's adult-directed language, loyalty conflicts, rejection without cause). Track the behaviours with dates and sources; advise the user that courts are cautious about the "alienation" label, so the evidence should lead with documented behaviour, not the label
- Allegation timing (do new allegations appear before court dates?)
- System failures (recommendations not followed, assessments incomplete)
- Communication patterns (response rates, tone shifts, silence periods)

For each pattern: how many instances? How strong is the evidence? What would a court find compelling?

### 4. Gap Analysis

Identify what's MISSING:
- Documents that should exist but aren't in the vault
- People who should have been assessed but weren't
- Questions that should have been asked but weren't
- Records that could be subpoenaed
- Evidence that would strengthen weak claims

### 5. Update the Vault

After analysis, update:
- EVIDENCE-MATRIX.md with new findings and strength ratings
- CROSS-DOCUMENT-ANALYSIS.md with new contradictions
- COINCIDENCE-MAP.md with timing alignments
- patterns.md with new or strengthened patterns

### 6. Strategic Summary

Present findings as:
1. **Strongest arguments** — your best evidence, why it's compelling
2. **Biggest risks** — where your case is weakest, what could undermine you
3. **Key contradictions** — the most damaging inconsistencies in the other side's case
4. **Missing evidence** — what you still need and how to get it
5. **Next steps** — prioritised actions

## Principles

- Think like a legal strategist, not a note taker
- Always link insights back to specific evidence with source references
- Focus on patterns over isolated events — courts care about behaviour over time
- Prioritise the child's wellbeing in every assessment
- Be honest about weaknesses in the user's case as well as strengths
- Never fabricate or exaggerate evidence
