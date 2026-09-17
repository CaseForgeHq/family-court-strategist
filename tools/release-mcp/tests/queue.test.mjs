import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReleaseQueue } from '../../../scripts/release-queue.mjs';
const mainCommit = 'a'.repeat(40);
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'caseforge-queue-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, queue: createReleaseQueue({ directory }), request: n => ({ root: join(directory, `agent-${n}`), requestId: `request-${n}`, message: `Message ${n}`, required: false, sourceCommit: mainCommit }) };
}
test('independent agents submit concurrently, retain every message, and publish FIFO cumulative versions', async t => {
  const { directory, queue, request } = await fixture(t);
  const submitted = await Promise.all([1,2,3].map(n => queue.enqueue(request(n))));
  const { entries } = await queue.status(request(1).root);
  assert.equal(entries.length, 3); assert.equal(new Set(entries.map(e => e.id)).size, 3);
  const [first, second] = entries;
  const waiting = await queue.claim({ root: second.checkout, id: second.id, latestVersion: '0.14.18', mainCommit });
  assert.equal(waiting.state, 'waiting'); assert.equal(waiting.position, 2);
  await assert.rejects(queue.assertTurn(second.checkout), /claim/);
  const active = await queue.claim({ root: first.checkout, id: first.id, latestVersion: '0.14.18', mainCommit });
  assert.equal(active.version, '0.14.19');
  await assert.rejects(queue.assertTurn(first.checkout, { version: '0.14.20' }), /reserved/);
  await assert.rejects(queue.assertTurn(first.checkout, { message: 'overwritten' }), /differs/);
  await assert.rejects(queue.cancel(second.checkout, first.id), /belonging/);
  await queue.publishing(first.checkout, first.id);
  await assert.rejects(queue.cancel(first.checkout, first.id), /Cannot cancel/);
  await queue.failed(first.checkout, first.id, 'network');
  assert.equal((await queue.claim({ root: second.checkout, id: second.id, latestVersion: '0.14.18', mainCommit })).state, 'waiting');
  await queue.publishing(first.checkout, first.id); await queue.complete(first.checkout, first.id, 'https://example.test/release');
  assert.equal((await queue.assertCandidate(first.checkout, { version:active.version,message:first.message,required:false })).state,'published');
  await assert.rejects(queue.assertCandidate(second.checkout,{version:active.version,message:first.message,required:false}),/claim/);
  const reopened = createReleaseQueue({ directory });
  const next = await reopened.claim({ root: second.checkout, id: second.id, latestVersion: '0.14.19', mainCommit });
  assert.equal(next.version, '0.14.20');
  assert.deepEqual((await reopened.status(first.checkout)).entries.map(e => e.message), entries.map(e => e.message));
  assert.equal(submitted.length, 3);
});
test('retry IDs are idempotent and cancelled reservations cannot be reused', async t => {
  const { queue, request } = await fixture(t), one = request(1);
  const [a,b] = await Promise.all([queue.enqueue(one), queue.enqueue(one)]);
  assert.equal(a.id,b.id);
  await assert.rejects(queue.enqueue({ ...one, message: 'different' }), /different release/);
  await assert.rejects(queue.enqueue({ ...one, requestId: 'second' }), /pending release/);
  await queue.claim({ root: one.root, id: a.id, latestVersion: '0.14.18', mainCommit });
  await queue.cancel(one.root, a.id);
  const next = await queue.enqueue(request(2));
  assert.equal((await queue.claim({ root: next.checkout, id: next.id, latestVersion: '0.14.18', mainCommit })).version, '0.14.20');
});
test('damaged durable queue fails closed without overwriting evidence', async t => {
  const { queue, directory, request } = await fixture(t);
  const path = join(directory, 'queue.json'); await writeFile(path, '{"schema":1,"entries":[{}]}');
  await assert.rejects(queue.enqueue(request(1)), /Invalid release queue/);
  assert.equal(await readFile(path, 'utf8'), '{"schema":1,"entries":[{}]}');
});
