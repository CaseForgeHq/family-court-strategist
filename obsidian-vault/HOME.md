# Family Court Case Vault

> A structured legal intelligence system for organising, analysing, and strengthening your family court case.

---

## Quick Start

0. Read [[_system/security-and-privacy|Security & Privacy]] — five minutes of setup protects everything below
1. Fill in [[CASE-DETAILS]] with your case basics
2. Add people to the [[PEOPLE-MAP]] and create profiles in `/people/`
3. Start uploading documents to `/legal-documents/` and analysing them
4. Log communications in `/communications/`
5. Build your [[MASTER-TIMELINE]] as events unfold
6. Use the [[DASHBOARD]] to track patterns and gaps

---

## Navigation

### Core Documents
- [[CASE-DETAILS]] — Your case number, parties, court, solicitors
- [[MASTER-TIMELINE]] — Chronological record of all events
- [[PEOPLE-MAP]] — Everyone involved and their relationships
- [[DASHBOARD]] — Live queries across the entire vault

### Analysis
- [[analysis/INDEX|Analysis Hub]] — Evidence matrix, contradictions, patterns
- [[analysis/EVIDENCE-MATRIX|Evidence Matrix]] — Claims vs evidence tracker
- [[analysis/CROSS-DOCUMENT-ANALYSIS|Cross-Document Analysis]] — Contradiction engine
- [[analysis/COINCIDENCE-MAP|Coincidence Map]] — Suspicious timing alignments

### Evidence Sections
- [[legal-documents/INDEX|Legal Documents]] — Court filings, affidavits, reports
- [[communications/INDEX|Communications]] — SMS, email, phone records
- [[timeline/INDEX|Timeline Events]] — Individual event notes
- [[people/INDEX|People Profiles]] — Detailed profiles of every person involved

### Strategy & Reference
- [[legal-research/INDEX|Legal Research]] — Case law and statutory references
- [[_system/analysis-framework|Analysis Framework]] — 13-point forensic protocol
- [[_system/attribution-standards|Attribution Standards]] — How to record quotes accurately
- [[_system/verified-facts|Verified Facts]] — Protect reviewed facts, reference them consistently and review corrections
- [[_system/security-and-privacy|Security & Privacy]] — Protect the vault, the case, and the child (read this early)

---

## The Three Pillars

Every strong family court case rests on three pillars. As you build your vault, keep asking: *does this evidence support one of these pillars?*

### Pillar 1: The Child's Best Interests
What does the evidence show about the child's wellbeing, wishes, and needs? What has each parent done (or failed to do) to support the child's relationship with both parents?

### Pillar 2: Credibility
Where do the other party's claims contradict the evidence? Where do professional findings undermine their narrative? Track every inconsistency.

### Pillar 3: System Accountability
Did your lawyer act in your interests? Were court recommendations followed? Did services do their job? Document every gap.

---

## How This Vault Works

This vault uses **Obsidian** with **Dataview** queries to automatically surface patterns across your evidence. Every document you add should include YAML frontmatter (the `---` block at the top) so the system can query and cross-reference it.

See [[_system/analysis-framework]] for the full protocol.

---

*Start with [[CASE-DETAILS]] → then [[PEOPLE-MAP]] → then start uploading documents.*
