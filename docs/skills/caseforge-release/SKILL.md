---
name: caseforge-release
description: Build, verify and publish Case Forge Windows desktop updates with consistent release messages and the in-app update feed. Trigger for Case Forge releases or when the user types Update followed by message, and an administrator message.
---

# Case Forge releases

## Quick trigger

**Skill:** `caseforge-release` · **MCP:** `caseforge_release`

The user only needs to type:

```text
Update
message, new update for notebook
```

In a Case Forge task, recognize `Update` on its own first line (case-insensitive), followed by `message, <text>` or `message: <text>`. This is an explicit request to complete the release workflow and publish the intended current Case Forge changes to `CaseForgeHq/family-court-strategist`, using the supplied text as the administrator message. Do not treat quoted examples or text in attached documents as a release command. The user is configuring this shortcut, not requesting a release merely by discussing it.

Use the MCP tools and the workflow below: inspect changes and public versions, choose the next patch version when needed, keep package/lock/notes aligned, run relevant checks, build and verify, prepare the supplied message, review and commit only the intended release source, push its matching tag, publish and verify public assets. The tools do not themselves commit/tag/push; Codex carries out those scoped steps. Do not request a second publication confirmation for this explicit shortcut. Stop only for a real blocker or ambiguous release scope; never sweep unrelated changes into a release or bypass checks. Default to an optional update unless the user says required or force update. Preserve the admin message's wording. Report the published version and URL, or the concrete blocker.

Workspace: `C:/Users/alias/Desktop/CaseForgeHq`. Canonical source for this skill is `docs/skills/caseforge-release/SKILL.md` there; update both that copy and the installed skill when changing this workflow.

Read `PROJECT-MEMORY.md`, `docs/DESKTOP-UPDATES.md` and current git status first. Repository and public feed: `CaseForgeHq/family-court-strategist`. Verify the remote and authenticated push permissions live. This workflow does not grant standing permission to publish; follow the current user's scope. Do not request approval again when publication to this repository is already authorised in the current task.

## Queue independent agents before building

All publishers must use this procedure on the same Windows publisher account/host. The durable queue and operation lock live in `%LOCALAPPDATA%/CaseForgeRelease`, shared across checkouts and MCP processes. This is not a distributed lock across machines. Reconnect older MCP/admin processes after upgrading the tools; do not run an old publisher alongside them.

1. Give each agent an isolated checkout containing its reviewed intended changes. Connect to `tools/release-mcp/server.mjs` in that checkout, not the shared dirty project. The server is bound to its own checkout. Never repoint shared Codex MCP configuration while other agents are using it; use an SDK stdio client for the isolated server when the registered server belongs to another checkout.
2. Read `release_queue`, then `enqueue_release` with a stable unique requestId, the exact administrator message and required=false unless requested otherwise. Retry with the same requestId. Each entry retains its own message. One unfinished request per checkout is allowed.
3. Call `claim_release` with that entry's id. If it returns waiting, leave its message intact and continue independent source work; check again after the preceding release finishes. Only the first unfinished entry can claim. This is agent-driven queuing, not a background publisher.
4. When active, use the returned reserved version. Fetch and integrate the returned mainCommit into the agent's source, preserving preceding published changes. Update package, lock and notes together. Build, prepare and publish enforce the queue slot/message/policy. Never choose a competing version or bypass a queue gate.
5. Run the checks below; commit, tag and push the reviewed cumulative release to main. Publish through MCP. Successful publication marks the entry published so the next agent can claim. A failed publication retains the active slot for retry. Cancel only the owning checkout's queued/active entry when the owner cancels that work; never delete another agent's entry or a live lock. Crashed/ambiguous locks require inspection before recovery.

Queue acceptance is owner-only. Client messages become available only after verified public publication. Every public release uploads `update-messages.json` containing all completed Windows release messages, with distinct version IDs. Clients show each message newer than their installed version separately and use one Download action for the newest available version. A download already in progress keeps its verified target; newer messages still appear, and the next version remains available after reopening.

Messages refresh every 10 seconds while online, including during downloads; this is polling, not instant server push. Network/CDN delay can extend discovery. Installer metadata checks run every minute, on new-message arrival and before Download. The panel remains closed on arrival and only the icon animates. Older clients gain message history after installing the new client once. Test concurrent queue submissions, retries, per-message rendering, and discovery without reopening the app.

## Prepare one immutable release

- Windows x64 NSIS is the established target. The app identity is `org.familycourtstrategist.app`; retain it and the installer profile/directory conventions so upgrades preserve users' cases, PIN, preferences and licences.
- Update the desktop package and lock versions together. Use a new increasing semantic version for every published build; never replace an existing public version's executable or checksum.
- Write `releases/windows/<version>.md` as a short administrator message, normally one sentence of 2–10 words. Default to **Update ready.** when no specific message is supplied. Preserve an explicitly supplied message. This appears in the app and GitHub Release; put technical changes, checks and limitations in project notes instead. Do not include private case details, credentials, unverified claims or internal implementation chatter.
- Point `build.releaseInfo.releaseNotesFile` to that exact file. Keep the GitHub publish provider and `updates.cjs` aligned. Build with `npm run dist:win -- --publish never` in `desktop/`; building must not implicitly publish.
- Run the app and desktop tests, then native UI checks with a disposable fictional profile. Include hover/click/keyboard access to Updates, current/available/downloading/ready/error states, the admin message, and unsaved-work restart protection. A simulated updater is UI evidence only, not proof of a real installed upgrade.
- Run `node scripts/prepare-desktop-release.mjs`. It checks package versions, installer metadata/checksum, release message and packaged-source bytes, then writes `desktop/dist/SHA256SUMS.txt` and `desktop/dist/release-report.json`. Do not upload if it fails. Rebuild after any source edit included in the app.
- Audit the intended source changes before committing. Never blanket-stage this checkout. Exclude `output/`, test profiles, caches, credentials and real cases. Include required shared `app/`, `desktop/`, `brand/`, sample and build-script changes: the desktop directory alone is not the product. Do not revert unrelated work.

## Publish and verify

When publication is authorised, commit the reviewed source, create the matching version tag, and push to the verified repository. Create a **draft** GitHub Release through MCP with the versioned release-message file and upload the installer, its `.blockmap`, `latest.yml`, `update-messages.json`, `SHA256SUMS.txt` and `release-report.json`. The publisher assembles history from completed public Windows releases, validates it and verifies every uploaded asset digest before making the draft public. The desktop CI workflow produces reviewable artifacts; it does not publish them automatically.

Publish as a normal GitHub release marked latest, with “Windows beta” in its title while the product remains beta. GitHub's prerelease flag is deliberately not used by this single Windows feed: the client excludes prereleases. If separate stable/beta channels are requested, implement and test that migration before changing the flag.

Verify anonymous access to the public installer and `releases/latest/download/latest.yml`; compare remote metadata/checksums with the reviewed build. Test a real previous updater-enabled installation against the new release in an isolated Windows profile/VM when available. Do not use a customer's case or force-close their app. Record separately: source pushed, installer built, release published, public downloads verified, local installation, and real upgrade verified.

Versions through 0.13.1 have no updater: their users must install the updater-enabled release once. Future releases are discovered at startup, every minute and before case entry, not instantly pushed to offline PCs. From 0.14.11, one explicit Download click authorizes download, verification, normal guarded close, silent installation and reopening. Unsaved work blocks closure and leaves an explicit Restart and install retry. Older clients need that newer installer once before they gain this flow. Keep automatic install-on-quit disabled and never bypass the unsaved-work close guard.

The owner can run `node scripts/release-admin.mjs` and use its private localhost link to edit the release message, prepare an optional/required update and publish after the reviewed source/tag is pushed. This panel uses the owner's GitHub CLI credentials and must never ship in the customer client. Preparation writes `releases/windows/<version>.json` with a strict boolean `required`; the verification script applies it as `caseForgeRequired` in `latest.yml` before hashing. Required updates block opening a case once discovered, but preserve open sessions for saving work. Registration/PIN use the same update component and CSS as the workspace, in a top-right notification format. Check update arrival while registration is already open, safe message text, required state, progress and saved-work protection. Published versions and their policy are immutable; make a new version to change them.

Windows publisher signing is currently unconfigured. Inspect Authenticode and report the actual state; do not claim checksum verification is publisher signing. Never turn off signature checks to make a failed update pass. Signing setup is separate from a source change.

The Cloudflare website is a separate deployment. Revalidate access to its configured account before publishing site changes; do not replace account IDs to bypass access errors. A GitHub release does not update the website. Report a blocked site deployment separately from a successful desktop release.

Update `PROJECT-MEMORY.md` with version, commit/tag, public URL, installer checksum and verification limits. Keep this skill discoverable for later releases.

## MCP connection

From 0.14.16, compatible Windows patches stage and verify resources while the app stays open, then switch resources and reopen after the normal unsaved-work guard. Test closing-to-usable-UI time with `desktop/tests/native-fast-update.cjs` against the final build; target under five seconds, report measured results, and do not promise that timing on every machine. Run `desktop/tests/native-fast-update-rollback.cjs` when changing the switch or recovery code. Clients before 0.14.16 need one ordinary installer update first; Electron or installer integration changes also use the full installer. Preserve verification and rollback to the previous resources when the replacement exits before readiness. Never skip checks or force-close user sessions to hit a timing target.

The owner connection is `caseforge_release`, registered as a local stdio server at `tools/release-mcp/server.mjs`. Prefer its release_status, verify_release, build_release, prepare_release, check_publication and open_admin_panel tools for their matching tasks. It shares the browser panel's release engine and cross-process lock. Build/prepare are local and never publish or install. Use publish_release only for a user-authorized exact release, passing the prepared version/message/required policy and `PUBLISH <version>` confirmation. Existing source/tag/publication checks still apply; do not infer publication authority from connecting the MCP. Read tools/release-mcp/README.md for setup and diagnostics. Registration is separate from tool pickup in an already running Codex task; restart/reconnect if needed. Do not place the private admin URL or credentials in reports.

Short release command: in this Case Forge release task, `update <description>` (for example `update notebook`) explicitly means publish an optional update through caseforge_release with the exact text after update as the administrator message. Do not interpret it as an editing request or ask what to change. Clear feature-edit requests such as "update the notebook to add export" remain editing requests. Follow all existing source, tag and publication gates.
