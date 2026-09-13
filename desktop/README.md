# Case Forge — desktop development preview

Electron hosts the local case workspace and adds a native case-folder picker.
Original documents and case notes stay on the computer. Cloud analysis sends only
the extracted document text selected and confirmed by the user.

## Run

Use Node.js 22.13+ for installing dependencies and running the web tests.

```bash
cd app
npm ci
cd ../desktop
npm ci
npm start
```

The first development launch copies the fictional sample case into `preview-case`
inside Electron's user-data directory. It never writes to the bundled sample.
Use **Current matter** or **File → Open Case Folder…** to choose your own case.
The last selected folder is remembered.

To opt into the existing Claude Code sign-in bridge during development on macOS
or Linux:

```bash
STRATEGIST_CLAUDE_CODE_PREVIEW=1 npm start
```

Claude Code must be installed and signed in separately. This is not a public
subscription login. See [the app README](../app/README.md) for connection limits,
provider approval requirements, privacy, storage and testing instructions.

## Build status

```bash
npm run dist
```

Installer targets are configured for macOS, Windows and Linux. Install the app's
production dependencies on each target build platform first: PDF.js includes an
optional native canvas package. The packaging filter includes PDF.js and canvas,
and excludes DOM test dependencies. Revisit it when adding runtime dependencies.

**Packaged builds remain read-only** until a verified subscription entitlement
service is implemented. Development flags cannot enable the subscription bridge
in a packaged build. Stripe, account activation, signed licences, signing,
notarisation and automatic updates are not delivered by this preview.

The same local server powers the browser and desktop versions. Context isolation
is enabled, Node integration is disabled, and navigation away from the app origin
is blocked. The app cancels its jobs on quit; interrupted work can be retried.
