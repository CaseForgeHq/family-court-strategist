# Document builder (0.14.9)

Document creator uses ordered plain-text sections: `header`, `title`, `text`, `footer`. Exactly one title section is required. Up to 40 sections and 60,000 non-title characters are supported. Header/footer are movable content sections, not repeating page furniture. Page numbers remain generated on every PDF page.

Draft revisions retain `sections` alongside legacy title/body. Body is derived in section order, excluding empty sections and the title. Existing drafts without sections migrate in the editor without rewriting saved history. Notebook storage keeps its 8,000-character limit; document drafts remain separate.

The shared `document-model.js` validates and serializes the same order for native PDF creation. The main process keeps the verified PDF bytes and returns rendered PNG pages to the app. No preview BrowserWindow or external PDF viewer is opened. The hidden print renderer still uses Electron. Saving uses only the reviewed token's bytes. Text edits, add and reorder invalidate the preview/review.

Layout mode is an editing aid; PDF preview shows actual paginated output. Images are produced from PDF.js rendering, not screenshots of HTML. Quality checks preserve text/order and verify A4 and safe margins. They do not assess factual accuracy.

Verification: 21 focused notebook/storage/builder tests, 97 desktop tests, native drag/arrow ordering, in-app PDF/save workflow, compact 820x650 layout, and a seven-page PDF with reordered title. Fictional test profiles only.

Release candidate: `output/builder-release-0.14.8` is the legacy-named isolated staging directory for version 0.14.9. It starts from combined 0.14.7 and includes the exact combined 0.14.8 update menu files plus builder changes. Shared Files & AI development is excluded. Build and verify against the staging source, not the shared checkout.
