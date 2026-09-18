# Saved sessions and public document testing — 0.14.26

Normal PIN entry now returns to the saved case and page. Existing profiles without a saved page start at Case desk. Setup remains required when the case folder, preferences or terms acceptance are missing. Changing the case folder remains an explicit authenticated action. No plaintext PIN or unlocked authorization is persisted.

The lock button closes the case server and returns to PIN entry. The native test exercises the actual button, rejects a wrong PIN, denies case access while locked, and restores the same case and Files & AI page after unlocking and after relaunch. This saves the selected case and page; it does not promise recovery of unsaved editor drafts.

Validation: 440 automated tests passed; four skipped. Native session test passed using a disposable fictional profile. Release build verification compares packaged source with this checkout. Update UI and final timing results are recorded in the release handoff.

## Public reference collection

A separate local case, `output/Public court document test`, contains seven official PDFs (131 pages). Originals, source URLs, retrieval times and SHA256 hashes are retained locally. Search through the current case database was checked for Kennedy, Stanford and affidavit. No AI review was submitted. These documents are not bundled or committed.

- [MRR v GR (2010)](https://www.hcourt.gov.au/cases-and-judgments/judgments/judgments-1998-current/mrr-v-gr) — 13 pages.
- [Stanford v Stanford (2012)](https://www.hcourt.gov.au/cases-and-judgments/judgments/judgments-1998-current/stanford-v-stanford) — 27 pages.
- [Thorne v Kennedy (2017)](https://www.hcourt.gov.au/cases-and-judgments/judgments/judgments-1998-current/thorne-v-kennedy) — 51 pages.
- [Financial Statement](https://www.fcfcoa.gov.au/fl/forms/financial-statement) — 12 pages, blank form.
- [Affidavit](https://www.fcfcoa.gov.au/fl/forms/affidavit) — 6 pages, blank form.
- [Parenting Questionnaire](https://www.fcfcoa.gov.au/fl/forms/questionnaire-parenting) — 15 pages, blank form.
- [Financial Questionnaire](https://www.fcfcoa.gov.au/fl/forms/questionnaire-financial) — 7 pages, blank form.

This is a reference collection, not a single person's case. Historical judgments do not establish the current law; blank forms do not supply case facts. Source PDFs remain local rather than being redistributed with the product. Use the existing fictional Review test case and its separate answer key to measure expected findings; use these public documents to exercise long documents, citations, headings, dates and blank-field handling.

Next validation: scan one judgment, compare each review point with cited pages, then check that proposed timeline/people entries retain their source and do not combine unrelated proceedings. Blank forms should produce document-type recognition and missing-field observations, not invented allegations. No claim of end-to-end AI accuracy is made from ingestion or keyword-search checks.

Final release checks: native update arrival, shared controls, keyboard access and three layouts passed. Three final-build resource-switch restarts reached readiness in 1,680 / 1,559 / 1,586 ms; staging happened while the app stayed open. This is an isolated benchmark, not a customer installation. Authenticode status is NotSigned.
