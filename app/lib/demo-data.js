import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { Inbox } from './inbox.js';
import { Journal, journalTargets } from './journal.js';
import { Tasks, taskTargets } from './tasks.js';
import { Notebook } from './notebook.js';
import { DEMO_ROLES, DEMO_CONNECTIONS, scenarioRecords } from './demo-scenario.js';
import { Calendar } from './calendar.js';
import { writeNew, caseRoot } from './files.js';

export const DEMO_PRESETS = Object.freeze([
  { id: 'small', label: 'Small', files: 10, people: 8, events: 9, tasks: 4, notes: 3, calendar: 3, evidence: 4, patterns: 2 },
  { id: 'medium', label: 'Medium', files: 50, people: 10, events: 30, tasks: 12, notes: 8, calendar: 6, evidence: 15, patterns: 4 },
  { id: 'large', label: 'Large', files: 250, people: 24, events: 120, tasks: 30, notes: 20, calendar: 12, evidence: 40, patterns: 8 },
].map(item => Object.freeze({ ...item, emailExports: item.files - 5 })));

const names = ['Alex Morgan', 'Jamie Morgan', 'Sam Taylor', 'Casey Wilson', 'Robin Ellis', 'Jordan Lee', 'Avery Quinn', 'Riley Shaw', 'Cameron Reed', 'Drew Parker', 'Harper Lane', 'Charlie West', 'Morgan Bell', 'Taylor Green', 'Rowan Fox', 'Finley Blake', 'Hayden Cole', 'Peyton Ross', 'Reese Gray', 'Bailey Stone', 'Skyler Hayes', 'Emerson Dale', 'Dakota Rivers', 'Sage Brooks'];
const subjects = ['Schedule discussion', 'School update', 'Document request', 'Meeting summary', 'Travel arrangement', 'Appointment update', 'Expense record', 'Follow-up message'];
const pad = n => String(n + 1).padStart(3, '0');
const fixture = 'Fictional sample data for exploring Case Forge. This is not a real case record.';

// This entry point only accepts an empty directory created by the desktop demo
// manager. It uses the same import and save services as real user activity.
export async function generateDemo({ root, size, id = randomUUID(), fileReferences, assertActive = () => {}, now = new Date() }) {
  const preset = DEMO_PRESETS.find(item => item.id === size);
  if (!preset) throw new Error('Choose Small, Medium or Large.');
  root = caseRoot(root);
  if (readdirSync(root).length) throw new Error('Sample data needs a new, empty demo folder.');
  const assertWritable = () => assertActive();
  const write = (path, data) => { assertActive(); writeNew(root, path, data); };
  const dayParts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => dayParts.find(item => item.type === type).value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const date = offset => new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
  const note = (path, data, title, body) => write(path, `---\n${Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n# ${title}\n\n> ${fixture}\n\n${body}\n`);
  write('CASE-DETAILS.md', `---\ntype: system\n---\n# Demo case - ${preset.label}\n\n> ${fixture}\n\nCreated ${today}. Every person, file and event in this folder is invented.\n\n| Case type | Fictional parenting example |\n`);
  const inbox = new Inbox({ providers: {}, assertWritable, fileReferences });
  const documents = [];
  const records = scenarioRecords(preset.files, date);
  const messageId = i => `<${id}.${pad(i)}@caseforge.example>`;
  const address = i => `${names[i].toLowerCase().replaceAll(' ', '.')}@caseforge.example`;
  for (let i = 0; i < preset.files; i++) {
    await yieldTurn(); assertActive();
    const record = records[i];
    const headers = `From: ${names[record.from]} <${address(record.from)}>\nTo: ${names[record.to]} <${address(record.to)}>\nDate: ${record.date} 10:00:00 +1000\nSubject: ${record.subject}\nMessage-ID: ${messageId(i)}${Number.isInteger(record.reply) ? `\nIn-Reply-To: ${messageId(record.reply)}\nReferences: ${messageId(record.reply)}` : ''}`;
    const body = record.body.replaceAll('DATE', record.date);
    const text = `${fixture}\n\n${headers}\nRecord type: ${record.kind}\n\n${body}\n\nDemo set: ${id}\n`;
    // Plain-text email exports work offline with the built-in reader.
    const result = inbox.import(root, `Sample ${pad(i)} - ${record.subject.replace(/[^a-zA-Z0-9 -]/g, '')}.txt`, Buffer.from(text));
    // Read one file at a time so every size respects the normal intake queue.
    await inbox.tail; assertActive();
    const document = inbox.record(root, result.document.id);
    if (document.status !== 'ready') throw new Error('A sample file could not be read. Try creating another demo.');
    documents.push(document);
  }
  const eligible = records.filter(record => record.event);
  const core = eligible.filter(record => record.index < 9 || record.index === records.length - 1);
  const extra = eligible.filter(record => !core.includes(record));
  const extraCount = preset.events - core.length;
  const eventRecords = [...core, ...Array.from({ length: extraCount }, (_, i) => extra[Math.floor(i * extra.length / extraCount)])].sort((a, b) => a.index - b.index);
  for (let i = 0; i < preset.people; i++) {
    const connected = (DEMO_CONNECTIONS[i] || [2, 3]).map(index => `people/person-${pad(index)}.md`);
    const role = DEMO_ROLES[i] || 'External service contact';
    note(`people/person-${pad(i)}.md`, { type: 'person', role, related: connected }, names[i], `${role}. Fictional contact: ${address(i)}.\n\nConnections: ${connected.map(ref => `[[${ref}]]`).join(', ')}\n\nRelated: [[timeline/event-${pad(i % preset.events)}.md]]`);
  }
  for (let i = 0; i < preset.events; i++) {
    const record = eventRecords[i], doc = documents[record.index];
    note(`timeline/event-${pad(i)}.md`, { type: 'event', event_id: `DEMO-${pad(i)}`, date: record.date, people: [`people/person-${pad(record.from)}.md`, `people/person-${pad(record.to)}.md`], source_file: doc.original, source_name: doc.name, source_page: '1', tags: ['Sample data', record.kind, i === 0 ? 'Case start' : i === preset.events - 1 ? 'Case end' : 'External contact'] }, record.subject, record.body);
  }
  for (let i = 0; i < preset.evidence; i++) {
    const doc = documents[i % documents.length], record = records[i % records.length];
    const eventIndex = eventRecords.findIndex(event => event.index === record.index);
    note(`evidence/item-${pad(i)}.md`, { type: 'evidence', source_file: doc.original, source_name: doc.name, source_page: '1', related: eventIndex < 0 ? [] : [`timeline/event-${pad(eventIndex)}.md`] }, `Review: ${record.subject}`, `Source summary: ${record.body}\n\nThis fictional source records what was communicated; no independent finding or legal conclusion has been made.`);
  }
  const themes = [
    ['Collection arrangements', /collection|dismissal/i],
    ['Requests and replies', /request|Re:|receipt/i],
    ['Case milestones', /Case opened|Case closed|meeting/i],
  ];
  for (let i = 0; i < preset.patterns; i++) {
    const [title, match] = themes[i % themes.length];
    const related = eventRecords.flatMap((record, index) => match.test(record.subject) ? [`timeline/event-${pad(index)}.md`] : []);
    note(`patterns/pattern-${pad(i)}.md`, { type: 'pattern', related }, `${title}${i >= themes.length ? ` ${pad(i)}` : ''}`, 'A fictional grouping of related source records for practice. It is not an AI finding or a legal conclusion.');
  }
  const notebook = new Notebook(root, { assertWritable });
  const pages = [
    ['Start here — fictional case', 'Explore the people connections, then follow the timeline from case opening to closure. Open a blue file reference to compare an event with its original email export. All content is invented.'],
    ['Collection time — compare the sources', 'The first email proposes 3:30 pm. The reply proposes 4:00 pm. The meeting record later confirms 4:00 pm. A changed proposal is not automatically a contradiction or misconduct.'],
    ['Missing receipt — questions to ask', 'One activity receipt was requested but is not present. What further document would resolve the gap? This is a private working note and does not create a timeline event.'],
    ['Try editing safely', 'Change a fictional person and add a connection. Write a notebook page and reopen it. These practice edits stay in this demo case. Use More tools > Simulate case to return to your previous case or create a fresh demo.'],
  ];
  for (let i = 0; i < preset.notes; i++) {
    const [title, body] = pages[i % pages.length];
    notebook.save({ id: randomUUID(), expectedRevision: 0, title: i < pages.length ? title : `${title} ${pad(i)}`, body: `${fixture}\n\n${body}` });
  }
  const targets = journalTargets(root, documents);
  const journal = new Journal(root, { assertWritable, getTargets: () => targets });
  for (let i = 0; i < preset.notes; i++) {
    await yieldTurn(); assertActive();
    journal.save({ expectedRevision: 0, content: { title: `Sample reflection ${pad(i)}`, happened: `${fixture} Today I sorted records and wrote a note about the arrangements.`, reflection: 'Check the linked source before drawing a conclusion.', occurredDate: date(-i), timeZone: 'Australia/Brisbane', precision: 'approximate', links: [`note:timeline/event-${pad(i % preset.events)}.md`, `document:${documents[i % documents.length].id}`] } });
  }
  const taskSources = taskTargets(root, documents, journal.list());
  const tasks = new Tasks(root, { assertWritable, getTargets: () => taskSources, now: () => now });
  for (let i = 0; i < preset.tasks; i++) {
    await yieldTurn(); assertActive();
    const done = i % 5 === 4;
    tasks.save({ id: randomUUID(), requestId: randomUUID(), expectedRevision: 0, actor: 'Demo generator', content: { title: `Sample: ${['Review source records', 'Prepare a meeting note', 'Check the schedule', 'Organise supporting files'][i % 4]} ${pad(i)}`, assignee: names[i % preset.people], details: fixture, kind: 'task', status: done ? 'done' : i % 3 ? 'todo' : 'in_progress', completionNote: done ? 'Fictional completion for demonstration.' : '', dueDate: date((i % 14) - 3), timeZone: 'Australia/Brisbane', deadlineStatus: 'proposed', dateOrigin: 'personal', deadlineBasis: 'Invented practice date; not a court deadline.' } });
  }
  const calendar = new Calendar(root, { assertWritable, now: () => now });
  for (let i = 0; i < preset.calendar; i++) calendar.save({ id: randomUUID(), expectedRevision: 0, title: `Sample: ${['Review documents', 'Planning session', 'Prepare notes'][i % 3]} ${pad(i)}`, date: date(i * 2), details: fixture });
  assertActive();
  write('.case-forge/demo.json', JSON.stringify({ version: 1, scenarioVersion: 2, scenario: 'Morgan arrangements', caseStart: records[0].date, caseEnd: records.at(-1).date, emailExports: records.filter(r => r.kind === 'email').length, notebookPages: preset.notes, id, size, createdAt: now.toISOString(), fictional: true, counts: preset }, null, 2));
  return { ...preset };
}
