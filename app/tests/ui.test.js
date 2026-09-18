import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createInbox, reportMarkup, scanLabel } from '../public/inbox.js';
import { fileRegister } from '../public/file-register.js';

async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('The interface did not reach its expected state'); }
const record = (id = 'doc-1', scan = null) => ({ id, reference: `CF-FICTIONAL-${id}`, name: `${id}.txt`, extension: '.txt', bytes: 123, createdAt: '2026-09-17', status: 'ready', pages: [{ page: 1, text: 'Fictional source passage', anchor: { kind: 'paragraph', paragraph: 1 } }], scan });
const report = { id: 'report-1', summary: 'A fictional letter about an appointment.', context: { documentType: 'Letter' }, jurisdiction: { country: 'AU', regions: ['QLD'] }, findings: [{ id: 'fact-1', kind: 'fact', title: 'Appointment stated', detail: 'The author states an appointment.', strength: 'limited', limitations: 'Not independently verified.', sources: [{ page: 1, quote: 'Fictional source passage', speaker: 'Fictional author', recipient: 'Fictional recipient', sequence: '1', anchor: { kind: 'paragraph', paragraph: 1 }, sourceMatch: 'text_match' }] }], laws: [], coverage: { complete: true } };
function setup(t, options = {}) {
  const dom = new JSDOM('<main id="host"></main><div id="modal"></div>', { url: 'http://127.0.0.1:4322' });
  const previous = globalThis.document; globalThis.document = dom.window.document;
  const document = dom.window.document, calls = [], opened = [], docs = options.docs || [record()];
  let session = { caseKey: 'fictional', access: { canWrite: options.writable !== false } };
  const inbox = createInbox({ getSession: () => session, updateSession: value => { session = value; }, desktop: () => options.desktop,
    showModal: html => { document.querySelector('#modal').innerHTML = html; }, onOpenScan: id => { opened.push(id); },
    api: async (path, request = {}) => {
      calls.push({ path, request });
      const intercepted = options.api?.(path, request); if (intercepted !== undefined) return intercepted;
      if (path === '/api/documents') return { documents: docs, access: session.access };
      if (path === '/api/scan-settings') return { country: 'AU', regions: ['Commonwealth', 'QLD'], confirmed: true };
      if (path === '/api/readers') return { ready: true, message: 'Readers ready.' };
      if (path.includes('/source?')) return { name: 'Fictional source', text: 'Fictional source passage', anchor: { kind: 'paragraph', paragraph: 1 } };
      if (request.method === 'POST') return {};
      return { ...docs.find(d => path.endsWith(d.id)), reports: [report] };
    } });
  t.after(() => { inbox.unmount(); dom.window.close(); globalThis.document = previous; });
  return { dom, document, inbox, calls, opened, docs, host: document.querySelector('#host'), switchCase: caseKey => { session = { ...session, caseKey }; } };
}

test('Case desk AI column is between name and type with honest completed and busy states', () => {
  const dom = new JSDOM(fileRegister([record('new'), record('done', { state: 'completed' }), record('busy', { state: 'running' })]));
  assert.deepEqual([...dom.window.document.querySelectorAll('th')].map(node => node.textContent), ['File number', 'File name', 'AI', 'Type', 'Size', 'Status', 'Added']);
  const buttons = [...dom.window.document.querySelectorAll('[data-scan-document]')];
  assert.equal(buttons[0].textContent, 'Scan'); assert.equal(buttons[1].textContent, 'Scanned'); assert.equal(buttons[2].disabled, true);
  dom.window.close();
});

test('Case desk imports every selected file locally without creating a scan', async t => {
  const f = setup(t, { docs: [] }); f.inbox.mountDesk(f.host);
  await until(() => f.document.querySelector('.desk-empty'));
  const files = Array.from({ length: 23 }, (_, i) => new f.dom.window.File(['fictional'], `file-${i}.docx`));
  await f.inbox.upload(files);
  const posts = f.calls.filter(call => call.request.method === 'POST');
  assert.equal(posts.length, 23); assert.ok(posts.every(call => call.path.startsWith('/api/documents?name=') && call.request.raw));
  assert.equal(posts.some(call => /\/(scan|analyse|approve)$/.test(call.path)), false);
  assert.match(f.document.querySelector('#inbox-message').textContent, /Select Scan when ready/);
});

test('repeated Scan clicks submit exactly once and completed results open their card', async t => {
  let release;
  const f = setup(t, { docs: [record(), record('done', { state: 'completed' })], api: (path, request) => path.endsWith('/scan') ? new Promise(resolve => { release = resolve; }) : undefined });
  f.inbox.mountDesk(f.host); await until(() => f.document.querySelector('[data-scan-document]'));
  const button = f.document.querySelector('[data-scan-document="doc-1"]'); button.click(); button.click();
  assert.equal(f.calls.filter(call => call.path.endsWith('/scan')).length, 1);
  assert.equal(f.document.querySelector('[data-scan-document="doc-1"]').disabled, true);
  release({}); await until(() => !f.document.querySelector('[data-scan-document="doc-1"]').disabled);
  f.document.querySelector('[data-scan-document="done"]').click();
  assert.deepEqual(f.opened, ['done']);
});

test('Files & AI shows submitted cards, queue positions and no file intake or promotion controls', async t => {
  const f = setup(t, { docs: [record('unscanned'), record('queued', { state: 'queued', queuePosition: 2 }), record('running', { state: 'running', elapsedMs: 61000, stage: 'context' }), record('paused', { state: 'paused' })] });
  f.inbox.mount(f.host); await until(() => f.document.querySelectorAll('.scan-card').length === 3);
  assert.equal(f.document.querySelector('input[type=file]'), null);
  assert.equal(f.document.querySelector('[data-action=approve]'), null);
  assert.equal(f.document.querySelector('[data-action=analyse]'), null);
  assert.match(f.host.textContent, /position 2 in queue/); assert.match(f.host.textContent, /1m 1s · context/);
  assert.ok(f.document.querySelector('[data-scan-action=resume]'));
  f.document.querySelector('[data-scan-action=resume]').click();
  await until(() => f.calls.some(call => call.path.endsWith('/resume')));
  assert.deepEqual(f.calls.find(call => call.path.endsWith('/resume')).request.body.jurisdiction.regions, ['Commonwealth', 'QLD']);
});

test('attention reports allow a fresh retry while retaining their saved findings', async t => {
  const f = setup(t, { docs: [{ ...record('attention', { state: 'attention' }), latestReportId: 'report-1' }] });
  f.inbox.mount(f.host); await until(() => f.document.querySelector('.scan-card')); await f.inbox.open('attention');
  await until(() => f.document.querySelector('.scan-report'));
  assert.equal(f.document.querySelector('[data-scan-action=resume]').textContent, 'Resume with saved jurisdiction');
  f.document.querySelector('[data-scan-action=retry]').click();
  await until(() => f.calls.some(call => call.path.endsWith('/retry')));
  assert.equal(f.calls.find(call => call.path.endsWith('/retry')).request.method, 'POST');
  assert.equal(f.document.querySelector('.scan-summary-text').textContent, report.summary);
});

test('summary precedes 13 expandable checks and citations preserve attribution and report version', async t => {
  const f = setup(t, { docs: [{ ...record('done', { state: 'completed', completedAt: '2026-09-17T02:00:00Z' }), latestReportId: 'report-1' }] });
  f.inbox.mount(f.host); await until(() => f.document.querySelector('.scan-card')); await f.inbox.open('done');
  await until(() => f.document.querySelector('.scan-report'));
  assert.equal(f.document.querySelectorAll('.scan-report > .scan-section').length, 13);
  assert.match(f.document.querySelector('.scan-report > h3').textContent, /Document summary/);
  assert.match(f.document.querySelector('.scan-attribution').textContent, /Speaker: Fictional author.*Recipient: Fictional recipient.*Sequence: 1/);
  f.document.querySelector('[data-source-document]').click();
  await until(() => f.document.querySelector('#modal .source-modal'));
  assert.equal(f.document.querySelector('#modal .source-modal').textContent, 'Fictional source passage');
  assert.ok(f.calls.some(call => call.path.includes('reportId=report-1') && call.path.includes('sourceMatch=text_match')));
  assert.match(f.document.querySelector('#modal').textContent, /Paragraph 1/);
});

test('polling preserves card, nested section, source keyboard focus and scroll position', async t => {
  const d = { ...record('done', { state: 'completed' }), latestReportId: 'report-1' };
  const f = setup(t, { docs: [d] }); f.inbox.mount(f.host); await until(() => f.document.querySelector('.scan-card')); await f.inbox.open('done');
  await until(() => f.document.querySelector('[data-source-document]'));
  const card = f.document.querySelector('.scan-card'), section = f.document.querySelector('[data-section=facts]'), source = f.document.querySelector('[data-source-document]');
  section.open = true; source.focus(); f.document.querySelector('#scan-card-list').scrollTop = 155;
  d.updatedAt = '2026-09-17T03:00:00Z'; await f.inbox.refresh(true);
  assert.equal(f.document.querySelector('.scan-card'), card); assert.equal(card.open, true); assert.equal(section.open, true);
  assert.equal(f.document.activeElement, source); assert.equal(f.document.querySelector('#scan-card-list').scrollTop, 155);
  card.open = false; await f.inbox.refresh(); assert.equal(card.open, false, 'Opening from Case desk does not force it open forever');
});

test('explicit Scanned navigation reveals a later card after its report loads without moving later polling', async t => {
  let release;
  const done = { ...record('done', { state: 'completed' }), latestReportId: 'report-1' };
  const f = setup(t, { docs: [...Array.from({ length: 6 }, (_, i) => record(`queued-${i}`, { state: 'queued', queuePosition: i + 1 })), done], api: path => path === '/api/documents/done' ? new Promise(resolve => { release = resolve; }) : undefined });
  f.inbox.mount(f.host); await until(() => f.document.querySelectorAll('.scan-card').length === 7);
  const list = f.document.querySelector('#scan-card-list'), card = list.lastElementChild;
  list.getBoundingClientRect = () => ({ top: 100 });
  card.getBoundingClientRect = () => ({ top: 900 - list.scrollTop });
  const initialFocus = f.document.querySelector('[data-file-action=connect]'); initialFocus.focus();
  const opening = f.inbox.open('done'); await until(() => release);
  assert.equal(list.scrollTop, 0); assert.equal(f.document.activeElement, initialFocus);
  release({ ...done, reports: [report] }); await opening;
  await until(() => f.document.activeElement === card.querySelector('.scan-card-heading'));
  assert.equal(card.open, true); assert.ok(card.querySelector('.scan-report')); assert.equal(list.scrollTop, 800);
  list.scrollTop = 425; initialFocus.focus(); await f.inbox.refresh();
  assert.equal(list.scrollTop, 425); assert.equal(f.document.activeElement, initialFocus);
});

test('delayed text and image source responses cannot open a modal after changing cases', async t => {
  for (const sourceMatch of ['text_match', 'visual_observation']) {
    await t.test(sourceMatch, async t => {
      let release;
      const localReport = { ...report, findings: [{ ...report.findings[0], sources: [{ ...report.findings[0].sources[0], sourceMatch }] }] };
      const d = { ...record('done', { state: 'completed' }), latestReportId: 'report-1' };
      const f = setup(t, { docs: [d], api: path => /\/(source|image)\?/.test(path) ? new Promise(resolve => { release = resolve; }) : path === '/api/documents/done' ? { ...d, reports: [localReport] } : undefined });
      f.inbox.mount(f.host); await until(() => f.document.querySelector('.scan-card')); await f.inbox.open('done');
      await until(() => f.document.querySelector('[data-source-document]'));
      f.document.querySelector('[data-source-document]').click(); await until(() => release);
      f.switchCase('other-fictional-case');
      f.document.querySelector('#modal').textContent = 'Current case modal';
      release(sourceMatch === 'visual_observation' ? new Blob(['fictional image']) : { name: 'Previous case source', text: 'Previous case text' });
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(f.document.querySelector('#modal').textContent, 'Current case modal');
      assert.equal(f.document.querySelector('#inbox-message').textContent, '');
    });
  }
});

test('delayed original previews and old source buttons do not cross case boundaries', async t => {
  let release;
  const f = setup(t, { api: path => path.endsWith('/original') ? new Promise(resolve => { release = resolve; }) : undefined });
  await f.inbox.openDocument('doc-1');
  f.document.querySelector('#scan-open-original').click(); await until(() => release);
  f.switchCase('other-fictional-case'); f.document.querySelector('#modal').textContent = 'Current case modal';
  release(new Blob(['previous case original'])); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.document.querySelector('#modal').textContent, 'Current case modal');
  await f.inbox.openDocument('doc-1');
  const oldButton = f.document.querySelector('#scan-open-original'), requests = f.calls.length;
  f.switchCase('third-fictional-case'); oldButton.click();
  assert.equal(f.calls.length, requests, 'An old modal cannot fetch a document from the newly selected case');
});

test('opening a source original stops between detail and binary requests if the case changes', async t => {
  let release, delayDetail = false;
  const d = { ...record('done', { state: 'completed' }), latestReportId: 'report-1' };
  const f = setup(t, { docs: [d], api: path => delayDetail && path === '/api/documents/done' ? new Promise(resolve => { release = resolve; }) : undefined });
  f.inbox.mount(f.host); await until(() => f.document.querySelector('.scan-card')); await f.inbox.open('done');
  await until(() => f.document.querySelector('[data-source-document]'));
  f.document.querySelector('[data-source-document]').click(); await until(() => f.document.querySelector('#scan-source-original'));
  delayDetail = true; f.document.querySelector('#scan-source-original').click(); await until(() => release);
  f.switchCase('other-fictional-case'); release(d); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.calls.some(call => call.path.endsWith('/original')), false);
});

test('unscanned file opens its source inspector without submitting AI', async t => {
  const f = setup(t); await f.inbox.openDocument('doc-1');
  assert.match(f.document.querySelector('#modal').textContent, /Not scanned/);
  assert.match(f.document.querySelector('#modal').textContent, /Fictional source passage/);
  assert.equal(f.calls.some(call => call.request.method === 'POST'), false);
});

test('read-only desk blocks imports and scans while completed reports remain accessible', async t => {
  const f = setup(t, { writable: false, docs: [record(), record('done', { state: 'completed' })] }); f.inbox.mountDesk(f.host);
  await until(() => f.document.querySelector('[data-scan-document]'));
  assert.equal(f.document.querySelector('#document-picker').disabled, true);
  assert.equal(f.document.querySelector('[data-scan-document="doc-1"]').disabled, true);
  assert.equal(f.document.querySelector('[data-scan-document="done"]').disabled, false);
  await f.inbox.upload([new f.dom.window.File(['fictional'], 'file.txt')]); assert.equal(f.calls.some(call => call.request.method === 'POST'), false);
});

test('Files & AI has only description/account and file cards, with no settings or counters', async t => {
  const f=setup(t);f.inbox.mount(f.host);await until(()=>f.calls.some(c=>c.path==='/api/scan-settings'));
  assert.equal(f.document.querySelector('.scan-settings,.files-ai-toolbar,.files-ai-footer,#scan-capacity,#scan-regions'),null);
  assert.ok(f.document.querySelector('.files-ai-intro [data-file-action="connect"]'));
  assert.equal(f.calls.some(c=>c.request.method==='POST'),false);
});

test('report text is escaped, law links are HTTPS only and legacy reports remain labelled', () => {
  const dom = new JSDOM(reportMarkup({ ...report, summary: '<script>bad()</script>', legacy: true, laws: [{ title: '<img>', url: 'javascript:bad()', text: '<script>' }] }, 'fictional'));
  assert.equal(dom.window.document.querySelector('script,img'), null);
  assert.equal(dom.window.document.querySelector('a[href]'), null);
  assert.match(dom.window.document.body.textContent, /Legacy analysis/);
  assert.match(scanLabel({ state: 'sign_in_required' }), /Sign in/);
  dom.window.close();
});

test('Case desk row and keyboard button open native originals while Scan stays separate', async t => {
  const f = setup(t); f.inbox.mountDesk(f.host);
  await until(() => f.document.querySelector('.register-name'));
  f.document.querySelector('.register-name').click();
  await until(() => f.calls.some(c => c.path.endsWith('/open-native')));
  f.document.querySelector('button[data-native-document]').click();
  await until(() => f.calls.filter(c => c.path.endsWith('/open-native')).length === 2);
  f.document.querySelector('[data-scan-document]').click();
  await until(() => f.calls.some(c => c.path.endsWith('/scan')));
  assert.equal(f.calls.filter(c => c.path.endsWith('/open-native')).length, 2);
  assert.equal(f.document.querySelector('#modal').textContent, '');
});

test('native open failure is displayed in the file register', async t => {
  const f = setup(t, { api: path => path.endsWith('/open-native') ? Promise.reject(new Error('No default app installed.')) : undefined });
  f.inbox.mountDesk(f.host); await until(() => f.document.querySelector('.register-name'));
  f.document.querySelector('.register-name').click();
  await until(() => /No default app/.test(f.document.querySelector('#inbox-message').textContent));
});

test('review navigation focuses the matching visible review without scanning', async t => {
  const f=setup(t,{docs:[{...record('done',{state:'completed'}),latestReportId:'report-1'}]});
  f.inbox.mount(f.host); await f.inbox.open('done');
  await until(()=>f.document.querySelector('.scan-plan-item'));
  assert.equal(f.document.querySelectorAll('.scan-plan-item').length,13);
  f.document.querySelector('[data-question-target="contradictions"]').click();
  assert.equal(f.document.querySelectorAll('.scan-report details').length,0);
  assert.equal(f.document.activeElement,f.document.querySelector('[data-section="contradictions"] > h3'));
  assert.match(f.document.querySelector('[data-question-id="contradictions"]').textContent,/Answer not recorded/);
  assert.equal(f.calls.some(c=>c.request.method==='POST'),false);
  await f.inbox.refresh(true);
  assert.equal(f.document.querySelectorAll('.scan-report > .scan-section').length,13);
});
