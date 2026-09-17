import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { Inbox } from './inbox.js';
import { Journal, journalTargets } from './journal.js';
import { Tasks, taskTargets } from './tasks.js';
import { Calendar } from './calendar.js';
import { writeNew, caseRoot } from './files.js';

export const DEMO_PRESETS = Object.freeze([
  { id: 'small', label: 'Small', files: 10, people: 4, events: 8, tasks: 4, notes: 3, calendar: 3, evidence: 4, patterns: 2 },
  { id: 'medium', label: 'Medium', files: 50, people: 10, events: 30, tasks: 12, notes: 8, calendar: 6, evidence: 15, patterns: 4 },
  { id: 'large', label: 'Large', files: 250, people: 24, events: 120, tasks: 30, notes: 20, calendar: 12, evidence: 40, patterns: 8 },
].map(Object.freeze));

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
  for (let i = 0; i < preset.files; i++) {
    await yieldTurn(); assertActive();
    const subject = subjects[i % subjects.length];
    const result = inbox.import(root, `Sample ${pad(i)} - ${subject}.txt`, Buffer.from(`${fixture}\n\n${subject} ${pad(i)}\nDate: ${date(-(i % 45))}\nFrom: ${names[i % preset.people]}\nTo: ${names[(i + 1) % preset.people]}\n\nThis invented record describes a routine ${subject.toLowerCase()} in a fictional family matter. The people discussed practical arrangements and agreed to check the supporting information.\n\nDemo set: ${id}\nRecord: ${pad(i)}\n`));
    // Read one file at a time so every size respects the normal intake queue.
    await inbox.tail; assertActive();
    const document = inbox.record(root, result.document.id);
    if (document.status !== 'ready') throw new Error('A sample file could not be read. Try creating another demo.');
    documents.push(document);
  }
  for (let i = 0; i < preset.people; i++) {
    note(`people/person-${pad(i)}.md`, { type: 'person', role: i < 2 ? 'Fictional parent' : 'Fictional contact' }, names[i], `Sample contact used to explore linked records.\n\nRelated: [[timeline/event-${pad(i % preset.events)}]]`);
  }
  for (let i = 0; i < preset.events; i++) {
    const doc = documents[i % documents.length];
    note(`timeline/event-${pad(i)}.md`, { type: 'event', event_id: `DEMO-${pad(i)}`, date: date(-(i % 45)), people: [`people/person-${pad(i % preset.people)}`, `people/person-${pad((i + 1) % preset.people)}`], source_file: doc.original, source_name: doc.name, source_page: '1', tags: ['Sample data', subjects[i % subjects.length]] }, `${subjects[i % subjects.length]} ${pad(i)}`, 'An invented timeline entry, linked to its sample source file. Open the file to practise following a reference.');
  }
  for (let i = 0; i < preset.evidence; i++) {
    const doc = documents[i % documents.length];
    note(`evidence/item-${pad(i)}.md`, { type: 'evidence', source_file: doc.original, source_name: doc.name, source_page: '1', related: [`timeline/event-${pad(i % preset.events)}`] }, `Sample record for review ${pad(i)}`, 'Fictional evidence example. No finding or legal conclusion has been made.');
  }
  for (let i = 0; i < preset.patterns; i++) note(`patterns/pattern-${pad(i)}.md`, { type: 'pattern', related: [`timeline/event-${pad(i % preset.events)}`, `timeline/event-${pad((i + 1) % preset.events)}`] }, `Sample theme: ${subjects[i % subjects.length]}`, 'An invented grouping to demonstrate connected notes. It is not an AI finding.');
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
  write('.case-forge/demo.json', JSON.stringify({ version: 1, id, size, createdAt: now.toISOString(), fictional: true, counts: preset }, null, 2));
  return { ...preset };
}
