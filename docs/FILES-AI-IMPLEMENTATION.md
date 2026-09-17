# Files & AI with local SQLite

Implementation record: 17 September 2026. This combines the local storage foundation with the document scan workflow. It is source work; installer delivery and public release are separate.

## User workflow

1. Add a file in **Case desk**. Importing stores the original locally and does not contact AI.
2. Select **Scan** in the AI column between File name and Type. Repeated clicks cannot create a second active job for the same document.
3. Open **Files & AI** to follow the document card. The application runs at most three document jobs concurrently, across opened cases. Waiting work follows request order; **Scan next** advances a waiting job.
4. Expand the card to see the concise summary, 13 checks, legal references, coverage and attributed source excerpts. Only successfully completed scans show **Scanned** in Case desk.
5. Pause, resume, cancel, retry or scan again. Each saved report is versioned; earlier reports and source snapshots remain available. Restarted active/queued jobs become interrupted and require explicit resume.

Files & AI has no upload control. Results do not create Timeline events, People, Evidence, Tasks, Patterns or map nodes. Cross-document analysis and the dynamic map widget remain deferred.

## Storage, migration and recovery

```text
Selected case folder/
├── .case-forge/
│   ├── case.sqlite
│   ├── originals/<content-hash>/
│   ├── derived/<content-hash>/
│   └── backups/
├── .strategist/documents/       # existing legacy originals remain here
├── Exports/                    # excluded from automatic case ingestion
└── Existing case notes and folders
```

`app/lib/case-database-worker.js` owns the embedded SQLite connection. Foreign keys, WAL, full durability, transactions and serialized requests keep writes short. AI requests never hold database transactions open. FTS5 indexes extracted passages and saved report text with source locators. File metadata is loaded for the register; extraction, report bodies and scan checkpoints are read when needed. Node 22.16+ is required for development because that version introduced the [SQLite backup API](https://nodejs.org/api/sqlite.html#sqlitebackupsourceDb-path-options). Electron supplies the customer runtime; no SQL server installation is required.

Migration backs up legacy metadata, verifies the original content hashes, imports file records and reports transactionally, and records the schema version. Permanent references, content identifiers and original relative paths are retained. Legacy reports are visibly labelled and do not create completed scan jobs. Migration does not invoke AI, delete old metadata or move legacy originals. Notebook, calendar, task, fact and other stores retain their formats.

**Back up case** is available from Case desk. Pause or finish active work first. It uses SQLite's backup API and copies case files, including hidden legacy originals and supporting notes, into a dated backup folder with a SHA-256 manifest. Recursive backups, transient SQLite files and Git metadata are excluded; symlinks are rejected. The manifest hashes copied bytes. **Restore backup** in the desktop app validates all manifest entries before copying to a selected empty local folder. It does not overwrite an existing case. Relative paths and permanent references survive relocation. Account credentials, reader installations and device settings are kept outside the case folder.

## Queue and AI bridge

`app/lib/files-ai.js` binds each job to its canonical case root, content hash and job ID. Its scheduler has three global slots. SQLite persists ordering, stage checkpoints, elapsed work time, errors and report references. Pause and cancellation abort only the relevant reader/provider request. Late results are not published after cancellation or loss of write access. A resumed job reuses completed checkpoints; retry can restart analysis while retaining usable extraction. Rescan creates another report version.

`desktop/chatgpt.cjs` provides separate ephemeral scan threads using `gpt-6-astra` with `low` reasoning. It checks the signed-in account, model availability, reasoning support and image support before sending content. No fallback model is selected. Chat conversation requests remain separate. Scan threads have tools, external integrations and web search disabled; document text and images are data, never application instructions. Per-request cancellation and progress are isolated. Missing sign-in, unavailable model, missing readers, unreadable input, ambiguous jurisdiction and failures are visible states.

The application sends extracted text and selected images only for a requested scan. The document original remains local. Local media transcription uses no cloud transcription service.

## Readers and coverage

See [Files & AI readers](FILES-AI-READERS.md) for pinned dependency sources, local setup, licences, limits and the native verification command.

| Input | Reader and source locations |
| --- | --- |
| Text and PDF | Local text handling/PDF.js; paragraphs/pages, selected page images |
| Office and email | Apache Tika; useful paragraphs, extracted table cells, message structure |
| Images/scanned pages | Astra image input; image/page references, explicitly labelled machine transcription |
| Audio | FFmpeg plus local whisper.cpp multilingual Small; recording timestamps |
| Video | Timestamped transcript, scene-change frames and 10-second samples; sampled coverage disclosed |
| Attachments/archives | Separate registered files with parent provenance; their own explicit Scan actions |

Import size is limited to 512 MB. Reader setup is explicit and downloads approximately 720–770 MB on Windows x64. Missing dependencies never silently produce a completed report. Password-protected, unsupported, truncated or unreadable content remains incomplete. PDF visual selection, reconstructed table coordinates and sampled video are disclosed. Attachment registration is not an assertion that its contents have been analysed.

## Analysis and legal sources

`app/lib/scan-analysis.js` applies these checks in order:

1. Context and jurisdiction.
2. Identity and provenance, with distinct document/event/filing/import dates.
3. Facts and attributed claims.
4. Supporting evidence, strength and limitations.
5. Potentially relevant law.
6. Discrepancies.
7. Inconsistencies.
8. Contradictions within this document.
9. Potentially misleading statements.
10. Patterns within this document.
11. Supported risk and impact.
12. Opportunities and follow-up.
13. Stored structured output and Markdown.

These are logical checks, not 13 full-document requests. A short orientation pass comes first, followed by bounded reading chunks, targeted legal retrieval and diagnostic synthesis. Checkpoints reuse previous successful responses. Quotations are source matched; unknown speaker, recipient, reporting source and sequence remain unknown. A visible court stamp is an observed feature, not authentication. Images must each receive a reading/coverage acknowledgement. A contradiction requires two distinct source passages.

Australian Commonwealth and state/territory selections are case assumptions. Later reading can flag locations and dates that conflict with the orientation sample. Factual findings are retained when legal context needs clarification.

Legal discovery uses generic topic descriptions to request candidate official URLs. The application retrieves only allowlisted Australian legislation hosts, verifies redirects, caches retrieved text and asks for sourced provisions. A returned entry must match text on the retrieved official source. Title, provision, version evidence and effective dates are checked; unresolved historical applicability prevents a completed scan. The result records the official URL, retrieval time and content hash, provision text, relevance and assumptions. Matching source text or a compilation period does not establish a breach or replace legal review. Unreachable/dynamic official pages or missing historical versions remain attention states.

Reports store model details, coverage, source snapshots, legal sources, errors and available usage measurements. Markdown is generated from the stored result in hidden derived storage; it cannot recursively enter the case scanner.

## Interfaces

- `GET /api/documents` and `GET /api/documents/:id` expose metadata, scan state, timing, queue position, coverage and report versions.
- `POST /api/documents/:id/{scan,pause,resume,next,cancel,retry}` controls document-bound jobs.
- `GET /api/documents/:id/{original,source,image,report}` opens preserved originals, versioned sources and Markdown.
- `GET/POST /api/scan-settings` stores jurisdiction selection.
- `GET /api/readers`, `POST /api/readers/setup` expose reader setup/progress.
- `POST /api/case-backup` creates a complete local snapshot; desktop IPC restores it to an empty selected folder.
- Local case search and `/api/files/search` use SQLite FTS for file passages/reports. Existing case stores keep their search adapters.

All mutations retain loopback, session token, origin, case binding and write-access checks. Legacy analyse/approve endpoints direct callers to the new workflow instead of writing findings into other tools.

## Verification and remaining gate

Run the app and desktop regression suite with:

```powershell
node --test app/tests/*.test.js desktop/tests/*.test.cjs
```

The dedicated suites cover migration/hash/reference preservation, duplicate submission, three-slot scheduling, cancellation, restart, checkpoint reuse, case switching, read-only access, source anchors, report versions, legal quotation/date checks, lazy loading, FTS and backup/restore. Pipeline AI responses are explicitly simulated. Native reader tests use real provisioned Java/Tika/FFmpeg/whisper readers with fictional generated files.

Latest complete app/desktop run: **373 passed, 0 failed, 4 conditional native-reader tests skipped**. Those four reader fixtures passed separately with provisioned readers. The regression log is `output/files-ai-suite.log`. Markdown checks include stable IDs, source links, unknown attribution, coverage and legal dates.

`desktop/tests/native-files-ai.cjs` exercises the real Electron shell/server/SQLite at 1380×890 and 804×619 using fictional files and a simulated analysis provider. Captures and its JSON result are written under ignored `output/files-ai-native/`.

All seven native UI captures passed geometry checks and were visually reviewed, with no console errors. `desktop/tests/live-files-ai.cjs` is a separate opt-in runner: without `CASE_FORGE_LIVE_SCAN=1` it checks only the connection; with that flag and a signed-in Case Forge profile it runs three fictional documents (including an image) through the real local API, queue, SQLite and ChatGPT bridge. Its evidence goes to `output/files-ai-live/`.

Live ChatGPT verification remains pending: the Case Forge account profile was checked and is signed out. A signed-in fictional scan must still validate the exact model, image input, three concurrent provider requests and account-expiry behaviour against the real service. Simulated bridge tests do not establish those live results. No real case was used for verification. This work does not publish a release or install an update.
