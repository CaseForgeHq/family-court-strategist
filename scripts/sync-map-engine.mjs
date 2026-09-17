// Ship the pinned renderer with the app: case maps never load a remote script.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
const source = new URL('../app/node_modules/three/', import.meta.url);
const target = new URL('../app/public/vendor/three/', import.meta.url);
const { version } = JSON.parse(await readFile(new URL('package.json', source), 'utf8'));
if (version !== '0.186.0') throw new Error('Review the map renderer before changing its pinned version.');
await mkdir(target, { recursive: true });
for (const name of ['three.core.js', 'three.module.js']) {
  await copyFile(new URL(`build/${name}`, source), new URL(name, target));
}
await copyFile(new URL('LICENSE', source), new URL('LICENSE.txt', target));
const controls = await readFile(new URL('examples/jsm/controls/OrbitControls.js', source), 'utf8');
await writeFile(new URL('OrbitControls.js', target), controls.replace("from 'three'", "from './three.module.js'"));
console.log(`Local case map renderer synced: Three.js ${version}.`);
