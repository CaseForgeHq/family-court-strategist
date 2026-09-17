// Real stdio handshake and local verification only. Never publishes.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const client = new Client({ name: 'caseforge-smoke', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('server.mjs', import.meta.url))], stderr: 'pipe' });
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  if (result.isError) throw Error(result.content[0].text); return result.structuredContent;
};
try {
  await client.connect(transport);
  const { tools } = await client.listTools(); assert.equal(tools.length, 7);
  const status = await call('release_status');
  if (process.argv.includes('--build')) {
    const result = await client.callTool({ name: 'build_release', arguments: {} }, undefined, { timeout: 900000 });
    if (result.isError) throw Error(result.content[0].text);
    console.log('MCP build completed and verified.');
  }
  const verification = await call('verify_release');
  const prepared = await call('prepare_release', { version: status.version, message: status.message, required: status.required });
  const panel = await call('open_admin_panel');
  const response = await fetch(panel.url.split('#')[0]); assert.equal(response.status, 200); assert.match(await response.text(), /Release an update/);
  let publication = null;
  if (process.argv.includes('--github')) publication = await call('check_publication');
  const report = { testedAt: new Date().toISOString(), transport: 'Real MCP stdio client/server', tools: tools.map(t => t.name), candidateVersion: status.version, verifiedSourceFiles: verification.checkedSourceFiles.length, sourceClean: status.sourceClean, prepared: prepared.result, adminHttpStatus: response.status, publication, published: false, installed: false };
  const out = new URL('../../output/release-mcp/', import.meta.url); await mkdir(out, { recursive: true });
  await writeFile(new URL('smoke.json', out), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await client.close(); }
