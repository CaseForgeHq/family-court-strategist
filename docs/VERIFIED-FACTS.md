# Verified fact registry — implementation branch

Branch: `feat/verified-fact-registry`

Original idea: **[@bambam624](https://github.com/bambam624)**, [issue #1: lock syntax + propagation for verified facts](https://github.com/CaseForgeHq/family-court-strategist/issues/1). Credit is for the proposal; implementation is maintained by Case Forge.

AI drafting can quietly change dates, times, names or exact wording. This branch adds a canonical registry whose verified revisions cannot be overwritten through the supported API. Competing evidence opens a review item; accepted corrections append a new revision. Markdown references resolve deterministically to that registry.

For the complete data format, commands and limitations, read the [toolkit convention](../obsidian-vault/_system/verified-facts.md). The installer bundles the command so the free toolkit can use it independently of the app.

## Included

- Stable fact IDs; proposed and verified revisions; evidence locators, exact quotes and original-file hashes.
- Explicit verification with reviewer and reason, stale-review rejection, conflict acceptance/rejection and retained audit history.
- Canonical Markdown references, historical pins, exact rendered lock blocks and export dependency records.
- Drift checks for source changes, modified exports, damaged locks, stale snapshots and unresolved references.
- Standalone CLI bundled in both package and installed vault; agent conventions in the toolkit and plugin.
- Read-only app endpoints `GET /api/facts` and `GET /api/facts/FACT-00001`, using existing case/session protections. Existing app source-matched findings remain unresolved; the AI analysis provider has no fact mutation endpoint.

Propagation occurs when reference templates are rendered. Previous exports remain snapshots and are flagged if stale. No existing case is migrated or verified automatically. This branch adds the usable registry foundation; it does not yet add an app review screen, binary quote extraction, authenticated review identities or background Obsidian rendering.

## Validation

```sh
npm run test:facts
npm run test:setup
npm --prefix app test
```

Tests use temporary cases and fictional evidence. They cover exact wording, explicit verification, conflicts, stale revisions, historical versions, source drift, modified/deleted exports, registry corruption, cross-process locking, symlink rejection, app case isolation and a complete installed-toolkit workflow.

This branch starts from `feat/local-web-app`, which contains the app and installer. Review its changes against that branch rather than including the existing app development in the feature diff.
