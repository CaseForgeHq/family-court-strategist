# Simulate a case

Open **More tools → Simulate case**, choose Small, Medium or Large, then **Create & open demo**. Each click creates a new fictional case. Reopen it from Saved demos or use Back to return to the previous case. Existing demos are preserved; create a new one for the connected Morgan scenario introduced in 0.14.18.

| Size | Source files | Email exports | People | Events | Notebook pages |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small | 10 | 5 | 8 | 9 | 3 |
| Medium | 50 | 45 | 10 | 30 | 8 |
| Large | 250 | 245 | 24 | 120 | 20 |

The fictional Morgan arrangements case includes case opening and closure, two parents, legal representatives, school and service contacts, a proposed collection time, replies, school confirmation, mediation and a missing activity receipt. Larger cases add external follow-up correspondence. People have explicit saved connections; the map has source-linked events and themes.

Emails are readable plain-text exports with From, To, Date, Subject, Message-ID and reply references. They are invented local records, not sent messages or a connected mailbox. Addresses use the reserved `.example` domain. Built-in text reading keeps generation offline without requiring an email conversion runtime.

Notebook pages explain how to compare sources and practise editing. Private notes, journal reflections and the expense worksheet do not become external-contact timeline events. A changed proposal and a missing document are practice questions, not findings of wrongdoing. No AI review is fabricated or automatically requested.

Generation uses the real file importer, permanent file-reference registry, notebook, journal, task and calendar services. Every dataset lives in a new UUID directory under the desktop profile's Demo cases folder. It never merges into or clears an existing case. The normal unsaved-work guard still governs case switching.

Tests: `app/tests/demo-scenario.test.js` checks all three sizes, people connections, resolved graph links, source dates, reply references, private-note separation and existing-folder protection. `desktop/tests/native-demo-scenario.cjs` creates a demo through the real desktop controls, visits its people/timeline/notebook, checks compact layout and returns to the original fictional case.
