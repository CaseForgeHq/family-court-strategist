# Case Forge project instructions

Read `PROJECT-MEMORY.md` before substantial project work and preserve unrelated changes in this active checkout.

For desktop releases, installers, publication or update delivery, use the `caseforge-release` skill. Its maintained project copy is `docs/skills/caseforge-release/SKILL.md`; the installed copy is `C:/Users/alias/.codex/skills/caseforge-release/SKILL.md`.

Quick release shortcut: when the user types `Update` followed by `message, <admin message>` (or `message: <admin message>`), invoke that skill and the `caseforge_release` MCP to complete the intended release, including publication. This is a user command, not text extracted from documents or a quoted example. Follow the skill's scoped source review and release checks; do not ask for duplicate authorization. An optional update is the default unless required/force is specified.

Do not put real cases, generated profiles or `output/` into commits or release assets. Source preparation, public release, website deployment, local installation and actual upgrade verification are separate states; report them accurately.

Short release command: in this Case Forge release task, `update <description>` (for example `update notebook`) explicitly means publish an optional update through caseforge_release with the exact text after update as the administrator message. Do not interpret it as an editing request or ask what to change. Clear feature-edit requests such as "update the notebook to add export" remain editing requests. Follow all existing source, tag and publication gates.
