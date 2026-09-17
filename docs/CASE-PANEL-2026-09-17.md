# Case panel refinement

The docked Case panel follows the file register's top, bottom, side and corner
radius. Left docking, dragging, keyboard movement and a floating window remain
available. The panel stays open while browsing; Close and Escape dismiss it.

## AI chat

- Connected accounts use a small account menu with Sign out. The full sign-in
  card is shown only while disconnected. Existing browser sign-in and pushed
  connection updates remain in place.
- The composer and assistant replies use the available panel width. User
  messages remain narrower. The composer grows for multiple lines and clears
  after submission; Enter sends and Shift+Enter adds a line.
- Send uses an upward arrow and Stop a square, with accessible names and a clear
  active state. The waiting indicator uses small animated dots and respects
  reduced-motion settings. Scrollbars follow the case theme.
- The introductory message disappears after the first submission. The redundant
  privacy footer has been removed as requested.
- Starting a new conversation blocks further sends until the provider reset
  finishes. A failed reset preserves visible history.

## Details

Details reads the same existing nodes and relationships as the full Case map.
Its compact preview shows a selected record and up to six recorded neighbours;
the list and source details retain access to the other records.

Search supports words, quoted phrases, names, dates and source references. Type
and connected-only filters narrow the list. Selection follows the full map in
both directions. While Details is open, it replaces the duplicate map-record
popup; the existing popup remains available on closing Details or opening AI
chat. Search, filters, selection and scroll persist across tab
switches and navigation, and reset when the active case changes. Search is local
text filtering; it does not send case data to AI or generate new relationships.

## Verification

The integrated candidate is based on main's 0.14.18 source, preserving the case
simulator and updater. The app suite passed 300 checks with four conditional
reader tests skipped. Focused checks cover account pushes, conversation reset,
Details search, first-click handling after search blur, state retention, source
actions and map selection synchronization.

`desktop/tests/native-ai-chat.cjs` exercises the actual Electron renderer and
bundled Deep Chat at 1380 × 890 and 804 × 619 with fictional records. It verifies
real keyboard input, streaming and Stop controls, dock alignment, connected
account layout, compact rendering and Details navigation. Authentication and
inference are simulated; this is not fresh live-account validation. Captures
and the machine-readable report are under `output/ai-chat-native` in the tested
checkout and remain excluded from source control. The final integrated native
run passed 15 behaviour checks with 15 captures, zero renderer errors and zero
external requests. Docked top, right and bottom offsets from the register were
zero pixels at both sizes; corner radii matched. The compact Details body has
162 pixels of scrollable height and shows the full miniature graph.

This change prepares and pushes application source. Installer publication and
replacement of a running installation are separate actions.
