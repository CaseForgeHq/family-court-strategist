const fs = require('node:fs/promises');
const { join, relative } = require('node:path');
const { createHash } = require('node:crypto');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function files(root, dir = root) {
  const result = {};
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw Error('Update packages must not contain links.');
    if (entry.isDirectory()) Object.assign(result, await files(root, path));
    else result[relative(root, path).replaceAll('\\', '/')] = digest(await fs.readFile(path));
  }
  return result;
}
module.exports = async context => {
  if (context.electronPlatformName !== 'win32') return;
  const pkg = require('./package.json'), resources = join(context.appOutDir, 'resources');
  const all = await files(context.appOutDir);
  const engine = Object.fromEntries(Object.entries(all).filter(([name]) => !name.startsWith('resources/') && name !== 'Case Forge.exe'));
  const manifest = { schema: 1, version: pkg.version, electron: pkg.build.electronVersion, platform: 'win32', arch: 'x64',
    integration: digest(JSON.stringify({ appId: pkg.build.appId, nsis: pkg.build.nsis, protocols: pkg.build.protocols, fileAssociations: pkg.build.fileAssociations })),
    engine, resources: await files(resources) };
  delete manifest.resources['fast-update.json'];
  await fs.writeFile(join(resources, 'fast-update.json'), JSON.stringify(manifest));
};
