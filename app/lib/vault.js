import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) continue; // skip .obsidian, .git
    const full = join(dir, entry);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...walk(full));
    else if (st.isFile() && entry.endsWith(".md")) out.push(full);
  }
  return out;
}

function firstHeading(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : "";
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === "") return [];
  return [v];
}

export function buildCaseModel(vaultDir) {
  const files = walk(vaultDir);
  const notes = files.flatMap((f) => {
    try {
      const { data, body } = parseFrontmatter(readFileSync(f, "utf8"));
      return [{ file: f, data, body, title: firstHeading(body) || basename(f, ".md") }];
    } catch {
      return [];
    }
  });

  const timeline = notes
    .filter((n) => n.data.date && n.data.event_id)
    .map((n) => ({
      date: String(n.data.date),
      title: n.title,
      type: n.data.type || "event",
      eventId: n.data.event_id,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const people = notes
    .filter((n) => n.data.type === "person")
    .map((n) => ({ name: n.title, role: n.data.role || "", eventId: n.data.event_id || "" }));

  const patterns = notes
    .filter((n) => n.data.type === "pattern")
    .map((n) => ({ name: n.title, instances: 0, summary: "" }));

  const hasIssue = (n, key) => asArray(n.data.issue).includes(key);

  const stats = {
    documentsAnalysed: notes.filter((n) => n.data.type === "legal").length,
    openContradictions: notes.filter((n) => hasIssue(n, "contradiction")).length,
    patternsTracked: patterns.length,
    timelineEvents: timeline.length,
  };

  const caseName = basename(vaultDir);
  let court = "";
  const details = notes.find((n) => /CASE-DETAILS/i.test(n.file));
  if (details) {
    const cm = details.body.match(/\|\s*Court\s*\|\s*([^|]+?)\s*\|/i);
    if (cm) court = cm[1].trim();
  }

  return {
    caseName,
    court,
    stats,
    timeline,
    evidence: notes.filter((n) => n.data.type === "evidence").map((n) => ({
      claim: n.title,
      source: `${n.data.source_name || n.data.source_file || "Source not recorded"}${n.data.source_page ? ` · page ${n.data.source_page}` : ""}`,
      status: "UNRESOLVED",
      strength: null,
    })),
    people,
    patterns,
    empty: timeline.length === 0 && people.length === 0 && stats.documentsAnalysed === 0,
  };
}
