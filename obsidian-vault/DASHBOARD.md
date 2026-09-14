---
type: system
---

# Dashboard

> Live queries across your entire vault. Requires the **Dataview** plugin enabled in Obsidian.

---

## Master Timeline (All Events)
```dataview
TABLE date AS "Date", type AS "Type", event_id AS "Event ID", people AS "People"
FROM ""
WHERE date != null AND event_id != null
SORT date ASC
```

## Contact Events
```dataview
TABLE date AS "Date", event_id AS "ID", people AS "People"
FROM ""
WHERE contains(issue, "contact") OR contains(issue, "visitation")
SORT date ASC
```

## Relationship Interference Indicators
```dataview
TABLE date AS "Date", event_id AS "ID", file.name AS "Source"
FROM ""
WHERE contains(issue, "alienation") OR contains(issue, "programming") OR contains(issue, "interference")
SORT date ASC
```

## System Failures
```dataview
TABLE date AS "Date", event_id AS "ID", file.name AS "Source"
FROM ""
WHERE contains(issue, "system-failure") OR contains(issue, "process-failure")
SORT date ASC
```

## Legal Representation Tracking
```dataview
TABLE date AS "Date", event_id AS "ID", file.name AS "Source"
FROM ""
WHERE contains(issue, "legal-representation") OR contains(issue, "solicitor")
SORT date ASC
```

## Communications Log
```dataview
TABLE date AS "Date", type AS "Type", people AS "People", event_id AS "ID"
FROM "communications"
SORT date ASC
```

## Missing Evidence / Follow-Up Required
```dataview
TABLE date AS "Date", event_id AS "ID", file.name AS "Source"
FROM ""
WHERE contains(issue, "missing-evidence") OR contains(issue, "follow-up")
SORT date ASC
```

## People Index
```dataview
TABLE role AS "Role", file.name AS "Name"
FROM "people"
SORT role ASC
```

## Costs Tracker
```dataview
TABLE date AS "Date", amount AS "Amount", description AS "Description"
FROM ""
WHERE type = "cost"
SORT date ASC
```

---

> **Tip:** If queries show no results, make sure your documents have YAML frontmatter with the right fields. See [[_system/analysis-framework]] for the standard fields.
