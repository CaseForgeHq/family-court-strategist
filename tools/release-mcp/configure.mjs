// Run after `codex mcp add caseforge_release -- <node> <server.mjs>`.
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
const path = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
const original = await readFile(path, 'utf8');
const section = /(^\[mcp_servers\.caseforge_release\]\r?\n)([\s\S]*?)(?=^\[|$(?![\s\S]))/m;
const match = original.match(section);
if (!match || !match[2].includes('release-mcp') || !match[2].includes('server.mjs')) throw Error('Register the Case Forge release MCP first. Refusing to change an unrelated entry.');
const eol = original.includes('\r\n') ? '\r\n' : '\n';
const body = match[2].replace(/^\s*(startup_timeout_sec|tool_timeout_sec)\s*=.*\r?\n/gm, '');
const updated = original.replace(section, () => `${match[1]}startup_timeout_sec = 30${eol}tool_timeout_sec = 900${eol}${body}`);
if (updated !== original) {
  await copyFile(path, `${path}.caseforge-release-backup-${Date.now()}`);
  if (await readFile(path, 'utf8') !== original) throw Error('Codex settings changed during configuration. Retry.');
  await writeFile(path, updated);
}
console.log('Case Forge MCP timeouts configured. Other settings preserved.');
