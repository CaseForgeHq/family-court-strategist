# Windows updates

The update icon changes from a shield to a download arrow with a gold ! badge when a release arrives. It never opens the message automatically. Hover, focus or click to read Case Forge Admin Says and use Download or Close. Current versions show You are currently up to date.

`desktop/updates.cjs` wraps the pinned `electron-updater` dependency. `desktop/main.cjs` exposes fixed status/check/download/install IPC actions to its own main workspace, registration and PIN screens. These actions do not unlock case data. The renderer cannot supply a URL or installer path. The packaged provider is the public GitHub repository `CaseForgeHq/family-court-strategist`.

From 0.14.19, packaged Windows builds begin checking after 1.5 seconds. Published messages refresh every 10 seconds; installer metadata checks run every minute, on a new-message arrival and before Download/case entry. Network/CDN delay may extend discovery. Development builds do not contact the feed. Downloads are manual; install-on-quit, prereleases and downgrades are disabled. Download verifies the update while the app stays open, then uses the normal unsaved-work close guard and installs silently with automatic relaunch. Late checks cannot reset an active download. A differential fallback switches to an indeterminate complete-update animation instead of a backwards percentage. The updater checks asset checksums; Windows publisher signing is not configured yet.

Each published message newer than the installed version has its own row, newest first, with one Download action for the newest release. New messages continue to arrive during a download without changing its target or progress. See [publisher queue and history](RELEASE-QUEUE.md) for the multi-agent procedure and bootstrap behavior.

Registration, PIN entry and the workspace share updates.js and updates.css. Arrival only animates the icon; it does not open a message or move focus. Real-time IPC reports download, verification and restarting stages. Required updates retain their existing case-entry gate.

## Owner release panel

Run `node scripts/release-admin.mjs` from the repository and open the private URL printed in the terminal. Keep that process running while using the panel. It binds only to 127.0.0.1, checks the Host and request origin and requires a random session token. It uses the owner's existing GitHub CLI authentication; no publishing credentials or admin panel are shipped to customers. Restart the command for a fresh link if the page is refreshed or closed.

Submit and claim the release through the MCP queue before building. The panel displays pending releases and prepares the matching claimed message/policy. A built, source-matching installer is required. Preparation saves the versioned Markdown and a sibling JSON policy, updates the feed metadata and regenerates checksums. It does not publish. After reviewing/committing the source and pushing the matching version tag to main, type PUBLISH and select **Publish update**. The panel checks the queue slot and prepared version/message/policy, verifies the build, stages a draft, checks uploaded SHA256 digests and sizes, then publishes it as latest and completes the queue entry. Public versions cannot be replaced. A failed upload remains a draft and retains its slot for retry.

The strict boolean `caseForgeRequired` in `latest.yml` requires users on earlier updater-enabled versions to install before opening a case. An already open case remains usable to save work. The app never forcibly terminates a user's session. A remembered requirement survives transient download/check errors for that running session; offline clients cannot discover a new requirement. The policy is versioned with each release, so changing a public release's policy requires a new version. This is a required-update gate, not a remote kill switch.

Release messages are plain text in `releases/windows/<version>.md`; the build places them in `latest.yml`. Remote messages are rendered as text, never executable HTML. No case documents, people, notebook text or local paths are included in update requests. GitHub receives normal network request metadata.

## Release files

- `Case-Forge-Setup-<version>.exe`
- `Case-Forge-Setup-<version>.exe.blockmap`
- `latest.yml`
- `update-messages.json`
- `SHA256SUMS.txt`
- `release-report.json`

Use the `caseforge-release` skill at `docs/skills/caseforge-release/SKILL.md` for the publish sequence. The release verification helper refuses mismatched versions, source bytes or installer metadata. Never publish `latest.yml` without its matching installer.

This first updater-enabled release requires a manual install over versions through 0.13.1. Publishing announces updates to updater-enabled clients on their next check. It does not silently restart them or reach offline computers immediately.

## Prepared patches (0.14.16+)

The admin message defaults to **Update ready.** Keep release messages short; technical release evidence belongs in project notes. The current-state message remains **You are currently up to date**.

The verified installer is downloaded, extracted and checked while the app remains open. A build manifest records Electron engine hashes, resource hashes and installer integration settings. Only a newer version with matching engine and integration is eligible for a prepared resource switch. Unknown installed resource files, an incompatible package or failed preparation uses the normal verified NSIS installer instead.

After the usual unsaved-work guard permits closing, the independent native helper waits for the old process to exit, retains its resources, moves the prepared resources into place, and reopens the same executable with the same user-data directory. A double animation-frame acknowledgement from the initialized registration/PIN renderer marks the app usable. Only then is the retained resource directory removed. A replacement that exits before readiness restores the previous resources and relaunches; that version subsequently uses NSIS. This is a recoverable directory switch, not a filesystem transaction or a guarantee against power loss.

The animation says **Restarting Case Forge**. From 0.14.17, the native window embeds the official Case Forge symbol, shows the actual **Updating v… → v…** versions and rotates short messages every five seconds. Automatic reopening is the first message. Full installations show the owner's 30–45 second estimate; compatible patches instead say they can restart in under five seconds. A third message explains the goal of bringing every restart below five seconds. Messages never delay completion, and recovery or extended-wait status takes priority. Older clients use their existing restart screen while installing this release; the branded screen applies to updates initiated by 0.14.17 and newer.

Preparation happens before downtime. Benchmark the final packaged build using `desktop/tests/native-fast-update.cjs`; the target is under five seconds from the restart request through usable entry UI, excluding download and preparation. `desktop/tests/native-fast-update-rollback.cjs` injects a broken replacement and checks restoration plus saved test data. Measurements are machine-specific, not a universal time guarantee. `desktop/tests/native-update-handoff.cjs` verifies the native versions, rotation and dismissal with a fictional app and captures the actual window.

Installing 0.14.16 from an older client still uses its existing full installer. Subsequent compatible patches can use the prepared switch. Electron upgrades and changes to installer integration continue to use NSIS. The Windows executable/uninstall metadata retain the last full installation version until the next full install; the running app and update feed use the new package version.

The pinned builder toolset supplies 7za.exe for extraction, with its license files included. Installer SHA512, packaged resource hashes and unchanged engine files are checked before any close. No case files are part of the installation resource switch.

## Full-installer restart status (0.14.15+)

After a clean close, a small native status window is copied to a temporary directory and shown before installer handoff. It remains independent of the files being replaced and closes after the original process exits and the replacement executable has a visible window. It never downloads, installs, starts the app, or accesses case files. Closing the status window does not cancel the update. A delayed installation shows a longer-wait message after 90 seconds; the status window exits after ten minutes.

The build compiles desktop/update-handoff.cs using the Windows .NET Framework compiler and verifies the packaged helper bytes. Differential downloads remain enabled and completed downloads are reused for a blocked-close retry. The full NSIS installation path is not covered by the prepared-patch restart target.
