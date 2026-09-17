// Keep both independently deployable surfaces on the same local brand assets.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
const source = new URL('../brand/', import.meta.url);
for (const destination of ['../website/brand/', '../app/public/brand/', '../desktop/brand/']) {
  const target = new URL(destination, import.meta.url);
  await mkdir(target, { recursive: true });
  for (const name of ['tokens.css', 'logo.svg', 'logo-reversed.svg', 'symbol.svg', 'favicon.svg', 'fonts']) {
    await cp(new URL(name, source), new URL(name, target), { recursive: true });
  }
  // Same font designs, with Latin subsets for the English public website.
  // The running local app can keep its existing allowlisted TTF asset.
  if (destination === '../website/brand/') {
    const css = new URL('tokens.css', target);
    const latinRange='U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-22FF,U+FEFF,U+FFFD';
    await writeFile(css, (await readFile(css, 'utf8')).replace('InterVariable.woff2', 'Inter-Latin.woff2').replace("EBGaramond-Variable.ttf') format('truetype')", "EBGaramond-Latin.woff2') format('woff2')").replaceAll('font-display:swap}', `font-display:swap;unicode-range:${latinRange}}`));
  }
}
console.log('Case Forge brand assets synced to website and app.');
// The workspace and setup share the same offline scene and font sources.
const sceneTarget = new URL('../app/public/scene/', import.meta.url);
await mkdir(sceneTarget, { recursive:true });
for (const name of ['landscape.css','landscape.js','scene-time.js','scene-controls.css','scene-controls.js','fonts']) {
  await cp(new URL(`../desktop/${name}`, import.meta.url), new URL(name, sceneTarget), { recursive:true });
}
console.log('Shared desktop atmosphere and typefaces synced to the workspace.');
await import('./sync-map-engine.mjs');
