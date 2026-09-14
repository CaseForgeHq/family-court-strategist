---
type: system
purpose: Vault-wide attribution standards for all quotes and statements
---

# Attribution Standards — Legal Documentation Protocol

> Every quote in this vault is part of a legal record. Misattributing a statement — even accidentally — can undermine credibility and damage your case. This sets the standard for how ALL quotes, statements, and claims are recorded.

---

## THE RULE

Every quote or paraphrased statement MUST include:

1. **WHO said it** — The speaker (e.g., your name, the other parent, the child, the expert)
2. **TO WHOM** — The audience or recipient
3. **PER WHOSE ACCOUNT** — Which document reports this (e.g., per [name]'s affidavit, per family report)
4. **PARAGRAPH/PAGE REFERENCE** — Exact location in source document (e.g., Para 43, p. 7)

---

## FORMAT EXAMPLES

### Direct Quote — Correct
> [Name] said to [Name]: "[exact words]" — per [Name]'s affidavit, Para 43

### Direct Quote — WRONG (missing speaker attribution)
> ~~"[exact words]" at changeover~~

### Child's Statement — Correct
> [Child] said: "[exact words]" — per [Expert]'s Family Report, Para 99

### Professional Observation — Correct
> Supervision worker described [child] as "[exact words]" — per [Expert]'s Family Report, Para 72

### Disputed Account — Correct
> [Your account] [Name] said contact should not be restricted — per your affidavit, Para 60
> [Their account] [Name] advised restricting contact — per their affidavit, Para [ref]
> ⚠️ CONFLICTING ACCOUNTS — Cannot determine which version is accurate without independent records

---

## SPECIAL CASES

### When Accounts Conflict
- Present BOTH versions side by side
- Label each with whose account it comes from
- Flag with ⚠️ and note what evidence would resolve the conflict

### When a Quote Is Reported Second-Hand
- Always note the chain: "[Child] told [Parent]: '...' — per [Parent]'s affidavit, Para X"
- This makes clear the quote is per one party's account, not an independent record

### When the Speaker Is the Document Author
- Still attribute clearly: "[Name] states in their affidavit (Para 43) that [other person] said..."
- This distinguishes between what someone CLAIMS happened and what is independently verified

### Professional Reports
- Attribute to the professional: "[Expert] noted..." or "[Expert]'s report states..."
- Include paragraph/page reference
- Note whether it's an observation, opinion, or finding

---

## DIGITAL EVIDENCE

Most evidence in modern cases arrives as screenshots, messages, and recordings. The attribution rules apply, plus these:

### Screenshots (SMS, WhatsApp, Messenger, etc.)
- Capture the **full thread context**, not just the single message — a cropped message is easy to challenge
- The screenshot must show **sender identification and timestamp**; if the app hides them, capture the contact/info screen too
- Record: which device the screenshot was taken on, when, and by whom
- Reference format: "[Name] sent to [Name]: '[exact words]' — SMS, [date, time], screenshot taken [date], original on [device]"

### Social Media Posts
- Capture the post, the account name/handle, and the date — and note that accounts can be deleted, so capture early
- Note whether the post was public or in a private group (this matters for how it was obtained)
- ⚠️ Do NOT post or share court material on social media yourself — in Australia this can be an offence (Part XIVB, formerly s121)

### Voice Messages and Recordings
- Transcribe exactly, mark unclear words as [inaudible], and keep the original audio file
- Note: recording laws differ by state — get advice before relying on a recording the other party didn't know about

### Emails
- Preserve the full email including headers where possible (date, sender address, recipients)
- Forwarded text is NOT the same as the original — note the chain

---

## SOURCE INTEGRITY

The markdown notes in this vault are your **analysis**. They are not evidence. The original files are the evidence.

1. **Keep every original** — PDF, image, audio, export — unaltered, alongside or linked from its analysis note
2. **Fill in `source_file`** in the YAML frontmatter of every note so the analysis always points back to its source
3. **Never quote from memory** — open the source document and copy the exact words
4. **Never edit an original** — annotations, highlights, and commentary belong in your analysis note, not the source file
5. **Record how you obtained each document** (served on you, subpoena return, your own records, third party) — provenance questions come up in court

---

## AI-ASSISTED ANALYSIS

If you use an AI assistant (such as the Family Court Strategist plugin) to analyse documents, these rules are mandatory:

1. **Verify every AI-extracted quote against the source document before relying on it.** AI can mis-transcribe words and paragraph numbers — exactly the errors this protocol exists to prevent.
2. **Treat AI output as a draft**, not a record. It becomes part of your case file only after you've checked the quotes, the attributions, and the paragraph references.
3. **Spot-check paragraph references** — open the source at the cited paragraph and confirm the words are there, said by the person the note says said them.
4. **Log corrections** in the audit log below, the same as any other error.
5. AI analysis is `reliability: analysis` in the frontmatter — never `primary`.

---

## COMMON ERRORS TO AVOID

| Error | Why It's Dangerous | Fix |
|-------|-------------------|-----|
| Attributing a quote to the wrong speaker | Could fabricate evidence against the wrong party | Always check the source paragraph |
| Omitting "per whose account" | Implies independent verification when it's one party's claim | Always state whose document reports the quote |
| Confusing speaker with reporter | Reverses who did what | Check: who is the SPEAKER vs who is the REPORTER |
| Paraphrasing in a way that changes meaning | Legal documents require precision | Use exact quotes where possible |
| Wrong paragraph reference | Undermines verifiability | Cross-check against source document |

---

## AUDIT PROTOCOL

When adding or reviewing quotes:

1. **Locate the primary source** — Which document contains this quote?
2. **Read the paragraph** — Who is speaking, to whom, in what context?
3. **Check the chain** — Is this first-hand ("I said") or reported ("He said to me")?
4. **Write with full attribution** — Apply the format above
5. **Cross-check** — Does the same event appear in another document with a different account? If so, include both.

---

## KNOWN CORRECTIONS (Audit Log)

| Date | File | Error | Correction |
|------|------|-------|------------|
| | | | |

---

*This is a living document — update the audit log whenever a correction is made.*
