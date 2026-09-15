# Case Forge — local case workspace

View a case vault, import documents, request AI analysis, review source passages,
and save selected findings as portable Markdown notes on this computer.

This is a **development preview**, not a subscription-ready release. Stripe,
customer sign-in, signed licences and public subscription authentication are not
implemented. Packaged desktop builds remain read-only until entitlement support
is added.

## Start

Requires Node.js **22.13+**. PDF text extraction uses PDF.js locally.

```bash
cd app
npm ci

# Read-only viewer. Does not create or modify case files.
node server.js /path/to/case

# Writable preview using a fresh COPY of the fictional sample case.
PORT=4322 node server.js --preview

# Continue using an existing case folder in development mode.
PORT=4322 node server.js --preview /path/to/case

# Opt-in Claude Code integration for local development only.
PORT=4322 node server.js --preview --claude-code /path/to/case
```

Without a case argument, ordinary viewing uses the bundled read-only sample.
`--preview` copies that sample to an OS temporary folder. The terminal prints its
location. Temporary folders may be cleaned by the OS: use your own durable case
folder for anything you keep. `--no-open` suppresses opening the browser. On
Windows, set `PORT` using your shell's syntax, or use the default port 4173.

## Try the workflow

1. Open **Documents**, then drop in a PDF, TXT or Markdown file (20 MB maximum).
2. Wait for local reading to finish. Review extracted pages if useful.
3. Click **Connect AI** and choose a connection below.
4. Optionally select up to three other imported documents as comparison material.
5. For Claude, explicitly confirm sending the selected extracted text, then click
   **Analyse document**. Adding a file alone never calls an AI provider.
6. Review findings and source pages. Unmatched quotes, invalid dates and
   inconsistencies without two distinct passages cannot be approved.
7. Select findings and click **Save selected findings to case**. Events appear in
   Timeline; claims and follow-up findings appear in Evidence Matrix.

Quote matching verifies that a passage exists on a page, **not** that a claim is
true or a legal conclusion is justified. No automatic evidence-strength score is
assigned. Findings are saved with unresolved status and attribution.

## Case journal

Open **Case journal** to record personal accounts, remembered words and optional
reflections. Event timing is separate from the recording timestamp. Corrections
preserve previous versions; linked records provide context without verifying an
account. Journal entries stay outside current AI analysis and chronology exports.

See [the journal guide](../docs/CASE-JOURNAL.md) for the workflow, draft behaviour,
storage and recovery. Back up hidden `.case-forge/journal` storage with your case.
This feature is available in the writable local development preview; ordinary
read-only mode can view existing entries.

## AI connections

- **Existing Claude sign-in**, shown first: opt-in development bridge to the
  user's own Claude Code installation (CLI options checked against 2.1.202).
  Install Claude Code and sign in separately. Claude Desktop/Cowork alone is not
  sufficient. The app checks local authentication, never asks for an OAuth token,
  and runs analysis with tools, customisations, hooks, MCP, Chrome access and
  session persistence disabled. The app does not offer a public OAuth login.
- **Claude API key:** supply a full model ID and key. The connection check verifies
  the model without sending case content. The key stays in process memory only;
  it must be entered again after restarting. API usage is billed by the provider.
- **Ollama:** start Ollama separately and install a local model. Supply its exact
  name. Only `127.0.0.1:11434` is used; known cloud-routed models are rejected.

Claude connections send the selected extracted document text to Anthropic. Files,
drafts and approved notes are stored locally. No application billing backend or
case-upload service exists. Automated tests use synthetic provider responses and
fictional documents; they do not send a real provider request.

Public subscription support remains a release blocker. Anthropic's developer
guidance restricts third-party subscription login without approval, while its
support guidance separately discusses subscription-backed SDK usage. Verify the
intended public integration with the provider before distributing it:

- https://code.claude.com/docs/en/agent-sdk/quickstart
- https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan

## Local storage and recovery

```text
case/
  .strategist/documents/<content-hash>/
    original.pdf             # preserved original (or .txt / .md)
    document.json            # intake/job status
    pages.json               # extracted page text
    draft.json               # analysis awaiting review
  legal-documents/strategist-<content-hash>/
    analysis.md              # reviewed-batch metadata
    finding-1.md             # selected event or evidence note
    approval.json            # review record
```

Back up the **whole case folder, including hidden `.strategist` storage**, to keep
originals and drafts as well as notes. Identical file contents are deduplicated.
Saving publishes an entire new batch by an atomic directory rename; it does not
rewrite existing user notes. Repeating a save does not duplicate events.
Interrupted jobs are shown for explicit retry and never automatically resubmitted.
Each job stays bound to its original case if the desktop folder picker switches.

## Access boundary

Imports, analysis, approval and chronology generation are checked on the server.
`getAccess(root)` is the integration point for future signed licensing. It is
checked again before writing an asynchronous result or publishing approved notes.
This hook is **not a Stripe implementation or tamper-proof licence system**.
The explicit `--preview` flag enables development; otherwise mutations fail closed.
Existing file viewing and original downloads remain available in read-only mode.

The server binds to loopback, checks Host/Origin, requires a session token for
mutations and binds requests to the active case. Storage rejects symlinked paths.
Keep it on loopback; this is not a network-hosted application.

## Current limits

- Text-bearing PDFs, UTF-8 TXT and Markdown only. OCR, Word, image and email
  ingestion are not implemented. Empty PDF pages are clearly flagged.
- Up to 250 PDF pages and 1 million extracted characters per file; up to 100,000
  selected characters per analysis. Oversized requests are rejected, not silently
  truncated. Jobs run serially, with a 20-job queue and a 3-minute AI timeout.
- Comparison context comes from explicitly selected imported documents. Automatic
  retrieval across legacy vault notes is not implemented.
- Review selects findings; editing findings, undoing a saved batch and automatic
  backups are future work. Existing files remain editable externally.
- The inbox polls every two seconds. Other views can be refreshed for externally
  changed notes; saving reviewed findings refreshes the case model.

## Verify

```bash
npm test
```

Tests cover real PDF extraction, source validation, approval, duplicate uploads,
read-only enforcement, origin/token checks, symlink rejection, cancellation,
restart recovery, case switching, provider adapters and DOM interactions. Desktop
signing, installer behaviour and live provider authentication require separate
end-to-end verification.

## Verified facts (development)

The shared fact registry is available through `node facts-cli.mjs <case-folder> --help` and read-only, case-scoped `GET /api/facts` and `GET /api/facts/FACT-00001` endpoints. See [the feature guide](../docs/VERIFIED-FACTS.md) for the workflow and attribution to @bambam624's original proposal. App-approved source-matched findings remain unresolved; verification is a separate human review through the toolkit command. A dedicated app review screen is not included yet.
