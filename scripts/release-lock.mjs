import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const defaultPath = fileURLToPath(new URL('../output/release-operation.lock', import.meta.url));
// Shared across the browser console and every MCP process. Fail closed on ambiguous owners.
export async function withReleaseLock(operation, action, path = defaultPath) {
  await mkdir(dirname(path), { recursive: true });
  let file;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { file = await open(path, 'wx'); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(await readFile(path, 'utf8')); } catch { throw Error('Another release operation is starting. Retry shortly.'); }
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw Error('Release lock needs inspection: invalid owner.');
      try { process.kill(owner.pid, 0); }
      catch (error) {
        if (error.code === 'ESRCH') throw Error(`The previous release operation stopped unexpectedly. Inspect ${path} and the build log before clearing its stale lock.`);
      }
      throw Error(`A release operation (${owner.operation}) is already running. Wait for it to finish.`);
    }
  }
  if (!file) throw Error('Could not acquire the release lock.');
  const id = randomUUID();
  try { await file.writeFile(JSON.stringify({ pid: process.pid, id, operation, startedAt: new Date().toISOString() })); await file.close(); return await action(); }
  finally {
    await file.close().catch(() => {});
    const owner = JSON.parse(await readFile(path, 'utf8').catch(() => '{}'));
    if (owner.id === id) await unlink(path);
  }
}
