# Case Forge: daily case work and preparation

This records the September 2026 discussion. Build and review one usable feature
at a time. Items below are planned unless explicitly marked implemented; they
must not be advertised as available on the public website before release.

**Current increment:** item 1 is merged into `main` in the local app preview.
See [the journal guide](CASE-JOURNAL.md). Item 2 is implemented for review on
`feat/tasks-deadlines`; see [the tasks guide](TASKS-AND-DEADLINES.md). Its reminders
are in-app calendar-date notices, with no external notifications or automatic
court deadline calculations. Items 3–10 remain planned.

| Order | Feature | First useful outcome | Completion boundary |
| --- | --- | --- | --- |
| 1 | Case journal / parenting log | Record an experience and revisit its history | Separate event and recording times; observations, recalled words and reflections; links to existing records; no automatic factual promotion or AI use |
| 2 | Tasks, obligations and deadlines | A reviewed list of what needs doing | Link each obligation to its source; distinguish user dates from proposed dates; user confirms deadlines; status and reminders |
| 3 | Daily case overview | See the next event, confirmed tasks, missing material and open questions | Show uncertainty and overdue items clearly; derive from the reviewed task records |
| 4 | Communications hub | Read a conversation in context and connect messages to events | Preserve original exports, sender, timestamps/time zones, attachments and surrounding context; deduplication; begin with one agreed format |
| 5 | Redaction and safe sharing | Prepare a reviewed copy with sensitive content removed | Preserve originals; inspect actual exported text, images and metadata; recipient preview; never treat a visual overlay as redaction |
| 6 | Lawyer handoff pack | Give a lawyer an organised, inspectable case export | Index, chronology, source documents, verified facts, disputed claims, questions and tasks; selected scope; reflection exclusion; provenance and redaction checks |
| 7 | Hearing workspace | Open the relevant material quickly | Hearing-specific issues, orders sought, source-linked facts, documents and confirmed tasks; local court/device guidance checked before use |
| 8 | Understand and prepare | Learn the relevant process and prepare an outline | Court/jurisdiction selection, dated official sources, plain-language process, questions to resolve, accessibility needs and source-bound speaking notes |
| 9 | Practise participation | Rehearse explaining a position and answering questions | Explicit simulated roles; feedback on clarity, relevance, attribution and uncertainty; no invented facts, deception or predictions of winning |
| 10 | Hearing debrief | Record what happened and what follows | Keep recollection distinct from issued orders; attach actual orders later; proposed next steps require review before becoming obligations |

## Foundation already implemented

The verified-fact registry, exact fact references, conflict review and tracked
exports implement the proposal credited to **@bambam624**, GitHub issue #1.
The app currently exposes read-only fact APIs; dedicated human verification and
conflict-review screens remain a separate follow-up. Journal links do not verify
a claim or modify a canonical fact.

## Working approach

For each item: describe the user's workflow and exclusions, implement a small
complete version, verify storage and interaction boundaries, then update its
availability documentation. Public capability pages should describe shipped
behaviour and identify previews and planned work explicitly.

The journal is first because it provides a place to record daily experiences
without forcing them into evidence. Tasks then turn reviewed obligations into
action. The dashboard depends on those tasks. Sharing and preparation depend on
clear provenance and deliberate selection.

## Journal first version

- Local app preview; no AI needed. View existing entries in read-only mode.
- Optional event date/time, precision (exact, approximate, unknown), and IANA
  timezone. Never manufacture a time when only a date or uncertain recollection
  is available. The computer's recording timestamp is separate and immutable.
- Title, what happened, remembered words with attribution/context, and optional
  reflection. A reflection-only entry is allowed. All remain personal accounts.
- Explicit links to existing case notes or imported documents. Linking does not
  assert that a document supports the account. Removed targets remain visible as
  unavailable references in the saved history.
- Save intentionally. Corrections require a reason and append a revision. Reject
  stale edits. Keep drafts while navigating inside the same app session and warn
  before closing an unsaved entry. No automatic browser-storage copy.
- Hidden local storage, excluded from case-model discovery and current AI and
  chronology export paths. No journal sharing/export or promotion-to-fact button
  in this first version. Those require an explicit review workflow later.
- Local storage is not encryption, access control against someone using the
  computer, or a claim of legal privilege. Timestamps/history are editable by
  someone with filesystem access and are not certified evidence.
- Back up the whole case folder including hidden storage. Deletion, full-text
  search, attachments and automatic reminders are future increments.
