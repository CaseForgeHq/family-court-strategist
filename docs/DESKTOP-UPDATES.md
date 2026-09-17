# Windows updates

The top-bar download button opens Updates on hover, focus or click. The popover shows installed/offered versions, a release message from the Case Forge team, progress and explicit download/restart actions. Escape and outside click dismiss it. Sample data remains under More tools.

`desktop/updates.cjs` wraps the pinned `electron-updater` dependency. `desktop/main.cjs` exposes fixed status/check/download/install IPC actions to its own main workspace, registration and PIN screens. These actions do not unlock case data. The renderer cannot supply a URL or installer path. The packaged provider is the public GitHub repository `CaseForgeHq/family-court-strategist`.

Packaged Windows builds check 15 seconds after startup, every minute and before opening a case. Development builds do not contact the feed. Downloads are manual; install-on-quit, prereleases and downgrades are disabled. A native restart confirmation is followed by the window close/unsaved-work guard. Installation starts only after a clean close. The updater checks the asset checksum; Windows publisher signing is not configured yet.

Registration and PIN entry load the exact same `app/public/updates.js` and `updates.css` through the private protocol. Its notification format appears at the top right when an update arrives, without stealing typing focus. Optional notices can be dismissed and reopened from the blue download control. Required updates also announce themselves in an open workspace.

## Owner release panel

Run `node scripts/release-admin.mjs` from the repository and open the private URL printed in the terminal. Keep that process running while using the panel. It binds only to 127.0.0.1, checks the Host and request origin and requires a random session token. It uses the owner's existing GitHub CLI authentication; no publishing credentials or admin panel are shipped to customers. Restart the command for a fresh link if the page is refreshed or closed.

Edit the admin message and select **Require this update**, then **Save message & prepare release**. A built, source-matching installer is required. Preparation saves the versioned Markdown and a sibling JSON policy, updates the feed metadata and regenerates checksums. It does not publish. After reviewing/committing the source and pushing the matching version tag, type PUBLISH and select **Publish update**. The panel checks the prepared version/message/policy, verifies the build, stages a draft, checks uploaded SHA256 digests and sizes, then publishes it as latest. Public versions cannot be replaced. A failed upload remains a draft and can be retried.

The strict boolean `caseForgeRequired` in `latest.yml` requires users on earlier updater-enabled versions to install before opening a case. An already open case remains usable to save work. The app never forcibly terminates a user's session. A remembered requirement survives transient download/check errors for that running session; offline clients cannot discover a new requirement. The policy is versioned with each release, so changing a public release's policy requires a new version. This is a required-update gate, not a remote kill switch.

Release messages are plain text in `releases/windows/<version>.md`; the build places them in `latest.yml`. Remote messages are rendered as text, never executable HTML. No case documents, people, notebook text or local paths are included in update requests. GitHub receives normal network request metadata.

## Release files

- `Case-Forge-Setup-<version>.exe`
- `Case-Forge-Setup-<version>.exe.blockmap`
- `latest.yml`
- `SHA256SUMS.txt`
- `release-report.json`

Use the `caseforge-release` skill at `docs/skills/caseforge-release/SKILL.md` for the publish sequence. The release verification helper refuses mismatched versions, source bytes or installer metadata. Never publish `latest.yml` without its matching installer.

This first updater-enabled release requires a manual install over versions through 0.13.1. Publishing announces updates to updater-enabled clients on their next check. It does not silently restart them or reach offline computers immediately.
