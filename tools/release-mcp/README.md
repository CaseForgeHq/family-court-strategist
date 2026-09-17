# Case Forge release MCP

**Skill:** `caseforge-release` · **MCP:** `caseforge_release`

In a Case Forge task, just type:

```text
Update
message, new update for notebook
```

This tells Codex to build, verify and publish the intended current release with that admin message, following the saved skill. Codex handles the reviewed source commit/tag/push steps as well as the MCP calls. Default: optional update; add “required” if users must update before case entry. Existing validation still applies. Discussing or quoting this example does not publish anything.

Registered name: `caseforge_release`. Local stdio server, launched by Codex. No persistent port or separate terminal is needed for release tools. `open_admin_panel` starts a private loopback panel only when requested.

## Use

- “Check whether the Case Forge release is ready.”
- “Build and verify the current Windows installer without publishing.”
- “Prepare this version as a required update with this admin message: ...”
- “Open the Case Forge release admin panel.”
- “Publish the prepared version 0.14.0 to everyone.” Only do this when intended; it is a real public write.

Tools: `release_status`, `verify_release`, `build_release`, `prepare_release`, `check_publication`, `open_admin_panel`, `publish_release`. Build and prepare never publish or install. Publishing requires the exact version/message/policy and `confirmation: "PUBLISH <version>"`, in addition to the existing reviewed-source/tag/asset checks. A tool argument is not a substitute for the user's authorization.

The server imports the same `releaseActions` used by the browser panel. Both use an exclusive filesystem lock, preventing two MCP processes or an MCP and a new admin-panel process from changing release files simultaneously. Restart any older admin-panel process after updating this code.

If a process crashes while holding `output/release-operation.lock`, the next write fails closed. Inspect its owner and build log before removing that exact stale lock. Live or ambiguous locks must not be deleted. Raw shell builds outside these interfaces do not participate in the lock; source/package verification still rejects a changing candidate.

## Setup and verification

From PowerShell: `& .\tools\release-mcp\install.ps1`. This installs locked dependencies, registers the absolute Node/server paths and sets a 30-second startup and 900-second tool timeout. Other Codex settings are preserved, and timeout edits create a local backup alongside config.toml. New MCP configuration may need a new Codex session or app restart to load. The current task's tool catalog is not proof of registration pickup.

- `codex mcp get caseforge_release --json`: inspect only this connection.
- `npm test --prefix tools/release-mcp`: protocol/validation/shared-lock tests with mocked publication.
- `node tools/release-mcp/smoke.mjs`: real stdio handshake, discovery, local verify/prepare and panel HTTP check; no publish.
- Add `--build` for an actual local build and `--github` for read-only publisher/release checks.
- Build log: `output/release-mcp/build.log`. Smoke report: `output/release-mcp/smoke.json`.

Requires Node.js, the locked desktop/MCP dependencies, Git and GitHub CLI. GitHub publication/checks use the owner's existing `gh` login. Do not put tokens in this package, config examples or PDF reports. There are no arbitrary shell, path, download URL or repository tools.

`release_status` reports the last verification timestamp, not a fresh binary verification. `verify_release` compares the current packaged bytes and regenerates metadata/checksums. `check_publication` reads GitHub metadata; a real installed upgrade and anonymous asset access remain separate checks. The MCP does not commit, tag, push source, choose a new version, configure signing, update the website or install into the user's profile.

Reference: [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and [official MCP SDK guidance](https://modelcontextprotocol.io/docs/develop/build-server).
