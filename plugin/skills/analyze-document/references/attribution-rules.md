# Attribution Rules

Every quote or paraphrased statement MUST include:

1. **WHO said it** — The speaker
2. **TO WHOM** — The audience or recipient
3. **PER WHOSE ACCOUNT** — Which document reports this
4. **PARAGRAPH/PAGE REFERENCE** — Exact location in source

## Format Examples

### Direct Quote
> [Name] said to [Name]: "[exact words]" — per [Name]'s affidavit, Para 43

### Child's Statement
> [Child] said: "[exact words]" — per [Expert]'s Family Report, Para 99

### Professional Observation
> [Role] described [subject] as "[exact words]" — per [Expert]'s Report, Para 72

### Disputed Account
> [Account A] [Name] said X — per [Name]'s affidavit, Para 60
> [Account B] [Name] said Y — per [Name]'s affidavit, Para [ref]
> ⚠️ CONFLICTING ACCOUNTS — flag what evidence would resolve

## Special Cases

- **Conflicting accounts**: Present BOTH, label each, flag with ⚠️
- **Second-hand quotes**: Note the chain ("Child told Parent: '...' — per Parent's affidavit")
- **Author is speaker**: Still attribute ("Name states in their affidavit (Para X) that...")
- **Professional reports**: Note whether observation, opinion, or finding

## Digital Evidence

- **Screenshots**: require full thread context, visible sender + timestamp; record device and capture date. Format: "[Name] sent to [Name]: '[exact words]' — SMS, [date, time], screenshot taken [date]"
- **Social media**: capture account handle, date, public/private context. Warn the user never to post court material themselves (offence in Australia — Part XIVB)
- **Recordings**: exact transcription, [inaudible] markers, keep the original; flag that covert-recording laws differ by state
- **Emails**: preserve headers; forwarded text is not the original — note the chain

## Source Integrity

- The original file is the evidence; the markdown note is analysis. Always set `source_file` in frontmatter
- Never quote from memory — quote from the open source document
- Record how each document was obtained (served, subpoena, own records, third party)

## AI Self-Check (mandatory for this skill)

You are performing AI-assisted analysis, so apply these to your own output:
- Quote ONLY text you can see in the provided document — never reconstruct from memory
- Double-check every paragraph/page reference you cite
- If text is ambiguous, cut off, or illegible, say so — do not fill gaps
- Tell the user to verify extracted quotes against the source before relying on them in court
- Mark your analyses `reliability: analysis`, never `primary`

## Common Errors

- Attributing quote to wrong speaker
- Omitting "per whose account"
- Confusing speaker with reporter
- Paraphrasing in a way that changes meaning
- Wrong paragraph reference
- Relying on an unverified AI-extracted quote
- Cropped screenshot without thread context
