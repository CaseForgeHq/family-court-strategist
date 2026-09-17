import { randomUUID, createHash } from 'node:crypto';
import { writeNew, readLocal, safePath } from './files.js';
import { renameSync, rmSync } from 'node:fs';
import { AppError } from './errors.js';
export function addPerson(root, input, { assertWritable, model }) {
  assertWritable(root);
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120 || /[\r\n\0]/.test(input.name)) throw new AppError('Enter a name of 1–120 characters.');
  if (typeof input.role !== 'string' || input.role.length > 120 || /[\r\n\0]/.test(input.role)) throw new AppError('Enter a role up to 120 characters.');
  if (typeof input.notes !== 'string' || input.notes.length > 3000 || input.notes.includes('\0')) throw new AppError('Enter notes up to 3,000 characters.');
  const related = input.related || '';
  if (typeof related !== 'string' || related && !model.timeline.some(event => event.reference === related)) throw new AppError('Choose an event from this case.', 409);
  const connections = input.connections || [];
  if (!Array.isArray(connections) || connections.length > 100 || connections.some(ref => typeof ref !== 'string' || ref === input.reference || !model.people.some(p => p.reference === ref))) throw new AppError('Choose people from this case.');
  const reference = input.reference || `people/person-${randomUUID()}.md`;
  let original;
  if (input.reference) {
    if (!model.people.some(p => p.reference === reference)) throw new AppError('Choose a person from this case.', 409);
    original = readLocal(root, reference).toString('utf8');
    if (createHash('sha256').update(original).digest('hex') !== input.expectedRevision) throw new AppError('This person has changed. Reopen their details before saving.', 409);
  }
  const header = `---\ntype: person\nrole: ${JSON.stringify(input.role.trim())}\n${related ? `related: [${JSON.stringify(related)}]\n` : ''}---\n`;
  assertWritable(root);
  const links = [...new Set([...(related ? [related] : []), ...connections])];
  let text = `${header.replace(/related: .*\n/, '').replace('role:', `related: ${JSON.stringify(links)}\nrole:`)}# ${input.name.trim()}\n\n${input.notes.trim().replace(/^---\s*$/gm, '—')}\n`;
  if (original) {
    // Preserve unrelated frontmatter belonging to imported person notes.
    const block = original.replaceAll('\r\n', '\n').match(/^---\n([\s\S]*?)\n---/);
    const retained = block?.[1].split('\n').filter(line => !/^(type|role|related):/.test(line)).join('\n');
    if (retained) text = text.replace('---\n', `---\n${retained}\n`);
    const temporary = `people/.pending-${randomUUID()}.md`;
    try { writeNew(root, temporary, text); assertWritable(root); renameSync(safePath(root, temporary), safePath(root, reference)); }
    finally { rmSync(safePath(root, temporary), { force: true }); }
  } else writeNew(root, reference, text);
  return { reference, name: input.name.trim(), revision: createHash('sha256').update(text).digest('hex') };
}
