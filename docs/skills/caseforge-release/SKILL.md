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

## Prepare one immutable release

- Windows x64 NSIS is the established target. The app identity is `org.familycourtstrategist.app`; retain it and the installer profile/directory conventions so upgrades preserve users' cases, PIN, preferences and licences.
- Update the desktop package and lock versions together. Use a new increasing semantic version for every published build; never replace an existing public version's executable or checksum.
- Write `releases/windows/<version>.md` in plain English as the administrator's message. Explain the actual changes, user action and material beta limits. This same message appears in the app and GitHub Release. Do not include private case details, credentials, unverified claims or internal implementation chatter.
- Point `build.releaseInfo.releaseNotesFile` to that exact file. Keep the GitHub publish provider and `updates.cjs` aligned. Build with `npm run dist:win -- --publish never` in `desktop/`; building must not implicitly publish.
- Run the app and desktop tests, then native UI checks with a disposable fictional profile. Include hover/click/keyboard access to Updates, current/available/downloading/ready/error states, the admin message, and unsaved-work restart protection. A simulated updater is UI evidence only, not proof of a real installed upgrade.
- Run `node scripts/prepare-desktop-release.mjs`. It checks package versions, installer metadata/checksum, release message and packaged-source bytes, then writes `desktop/dist/SHA256SUMS.txt` and `desktop/dist/release-report.json`. Do not upload if it fails. Rebuild after any source edit included in the app.
- Audit the intended source changes before committing. Never blanket-stage this checkout. Exclude `output/`, test profiles, caches, credentials and real cases. Include required shared `app/`, `desktop/`, `brand/`, sample and build-script changes: the desktop directory alone is not the product. Do not revert unrelated work.

## Publish and verify

When publication is authorised, commit the reviewed source, create the matching version tag, and push to the verified repository. Create a **draft** GitHub Release with the versioned release-message file and upload the installer, its `.blockmap`, `latest.yml`, `SHA256SUMS.txt` and `release-report.json`. Check every uploaded asset name and size before making the draft public. The desktop CI workflow produces reviewable artifacts; it does not publish them automatically.

Publish as a normal GitHub release marked latest, with “Windows beta” in its title while the product remains beta. GitHub's prerelease flag is deliberately not used by this single Windows feed: the client excludes prereleases. If separate stable/beta channels are requested, implement and test that migration before changing the flag.

Verify anonymous access to the public installer and `releases/latest/download/latest.yml`; compare remote metadata/checksums with the reviewed build. Test a real previous updater-enabled installation against the new release in an isolated Windows profile/VM when available. Do not use a customer's case or force-close their app. Record separately: source pushed, installer built, release published, public downloads verified, local installation, and real upgrade verified.

Versions through 0.13.1 have no updater: their users must install the updater-enabled release once. Future releases are discovered at startup, every minute and before case entry, not instantly pushed to offline PCs. Downloads and restart/install require the user's action. Keep automatic install-on-quit disabled and never bypass the unsaved-work close guard.

The owner can run `node scripts/release-admin.mjs` and use its private localhost link to edit the release message, prepare an optional/required update and publish after the reviewed source/tag is pushed. This panel uses the owner's GitHub CLI credentials and must never ship in the customer client. Preparation writes `releases/windows/<version>.json` with a strict boolean `required`; the verification script applies it as `caseForgeRequired` in `latest.yml` before hashing. Required updates block opening a case once discovered, but preserve open sessions for saving work. Registration/PIN use the same update component and CSS as the workspace, in a top-right notification format. Check update arrival while registration is already open, safe message text, required state, progress and saved-work protection. Published versions and their policy are immutable; make a new version to change them.

Windows publisher signing is currently unconfigured. Inspect Authenticode and report the actual state; do not claim checksum verification is publisher signing. Never turn off signature checks to make a failed update pass. Signing setup is separate from a source change.

The Cloudflare website is a separate deployment. Revalidate access to its configured account before publishing site changes; do not replace account IDs to bypass access errors. A GitHub release does not update the website. Report a blocked site deployment separately from a successful desktop release.

Update `PROJECT-MEMORY.md` with version, commit/tag, public URL, installer checksum and verification limits. Keep this skill discoverable for later releases.

## MCP connection

The owner connection is `caseforge_release`, registered as a local stdio server at `tools/release-mcp/server.mjs`. Prefer its release_status, verify_release, build_release, prepare_release, check_publication and open_admin_panel tools for their matching tasks. It shares the browser panel's release engine and cross-process lock. Build/prepare are local and never publish or install. Use publish_release only for a user-authorized exact release, passing the prepared version/message/required policy and `PUBLISH <version>` confirmation. Existing source/tag/publication checks still apply; do not infer publication authority from connecting the MCP. Read tools/release-mcp/README.md for setup and diagnostics. Registration is separate from tool pickup in an already running Codex task; restart/reconnect if needed. Do not place the private admin URL or credentials in reports.

Short release command: in this Case Forge release task, `update <description>` (for example `update notebook`) explicitly means publish an optional update through caseforge_release with the exact text after update as the administrator message. Do not interpret it as an editing request or ask what to change. Clear feature-edit requests such as "update the notebook to add export" remain editing requests. Follow all existing source, tag and publication gates.
