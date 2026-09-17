# AI chat and ChatGPT sign-in

Implemented 17 September 2026. The main-branch integration includes the
0.14.12 source and preserves its one-click updater and document-builder alignment.
This source integration does not publish a new installer or replace the installed app.

## Interface

The header **AI** action opens the existing case panel with a locally bundled
Deep Chat 2.5.1 Web Component. It supplies Markdown messages, a multiline
composer, streaming replies and Stop. Case Forge provides connection controls,
New conversation, accessible completion announcements, and its day/night theme.
The compact 804 × 619 layout keeps both the conversation and composer usable.

The black **Sign in with ChatGPT** button uses unchanged official OpenAI Blossom
artwork. The button layout belongs to Case Forge; this is not a claim of an
OpenAI-endorsed button component. Asset provenance and rights notices are in
`app/public/vendor/openai/NOTICE.md`. Component selection, version, licences and
hashes are recorded in `AI-CHAT-COMPONENT-RESEARCH.md` and the vendor directory.

Only typed messages are sent from ordinary chat. Case files are not implicitly
attached. Ordinary conversations are separate from scan jobs and deep search.
Closing/reopening the panel retains the current conversation. New conversation
resets both the displayed messages and the provider thread. Signing out clears
the visible history; conversation history is not persisted across app restarts.

## Account lifecycle

`chatgpt-connection.js` shares one account controller between chat and Files & AI.
It listens for native account events, refreshes on focus, deduplicates requests,
and polls only while sign-in is pending and a view is subscribed. Stale replies
cannot override newer account events. Temporary transport errors retain the last
known account and conversation, with a visible error; confirmed logout clears
them. The scan sign-in modal updates without a manual Check connection step.

The production bridge reacts to `account/login/completed` and `account/updated`
by reading the runtime's current account and pushing sanitized status to the
workspace. It supports sign-in cancellation/retry independently of a chat reply,
ordinary chat cancellation, and isolated document scan requests.

The managed Codex runtime retains and refreshes ChatGPT credentials in the OS
keyring using the stable application profile's `chatgpt` directory. Neither
SQLite nor browser localStorage stores tokens or an authoritative signed-in flag.
The production app identity/profile path is unchanged, including across app
updates. Native IPC checks the workspace sender and main frame. Stream events
carry request IDs so one request cannot update another conversation. Final
answers replace progress commentary when necessary.

Model-generated HTML is disabled. The component makes no external font or
provider requests. Link clicks allow only HTTP(S) addresses without credentials,
through validated native IPC; other schemes are blocked. The existing desktop
CSP and tool-disabled chat runtime remain in force.

## Verification and manual testing

- Isolated main-branch candidate: 395 app/desktop tests passed, 4 conditional
  native-reader tests skipped; all 6 setup tests passed. After integrating the
  document-builder update that subsequently reached main, all 86 affected UI,
  document-builder, ChatGPT and updater checks passed. Unrelated in-progress
  weather changes remain outside this integration.
- Broad app/desktop run: 403 passed, 4 conditional native-reader skips before the
  final late-output regression. Log: `output/chatgpt-ui-suite.log`.
- Final focused frontend/account/inbox checks: 20 passed.
- Final backend/preload checks: 37 passed, including Stop while a chat turn is
  starting and an independent document scan is running. The late chat turn is
  interrupted without cancelling the document scan.
- Actual Electron + actual bundled Deep Chat: 9 behavior checks, 8 screenshots,
  1380 × 890 and 804 × 619, day/night. Authentication and AI were simulated.
  Evidence: `output/ai-chat-native/report.json`.
- A manual preview uses the real production bridge with a fictional case and a
  separate stable test profile. No inference runs at startup. Launch from the
  repository with `desktop/node_modules/electron/dist/electron.exe
  desktop/tests/preview-ai-chat.cjs`.
- Manual preview profile: `output/ai-chat-preview/profile`; case:
  `output/ai-chat-preview/Fictional AI testing case`. These are ignored and must
  never enter commits, packages or public assets.
- The preview is currently signed out. Real account sign-in, a live reply and
  restart persistence require the user to finish the browser sign-in. Do not
  describe simulated account/restart tests as live authentication verification.

Official references: [managed authentication](https://learn.chatgpt.com/docs/app-server#auth-endpoints),
[credential storage](https://learn.chatgpt.com/docs/auth#credential-storage),
[OpenAI brand guidelines](https://openai.com/brand/).

Installer delivery and publication remain separate. Preserve concurrent document
creator and update-menu changes when preparing the next combined installer.
