// Minimal YAML-frontmatter parser for the flat shape this vault uses:
// scalars, inline [a, b] arrays, optional quotes. No external deps.

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseScalar(raw) {
  const v = raw.trim();
  if (v === "") return "";
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((s) => stripQuotes(s.trim())).filter((s) => s !== "");
  }
  return stripQuotes(v);
}

export function parseFrontmatter(text) {
  text = text.replaceAll("\r\n", "\n");
  if (!text.startsWith("---")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text };
  const block = text.slice(text.indexOf("\n") + 1, end);
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  const data = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (m) data[m[1]] = parseScalar(m[2]);
  }
  return { data, body };
}
