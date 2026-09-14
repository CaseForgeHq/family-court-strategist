# Verified facts: locking, references and correction review

Original fact-locking and propagation proposal by **[@bambam624](https://github.com/bambam624)** in [Case Forge issue #1](https://github.com/CaseForgeHq/family-court-strategist/issues/1). Case Forge's implementation builds on that idea. This credits the proposal, not authorship of the implementation.

## Agent rules

1. A source-matched quote establishes provenance, not truth. App-approved findings remain attributed, unresolved findings until separately verified.
2. Generation agents may propose facts, open conflicts, insert references and render documents. They must never run `verify` or `resolve` without the user's explicit review of the exact fact, sources and proposed decision. Never fabricate a reviewer or infer verification from an instruction to draft a document.
3. Never directly edit `.case-forge/facts/registry.json`, recalculate its hashes, remove history, or overwrite a locked block. There is no general edit, unlock or delete command. A correction creates a new revision following review.
4. Preserve exact names, dates, times, qualifications and attribution. Keep interpretation outside the canonical statement. A message saying “Here now” alone does not establish that a child was collected; formulate an attributed claim or obtain supporting evidence.
5. If evidence conflicts, open a conflict referencing the current revision and the new evidence. The existing verified value remains intact. Live rendering pauses until all conflicts for that fact are reviewed.
6. Use canonical references wherever a fact is reused. Before sharing a generated document, run `check` and resolve errors. Do not strip reference or lock markers to bypass a check.
7. Never silently update an affidavit, signed document, filed submission or previous export. Update its reference template and create a new draft for review.

## Storage and verification meaning

The local registry is `.case-forge/facts/registry.json`. Each fact has a stable ID such as `FACT-00001`, immutable revisions, supporting source IDs, relative original-file paths, exact quotes, page/paragraph/timestamp locators, original-file SHA-256 fingerprints and recorded human verification. Conflicts retain the competing statement and evidence, their originating revision and review decision. A chained event log records proposals, verification and conflict decisions; export records retain output paths, fingerprints and dependencies.

`PROPOSED` means unverified. `VERIFIED` means a named human reviewer deliberately confirmed the exact statement and recorded why. It is not a judicial finding, independent guarantee of truth, or numerical confidence score. Verification produces revision 2; the original proposal remains revision 1. Accepted corrections produce revision 3, then 4, and so on. Rejected conflicts do not change the factual revision.

For TXT/Markdown evidence, the tool checks that each quote occurs exactly in the file. For PDF, image, audio and video evidence it fingerprints the original but sets `quoteChecked: false`; the reviewer must inspect the specified location themselves. No OCR or binary quote extraction is claimed by this tool. All quotes still need speaker, audience and reporting-source attribution in the statement/context under the attribution standards.

## Running the tool

From a source checkout:

```sh
node cli/case-forge.mjs facts ./My-Case list
node cli/case-forge.mjs facts --help
```

An installed toolkit also contains the dependency-free command; Node.js 18+ is required:

```sh
node ./My-Case/.case-forge/tools/facts-cli.mjs ./My-Case list
```

The following examples use `case-forge`, the package's command name. Substitute either command above if it is not on your PATH. Input JSON filenames are relative to the shell's working directory. Evidence, template and export paths are relative to the selected case folder. Only fictional example material is used below.

### 1. Propose a fact

Place original evidence inside your case, such as `evidence/SMS-00342.txt`. Prepare `proposal.json`:

```json
{
  "actor": "case-agent",
  "statement": "In the message to the respondent, the applicant wrote: ‘Here now. It's 4:37.’",
  "sources": [
    {
      "sourceId": "SMS-00342",
      "path": "evidence/SMS-00342.txt",
      "locator": "12 May 2025, message 1; applicant to respondent",
      "quote": "Here now. It's 4:37."
    }
  ]
}
```

```sh
case-forge facts ./My-Case propose proposal.json
```

The returned ID is allocated inside this case; do not assume the example ID is available. Multiple evidence items can support one fact. New and existing app findings are not auto-promoted into the registry.

### 2. Review and verify

The reviewer inspects the exact proposed statement and original evidence. Prepare `review.json` using the revision returned by `show`:

```json
{
  "expectedRevision": 1,
  "reviewer": "Human reviewer name",
  "reason": "Checked the original message, sender, recipient and surrounding conversation. This statement records the message, not proof of collection.",
  "confirmVerified": true
}
```

```sh
case-forge facts ./My-Case show FACT-00001
case-forge facts ./My-Case verify FACT-00001 review.json
```

An unchanged source fingerprint, explicit confirmation, reviewer name and reason are required. Stale revision numbers are rejected. The command records the review supplied to it; it does not authenticate the reviewer.

### 3. Reference and render

In a chronology, affidavit draft or case-summary **template**, insert:

```markdown
{{fact:FACT-00001}}
```

Every live reference resolves to the same current verified revision. Render returns JSON containing Markdown and its dependency manifest; export creates a new Markdown file:

```sh
case-forge facts ./My-Case render drafts/chronology.md
case-forge facts ./My-Case export drafts/chronology.md exports/chronology-v1.md
case-forge facts ./My-Case check
```

The exact factual wording appears inside visible-in-source lock markers:

```markdown
<!-- case-forge:fact FACT-00001 revision=2 sha256=<revision-hash> pinned=false -->
Exact canonical statement.
<!-- /case-forge:fact -->
```

The tool creates the real hash. Never manufacture these markers. It refuses missing IDs, unverified revisions, changed/missing originals, malformed references and unresolved conflicts. Existing output files are never overwritten. Reference templates are preserved, so rerendering after an accepted correction propagates the same revised value into every dependent draft without an AI rewriting it.

An explicitly historical reference, `{{fact:FACT-00001@2}}`, pins revision 2. Use this only to discuss that historical version, with an explanation in the surrounding prose. Pins can render during a conflict and do not advance automatically. Their original evidence must still match its fingerprint.

`check` reports where references and snapshots are used, open conflicts, source changes, missing references, stale unpinned snapshots, changed lock text, broken markers and modified/deleted tracked exports. A changed export is detected even if all its lock markers were stripped. The command exits nonzero when it finds an issue. It inspects visible Markdown case notes, skipping symlinks, hidden tooling, `_system` and `_templates`.

Plain Obsidian/Markdown editors display the reference token until you render it; there is no background editor plugin. Narrative outside references is not semantically checked. Unregistered copies of a fact cannot be discovered reliably; convert them into references deliberately.

### 4. Raise and review a conflict

Prepare `conflict.json` with `actor`, `expectedRevision`, a competing `statement`, supporting `sources` in the same format as a proposal, and a `reason`. Do not overwrite the existing source when new evidence arrives; add a new source file.

```sh
case-forge facts ./My-Case conflict FACT-00001 conflict.json
```

Read the returned conflict ID, then prepare `resolution.json`:

```json
{
  "conflictId": "CONFLICT-<returned-id>",
  "expectedRevision": 2,
  "decision": "accept",
  "reviewer": "Human reviewer name",
  "reason": "Explain the evidence reviewed and why this correction is accepted.",
  "confirmVerified": true
}
```

```sh
case-forge facts ./My-Case resolve FACT-00001 resolution.json
```

Use `reject` to retain the current fact and record why. Accepting creates a new verified revision; both factual versions remain available. Other open conflicts remain open. Review the latest revision again if another correction was accepted while you were reviewing.

## Integrity and recovery boundaries

Registry writes are serialized across processes and atomically replace the JSON file. Readers do not create storage. Source and registry paths reject symlinks; exports use exclusive creation to preserve existing files.

Hashes detect accidental edits and source drift. They are not signatures, trusted timestamps or a security boundary against a person/agent with arbitrary filesystem access, who could rewrite data and recompute hashes. The human-review rule is an agent convention plus explicit command validation, not authenticated role enforcement. Back up the registry with the evidence and exported documents; do not describe it as tamper-proof.

If the integrity check fails, restore a trusted backup and investigate; never “repair” it by recomputing hashes. If a process crashes while holding the lock, first ensure no fact command is still running, then inspect and remove the empty `.case-forge/facts/write.lock` directory. Export creation and registry recording are separate filesystem operations; a crash between them may leave an untracked output. Inspect such an output and generate a new uniquely named export instead of assuming it is registered.

This first implementation provides a toolkit CLI and read-only app API. A dedicated review screen, authenticated reviewer roles, automatic claim-to-fact suggestions and rich-document editor integration are future work.
