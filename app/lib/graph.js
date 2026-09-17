import { basename, relative, posix } from 'node:path';

// Relationships are recorded references, never conclusions about the case.
export function buildGraph(notes, root) {
  const list = (value) => Array.isArray(value) ? value : value ? [value] : [];
  const idFor = (note) => relative(root, note.file).replaceAll('\\', '/');
  const selected = notes.filter((note) => !idFor(note).split('/').some((part) => part.startsWith('_')) && note.data.type !== 'system');
  const nodes = selected.map((note) => ({
    id: idFor(note), label: note.title, reference: idFor(note),
    type: note.data.type === 'person' ? 'person' : note.data.type === 'pattern' ? 'pattern' : note.data.type === 'evidence' ? 'evidence' : note.data.event_id && note.data.date ? 'event' : note.data.type === 'legal' ? 'document' : 'note',
    date: note.data.date || '', role: note.data.role || '',
    source: note.data.source_name || note.data.source_file || '',
    sources: note.data.source_file ? [{ file: note.data.source_file, name: note.data.source_name || note.data.source_file, page: note.data.source_page || '' }] : [],
  }));
  const index = new Map();
  const alias = (key, id) => { const normal = String(key).toLowerCase(); if (!index.has(normal)) index.set(normal, new Set()); index.get(normal).add(id); };
  selected.forEach((note) => { const id = idFor(note); for (const name of [id, id.replace(/\.md$/i, ''), basename(id, '.md'), note.title, note.data.event_id, ...list(note.data.aliases)]) if (name) alias(name, id); });
  const edges = [], unresolvedLinks = [], edgeKeys = new Set(), ids = new Set(nodes.map((n) => n.id));
  function edge(source, target, label) { const key = `${source}\0${target}\0${label}`; if (source !== target && !edgeKeys.has(key)) { edgeKeys.add(key); edges.push({ source, target, label }); } }
  function reference(note, value, label) {
    const source = idFor(note), raw = String(value).replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
    if (!raw) return;
    const local = posix.normalize(posix.join(posix.dirname(source), raw));
    const exact = [local, `${local}.md`, raw, `${raw}.md`].find((id) => ids.has(id));
    const targets = exact ? new Set([exact]) : index.get(raw.toLowerCase());
    if (targets?.size === 1) edge(source, [...targets][0], label);
    else unresolvedLinks.push({ source, reference: raw, reason: targets?.size > 1 ? 'Ambiguous reference' : 'Referenced note is not available' });
  }
  for (const note of selected) {
    const id = idFor(note);
    // Ignore examples in fenced code. Wiki links retain their original meaning.
    const body = note.body.replace(/```[\s\S]*?```/g, '');
    for (const match of body.matchAll(/\[\[([^\]\n]+)\]\]/g)) reference(note, match[1], 'Linked in note');
    for (const person of list(note.data.people)) reference(note, person, 'Person named in note');
    for (const ref of [...list(note.data.related), ...list(note.data.related_events)]) reference(note, ref, 'Recorded reference');
    for (const tag of [...list(note.data.issue), ...list(note.data.tags)]) {
      if (typeof tag !== 'string' || !tag.trim()) continue;
      const value = tag.trim(), tagId = `topic:${value.toLowerCase()}`;
      if (!ids.has(tagId)) { nodes.push({ id: tagId, label: value, type: 'tag', reference: 'Topic recorded in note metadata' }); ids.add(tagId); }
      edge(id, tagId, 'Labelled topic');
    }
    const source = note.data.source_file;
    if (typeof source === 'string' && source && !source.includes('..') && !/^(?:[a-z]+:|\/|\\)/i.test(source)) {
      const documentId = `source:${source}`;
      if (!ids.has(documentId)) { nodes.push({ id: documentId, label: note.data.source_name || basename(source), type: 'document', reference: source, source: source }); ids.add(documentId); }
      else if (note.data.source_name) { const existing = nodes.find(n => n.id === documentId); if(existing) existing.label = note.data.source_name; }
      edge(id, documentId, `Cites source${note.data.source_page ? ` · page ${note.data.source_page}` : ''}`);
    }
  }
  return { nodes, edges, unresolvedLinks };
}
