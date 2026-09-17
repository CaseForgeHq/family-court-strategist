# Scan and Files & AI layout release

Version 0.14.20 is an optional update based on published 0.14.19.

- AI column heading and Scan buttons are centred with consistent row spacing.
- Files & AI retains each document card and removes the outer workbench card and horizontal list inset.
- Existing scan actions, reports, jurisdiction controls and internal scrolling are retained.

Validation: 425 tests passed, 4 skipped; seven native Files & AI captures and native registration update/keyboard/state checks passed with fictional profiles and simulated AI/updater events. Original alignment measurements cover 1304, 1100 and 804px widths. Packaged source verification passed through the checkout-bound release MCP. Installer signing remains NotSigned. Real resource-switch verification uses disposable installations; machine-specific timing and public verification are recorded in project-local release notes after completion. No customer installation is part of this task.

Final packaged resource-switch results: all three reached usable entry UI in 6600, 3992 and 2272ms. The under-five-seconds timing assertion failed on the first run; this is a reported performance target miss, not a failed installation. No update-engine code changed in this release.

