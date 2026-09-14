import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { install } from '../case-forge.mjs';

test('installed toolkit can propose, review, export and detect drift without the repository', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'case-forge-facts-cli-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  install(folder);
  const cli = join(folder, '.case-forge/tools/facts-cli.mjs');
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, folder, ...args], { encoding: 'utf8' }));
  assert.deepEqual(run('list'), []);
  writeFileSync(join(folder, 'sms.txt'), "Here now. It's 4:37.");
  const proposal = join(folder, 'proposal.json');
  writeFileSync(proposal, JSON.stringify({ actor: 'Agent', statement: 'The SMS records arrival at 4:37 pm.', sources: [{ sourceId: 'SMS-1', path: 'sms.txt', locator: 'message 1', quote: "Here now. It's 4:37." }] }));
  assert.equal(run('propose', proposal).id, 'FACT-00001');
  const review = join(folder, 'review.json');
  writeFileSync(review, JSON.stringify({ expectedRevision: 1, reviewer: 'Human reviewer', reason: 'Checked source and context.', confirmVerified: true }));
  run('verify', 'FACT-00001', review);
  writeFileSync(join(folder, 'template.md'), '# Timeline\n\n{{fact:FACT-00001}}');
  assert.equal(run('render', 'template.md').dependencies[0].revision, 2);
  run('export', 'template.md', 'exports/timeline.md');
  assert.equal(run('check').ok, true);
  const output = join(folder, 'exports/timeline.md');
  writeFileSync(output, readFileSync(output, 'utf8').replace('4:37', '4:30'));
  const checked = spawnSync(process.execPath, [cli, folder, 'check'], { encoding: 'utf8' });
  assert.equal(checked.status, 1);
  assert.ok(JSON.parse(checked.stdout).issues.some(i => i.type === 'LOCK_DRIFT'));
});

test('root command routes facts help and rejects unexpected arguments', () => {
  const cli = fileURLToPath(new URL('../case-forge.mjs', import.meta.url));
  assert.match(execFileSync(process.execPath, [cli, 'facts', '--help'], { encoding: 'utf8' }), /verify FACT-00001/);
  assert.equal(spawnSync(process.execPath, [cli, 'facts', '.', 'list', 'extra']).status, 1);
});
