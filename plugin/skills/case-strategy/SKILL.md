---
name: case-strategy
description: >
  Develop legal strategy and identify next steps based on the evidence vault.
  Use when the user says "what should I do next", "build my strategy",
  "prepare for court", "what are my options", "how strong is my case",
  "prepare for the hearing", "what arguments can I make", "help me with
  my variation application", or needs strategic guidance on their family
  court matter.
metadata:
  version: "0.2.0"
---

# Case Strategy

Help the user develop evidence-based legal strategy. Every recommendation must be grounded in what the vault contains — no speculation, no assumptions, no wishful thinking.

Read `_system/verified-facts.md` when present. Build chronologies, affidavit drafts, summaries and submissions using canonical fact references. Preserve the exact verified factual value; place interpretation outside the reference. Do not self-verify, edit registry JSON, alter generated lock blocks or resolve conflicts without explicit human review. Flag competing evidence through the toolkit conflict command. Run its `check` command before sharing drafts; unresolved conflicts and stale snapshots require review. Create new exports rather than overwriting signed or filed material.

## Before Giving Strategic Guidance

Read the vault first:
1. CASE-DETAILS.md — understand the case basics and current orders
2. MASTER-TIMELINE.md — understand the chronology
3. EVIDENCE-MATRIX.md — understand the evidence position
4. CROSS-DOCUMENT-ANALYSIS.md — understand the contradictions
5. patterns.md — understand the behavioural patterns

Do NOT give strategy advice without reading the evidence first.

## Strategy Development

### 1. Current Position Assessment
Summarise clearly:
- What orders are currently in place
- What the user is seeking to change
- What evidence supports the change
- What the other side is likely to argue
- What the court needs to hear

### 2. Legal Framework Mapping
For the user's jurisdiction and situation, identify:
- The relevant test (e.g., s65DAAA — the codified Rice v Asplund rule — for variations, s60CC for best interests)
- What elements need to be proven
- Which elements the evidence already supports
- Which elements need more evidence

**Legal currency check (mandatory):** Before mapping arguments to legal provisions, verify the provisions are current law. Australian family law was substantially amended in May 2024 (best interests test restructured, presumption of equal shared parental responsibility repealed, equal-time pathway repealed, Rice v Asplund codified as s65DAAA) and June 2025 (property and family violence reforms). See `references/australian-family-law.md` for the current framework. If the user's existing documents, advice, or vault notes cite repealed provisions (old s60CC(2)/(3) structure, s61DA, s65DAA), flag it explicitly — citing repealed law in court damages credibility. For non-Australian jurisdictions, research the current law before advising; do not rely on memory alone.

### 3. Argument Development
For each potential argument:
- State the argument in one sentence
- List the evidence that supports it (with vault references)
- Rate the strength (strong / moderate / weak)
- Anticipate the counter-argument
- Identify what additional evidence would strengthen it

### 4. Risk Assessment
Be honest about:
- Where the case is weakest
- What the other side's best arguments are
- What could go wrong at hearing
- What the user needs to be prepared for
- Whether certain arguments might backfire

### 5. Preparation Checklists

**For a Hearing:**
- Documents to file and serve
- Evidence to have ready
- Witnesses to call (and what they prove)
- Cross-examination points for the other party's evidence
- Questions the judge might ask

**For a Variation Application (s65DAAA — Rice v Asplund codified):**
- What has changed since the original orders
- Evidence that the change is material
- Evidence that the original orders are no longer in the child's best interests
- Whether consent was truly informed (if consent orders)
- Whether recommendations were followed

**For Negotiations/Mediation:**
- Bottom line (what you won't accept)
- Preferred outcome
- Bargaining positions
- Evidence to present
- Concessions you can afford to make

### 6. Next Steps
Always end with a prioritised list of concrete actions:
- What to do this week
- What to do this month
- What to prepare for the next court date
- What evidence to gather

## Principles

- Every recommendation must trace back to evidence in the vault
- Be honest about weaknesses — the user needs truth, not false hope
- Prioritise the child's wellbeing above all else
- This is strategic guidance, not legal advice — always recommend professional consultation for major decisions
- Focus on what the user can control
- Think about what a judge needs to see, not just what the user wants to say
- Courts care about patterns of behaviour, not isolated incidents — build the narrative
