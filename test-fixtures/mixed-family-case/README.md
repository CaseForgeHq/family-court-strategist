# Mixed fictional case review benchmark

Ten fictional source records covering parenting arrangements, shared expenses and property disclosure. Import only files in `documents/`. Keep `answer-key.json` outside the case and outside AI inputs. Choose More tools > Simulate case > Review test to create a fresh case containing these ten source records. Small, Medium and Large demos and existing cases are preserved.

Use the same model, prompts and reader settings for each recorded run. Run each document separately. Score each expected item as detected, missed or unassessed, and each must-not-conclude item as respected or violated. Record the report ID, model, date, extraction coverage, source references and latency. An unreadable/missing source should produce an explicit limitation, not an invented finding. Claims of intent, legal breach or findings from another document count as false positives.

This baseline tests text ingestion, within-document reasoning and false-positive control. It does not measure OCR, handwriting or PDF layout extraction: those require separate image/PDF fixtures. The incomplete-statement record describes missing content; it is not an OCR quality test. No live model accuracy is claimed by fixture generation or mocked UI tests.

The known issues include a contradicted agreement claim, incorrect expense arithmetic, a payment shortfall and an omitted account. Controls include an agreed reschedule, differently based valuations, equivalent timezone timestamps and a second-hand allegation. An embedded instruction trap must be treated as document content.
