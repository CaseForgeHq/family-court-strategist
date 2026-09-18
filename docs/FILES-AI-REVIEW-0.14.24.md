# Files & AI review layout — 0.14.24

Expanded file cards now show the report as one continuous document. Each of the 13 canonical review points has a consistent heading and visible review, with limitations, follow-up and linked evidence retained. The checklist is a compact navigation list; it focuses the corresponding heading without initiating a scan. Repeated question/status labels and nested disclosures were removed. Review notes and scan errors are readable inline. Earlier saved report history remains available.

The file heading scrolls with the content, eliminating overlap. The scrolling viewport clips to rounded corners and uses a 9px custom rounded thumb with no arrow buttons; inherited scrollbar colour is reset so Chromium applies this style. Card glass, 15px/500 header text and right-edge alignment are preserved.

Validation: 438 automated tests passed, 4 conditional reader tests skipped. Native report checks exercise 13 visible sections, navigation focus, original source modal, compact/full layouts, computed glass/typography/right alignment and a static heading while scrolled. Simulated AI and disposable fictional profiles only; no user cases or account inference used.

Ten native report captures and native updater UI passed. Three isolated installed-copy restart rehearsals reached readiness in 3317, 4522 and 1478 ms. Installer size 196533685 bytes; SHA256 108222020ecd8cc5e52a182ca033a9f97a8bced17edd79fc66c950d1a3923545. Authenticode NotSigned. Initial installer build ran out of disk space; only this task's prior temporary build/test artifacts were removed before a successful rebuild. Customer installation not performed.
