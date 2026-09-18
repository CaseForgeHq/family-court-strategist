# Case map readability, 0.14.27

The map now expands full labels on hover, selection and keyboard focus, identifies record types with coloured borders/icons, and emphasizes direct recorded links with thicker brighter geometry while fading unrelated records. Double-clicking a label focuses its node. Existing orbit, fly, zoom, reset, List and record routes remain. The compact header uses four rows.

Integrated on 0.14.26 without replacing newer Files & AI or saved-session behavior. 435 app/desktop tests passed, 4 skipped. Native header measurements passed at 1304/1000/804px; renderer assertions passed at 1304/804px for full labels, six direct connections, hover, keyboard focus/orbit, zoom/focus/reset and disposal. Current screenshot capture hit UnknownVizError; final renderer assertions used software WebGL without captures. Earlier unchanged map visuals were inspected in the root output/map-readability. Native registration updater states/keyboard/layout passed. All checks used fictional data; no live AI or customer profile.

This is an optional release. Installer signing and final packaged restart/public checks are recorded in the project handoff. Line emphasis identifies recorded relationships, not evidentiary strength.

Final resource-switch checks reached usable entry UI in2094/2079/1235ms; all under5seconds. Initial full-copy rehearsal failed for disk space. Successful rehearsal used hard links for unchanged fixture files and separate writable app archive/manifest, followed by actual verified installer extraction and resource replacement. The temporary install was removed after preserving the report. Authenticode remains NotSigned.

