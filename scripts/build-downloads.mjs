import { mkdirSync, readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { install } from '../cli/case-forge.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=join(root,'website/downloads');mkdirSync(out,{recursive:true});
const temp=mkdtempSync(join(tmpdir(),'case-forge-downloads-'));
try {
 const info=JSON.parse(execFileSync('npm',['pack','--cache',join(temp,'npm-cache'),'--ignore-scripts','--json','--pack-destination',temp],{cwd:root,encoding:'utf8'}))[0];
 copyFileSync(join(temp,info.filename),join(out,info.filename));
 const vault=join(temp,'Case-Forge');install(vault);
 // Python's standard library creates the manual-download ZIP; no package dependencies.
 execFileSync('python3',['-c',`import pathlib,sys,zipfile\nroot=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED) as z:\n for p in sorted(root.rglob('*')):\n  if p.is_file(): z.write(p,str(pathlib.Path('Case-Forge')/p.relative_to(root)))`,vault,join(out,'case-forge-toolkit.zip')]);
 const names=[info.filename,'case-forge-toolkit.zip'];
 writeFileSync(join(out,'SHA256SUMS.txt'),names.map(name=>createHash('sha256').update(readFileSync(join(out,name))).digest('hex')+'  '+name).join('\n')+'\n');
 console.log('Built '+names.join(' and '));
} finally {rmSync(temp,{recursive:true,force:true});}
