import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync,symlinkSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {install} from '../case-forge.mjs';
function folder(t){const p=mkdtempSync(join(tmpdir(),'case-forge-setup-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
test('installs full toolkit beside existing records and reruns without changing them',t=>{const p=folder(t);writeFileSync(join(p,'my-original.txt'),'keep me');const result=install(p);assert.ok(result.added>25);assert.match(readFileSync(join(p,'AGENTS.md'),'utf8'),/CASE-FORGE/);assert.ok(existsSync(join(p,'.case-forge/skills/analyze-document/SKILL.md')));assert.equal(readFileSync(join(p,'my-original.txt'),'utf8'),'keep me');assert.equal(install(p).added,0);});
test('conflicting user notes stop setup before any writes',t=>{const p=folder(t);writeFileSync(join(p,'HOME.md'),'my home');assert.throws(()=>install(p),/Nothing was changed/);assert.deepEqual(readdirSync(p),['HOME.md']);assert.equal(readFileSync(join(p,'HOME.md'),'utf8'),'my home');});
test('dry run does not create the destination',t=>{const p=join(folder(t),'new-case');assert.ok(install(p,{dryRun:true}).added>25);assert.equal(existsSync(p),false);});
test('symlinked destination and nested template directories are rejected',t=>{const p=folder(t),outside=folder(t);symlinkSync(outside,join(p,'linked'),'dir');assert.throws(()=>install(join(p,'linked')),/symbolic link/);mkdirSync(join(p,'case'));symlinkSync(outside,join(p,'case/_system'),'dir');assert.throws(()=>install(join(p,'case')),/Nothing was changed/);assert.deepEqual(readdirSync(outside),[]);});
