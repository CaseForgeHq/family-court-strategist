# Tasks, obligations and deadlines — local app preview

A task records an action, the person responsible and their progress. An obligation
adds an explicit source reference and a user's review of what that source
requires. These are user-maintained work records, not verified legal conclusions
or proof of compliance. No AI connection is needed.

## Start

```sh
npm ci --prefix app
node app/server.js --preview
```

Open **Tasks & deadlines → New task**. The default preview copies the fictional
sample to a temporary folder. For records you want to keep, supply a durable case
folder: `node app/server.js --preview /path/to/case`. Ordinary read-only mode can
view existing tasks but cannot save changes.

## First workflow

1. Enter a specific action, the responsible person and any details.
2. Choose **Personal task** or **Source-linked obligation**. An obligation needs
   an existing case note or imported document, a location such as a page or
   paragraph, and an explicit obligation-review checkbox. Read that source in
   its existing viewer or case file before checking the box. Linking alone does
   not establish that the record is a binding order or the interpretation valid.
3. Dates begin as **No date**. Entering a date puts it in **Proposed — needs
   review**. Record whether it came from personal planning, a source or a
   suggestion. A source-based date needs its source and location.
4. To confirm a date, select **Confirmed by me**, explain how you checked it and
   explicitly tick the confirmation box. The app records your entered name and
   the confirmation timestamp. A suggested date remains labelled as originating
   from a suggestion even after you review and confirm it.
5. Optionally set an **in-app reminder date** on or before a confirmed due date.
   The reminder appears in this task view from that day until completion or
   cancellation. The app does not send email, OS notifications or calendar events.
6. Enter your name and save. Updates require a change note. **Change history**
   keeps previous values, reviewers, confirmation times and completion records.

The **Needs review**, **Overdue dates**, **Due today** and **Reminder due** counts
filter the list when selected. The list also supports open, upcoming, completed,
cancelled and all-task views. Counts refresh every minute while this screen is
open and no draft/save is active, and when you press **Refresh**. They are not a
background notification service. Each task's own timezone determines its day.

## Calendar dates, not calculated cut-offs

This increment deliberately tracks calendar dates. It does not calculate dates
from orders, relative periods, service rules, holidays, court calendars or
extensions, and it does not infer a filing cut-off time. Record any known time or
question in the date-basis field and check it separately. That text is not used
as an executable deadline.

A date is **Due today** for the entire calendar day in the chosen timezone, and
becomes **Overdue date** on the following day. This display does not mean there
is still time to meet an earlier cut-off. Proposed dates are shown in **Needs
review**, even when their calendar date has passed, rather than being presented
as confirmed deadlines. This feature does not claim completeness of obligations.

## Source changes and explicit review

The task stores the source ID/title/location and a SHA-256 digest of the source
file as read at save time. The editor supplies the digest of the source it loaded.
If the source changes before saving, the server rejects that save; refresh the
sources and review again. A title/reference display is not an embedded source
viewer, and a checkbox is a user's assertion of review, not proof they read it.

If a linked source subsequently changes or disappears, an active task moves to
**Needs review** and is excluded from confirmed-date/reminder queues. Earlier
confirmations remain in history. The API exposes `effectiveDeadlineStatus:
"review_required"` alongside the recorded `deadlineStatus` so future dashboards
can distinguish them. Consumers should use the computed `bucket` and
`reminderDue`, not classify records solely by their recorded date/status.

Updating an obligation's wording, responsible person or source requires another
obligation review. Updating the basis of a confirmed deadline (including the
source, action or date) requires another explicit date confirmation, or saving
it as proposed. A missing source cannot support a new confirmation. References
are contextual snapshots: sources remain externally editable and older source
file contents are not archived by the task module.

Journal references are optional and deliberately loaded with **Include journal
references**. Only saved entry titles, IDs and revision digests enter the picker;
account text and reflections are not copied. A journal entry may inform a
personal task, but is not accepted as the sole source of an obligation or a
source-based deadline. A correction to a linked journal entry prompts task
review. Use **Include journal references** again to refresh those references.

## Completion, cancellation and conflicts

- Set **Progress → Completed**, add a completion note and a change note, then
  save. The app records when you marked it complete. The note can describe what
  was done and where the supporting record is kept; this does not independently
  verify compliance or attach proof.
- To reopen, select **To do** or **In progress**, clear the current completion
  field and explain the change. The original completion record stays in history.
- **Cancelled** tasks require a change note and stop generating reminders.
  Cancellation does not assert that an underlying legal obligation ceased.
- Stale edits from another tab are rejected. **Read latest saved version** shows
  the current record beneath your draft. Copy any text you need, discard the
  stale draft and reopen the task before applying an update.
- A save request has an operation ID. Retrying the identical request after a lost
  response does not duplicate the task or revision. Editing the form creates a
  new operation ID.

Drafts remain in this tab's memory across app navigation, with a browser
leave-page warning while one exists. Save before reloading, closing or switching
cases; a native desktop shell may handle leave-page warnings differently. Drafts
are not copied to localStorage. Failed saves leave the draft available.

## Storage and access

Tasks live in `.case-forge/tasks/registry.json`, with previous versions retained
and atomic replacement under a local directory lock. Back up the whole case
folder including hidden `.case-forge` and `.strategist` directories. A persistent
save-in-progress error after a crash may mean a stale
`.case-forge/tasks/write.lock`: close all writers, back up the case, remove only
that empty lock directory, then reopen and inspect saved history before retrying.
Never delete the registry to clear a lock. Damaged storage is not silently reset.

Task reads/writes are case-bound. Mutations require the existing session token,
origin/host checks and server write entitlement or explicit development preview.
Paths reject symlinks. This local JSON store is not encrypted or tamper-proof;
entered names are not authenticated identities, and timestamps use the computer's
clock. Task history does not certify legal review or compliance.

Task content is not added to the case timeline, fact registry, chronology exports
or AI analysis. It does not alter the original source documents or journal.

Limits: title/name 160 characters, details 3,000, completion note 2,000, date basis
1,000, source location/change note 500; the existing server also limits combined
JSON requests to 16,000 bytes. Large multibyte input may reach that combined limit
first. There is no deletion, bulk editing, recurrence, pagination, automated
obligation extraction, external reminder service or task export in this version.
Source checks read linked reference candidates locally; this is a small-case
preview, not a large-file indexing service.

## Next increment

The [product roadmap](PRODUCT-ROADMAP.md) places the daily overview next: reviewed
tasks, confirmed dates, missing material and open questions in one starting view.
Tasks are implemented on `feat/tasks-deadlines` for review, not deployed as a
public hosted app or added to the existing toolkit downloads.
