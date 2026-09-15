# Case journal — local app preview

The case journal records personal accounts and reflections. It does not verify
facts or decide whether an account is evidence. It requires no AI connection.

## Try it

From the repository:

```sh
npm ci --prefix app
node app/server.js --preview
```

Open **Case journal → New entry**. The default preview uses a temporary copy of
fictional sample data. To keep real entries, supply your own durable case folder:

```sh
node app/server.js --preview /path/to/your/case
```

1. Give the entry a title.
2. Enter the event date/time only if known. Choose **Approximate**, **Exact as
   recalled**, or **Unknown**. Unknown timing requires blank date/time fields.
   A date without a time is valid. Check the event's time zone, especially for
   travel or cross-border communications. The app does not infer a UTC instant
   from ambiguous daylight-saving local times.
3. Describe what happened. Attribute things you learned from others. Use the
   remembered-words field for speaker/context and indicate approximate wording.
4. Optionally open **Personal reflection**. A reflection-only entry is valid.
5. Optionally link existing events, people, issue/pattern notes, evidence notes,
   legal notes or imported documents. These are saved references for context,
   not endorsements that a source proves the account. They show the title and
   record reference; this version does not include a source-opening viewer.
6. Select **Save entry**. The app adds a separate recording timestamp using the
   computer's clock. The event date is not the recording date.
7. Reopen an entry and select **Add a correction**. Explain why it changed and
   save. **Version history** retains the original and every saved correction.

If another tab saved a newer version, your stale save is rejected. Your draft
remains in the form. **Read latest saved version** shows the current account
below your draft. Copy text you want to retain, discard the draft, then reopen
and correct the newer version. The app never silently merges competing accounts.

Drafts remain in memory when navigating between views in the same tab. Closing,
reloading or switching the case can lose an unsaved draft; the browser receives a
leave-page warning while one exists. Native desktop navigation may handle this
warning differently. Save before switching cases. Drafts are not copied into
localStorage or sessionStorage. A failed save leaves the form available to retry;
identical retries do not create duplicate entries or corrections.

## Separation and privacy

- Entries always remain **personal accounts**, separate from the fact registry.
- The summary list omits account text, remembered words and reflections. Titles
  and event/recording times are visible in the list; choose titles accordingly.
- Saved reflections start collapsed in the entry and history screens. Opening
  an entry loads its full history locally; collapsing is a display choice, not
  password protection.
- Journal content is excluded from the app's current case model, timeline,
  chronology export, document selection and AI-analysis paths. This release has
  no journal export, automatic task extraction or promotion-to-fact workflow.
- A person or external tool with access to the case folder can read or edit the
  storage. This feature does not provide encryption, certified timestamps,
  authenticated authorship, legal privilege or tamper-proof history.
- Read-only workspaces can read existing entries. Writes require the same server
  entitlement/explicit development-preview boundary as other app mutations.

## Storage and recovery

Entries and revisions are stored in
`.case-forge/journal/registry.json` inside the selected case folder. Back up the
whole folder **including hidden `.case-forge` and `.strategist` directories**.
Each save atomically replaces the registry while holding a local directory lock;
failed validation does not replace the saved file. Concurrent writers retry
instead of overwriting each other. Record IDs are generated UUIDs; each save
requires the revision the editor originally loaded.

A crash during a write can leave `.case-forge/journal/write.lock`. If repeated
retries still report a save in progress:

1. Close all Case Forge processes using that case.
2. Back up the case, including hidden storage.
3. Confirm no writer is running, then remove only the empty `write.lock`
   directory. Do not delete `registry.json`.
4. Reopen and inspect the most recent saved version before retrying.

Malformed storage is not silently reset. Restore a known-good backup and retain
the damaged file separately for investigation. The registry is a simple local
JSON store intended for the preview, with all history retained; deletion,
attachments, search and larger-store pagination are not implemented.

Field limits: title 160 characters, account 4,000, remembered words 3,000,
reflection 3,000, correction reason 500, and 20 linked records. Requests also use
the server's combined 16,000-byte JSON limit, so some multibyte text may reach
that limit before every individual field is full. An oversized save is rejected
without clearing the draft.

The wider sequence is in [the product roadmap](PRODUCT-ROADMAP.md). The journal
is an app-preview feature; it is not included as an editor in the v0.2.0 toolkit
downloads or deployed public website.
