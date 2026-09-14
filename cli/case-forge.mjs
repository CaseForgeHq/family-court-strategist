#!/usr/bin/env node
import { readdirSync, lstatSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, rmdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { factsMain } from '../app/facts-cli.mjs';
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exists = (path) => { try { return lstatSync(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

export function install(destination, { dryRun = false, sourceRoot = packageRoot } = {}) {
  const target = resolve(destination);
  const rootStat = exists(target);
  if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink())) throw new Error('Choose a normal folder, not a file or symbolic link.');
  const files = new Map();
  function collect(folder, prefix = '') {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      const from = join(folder, item.name), to = join(prefix, item.name);
      if (item.isSymbolicLink()) throw new Error('The toolkit package contains an unexpected symbolic link.');
      if (item.isDirectory()) collect(from, to);
      else if (item.isFile()) files.set(to, readFileSync(from));
    }
  }
  collect(join(sourceRoot, 'obsidian-vault'));
  collect(join(sourceRoot, 'plugin', 'skills'), join('.case-forge', 'skills'));
  files.set('CASE-FORGE.md', readFileSync(join(sourceRoot, 'cli', 'CASE-FORGE.md')));
  for (const path of ['facts-cli.mjs', 'lib/facts.js', 'lib/files.js', 'lib/errors.js']) {
    files.set(join('.case-forge', 'tools', path), readFileSync(join(sourceRoot, 'app', path)));
  }
  files.set(join('.case-forge', 'tools', 'package.json'), Buffer.from('{"type":"module"}\n'));
  const entry = Buffer.from('# Case Forge workspace\n\nRead `CASE-FORGE.md` before working in this folder. Preserve originals, cite sources and review findings with the user.\n');
  files.set('AGENTS.md', entry); files.set('CLAUDE.md', entry);
  files.set(join('.case-forge', 'LICENSE'), readFileSync(join(sourceRoot, 'LICENSE')));
  const pending = [], conflicts = [];
  for (const [name, bytes] of files) {
    const parts = name.split(/[\\/]/); let cursor = target;
    for (const part of parts.slice(0, -1)) {
      cursor = join(cursor, part); const stat = exists(cursor);
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) { conflicts.push(relative(target, cursor)); break; }
    }
    const stat = exists(join(target, name));
    if (stat) {
      if (stat.isSymbolicLink() || !stat.isFile() || !readFileSync(join(target, name)).equals(bytes)) conflicts.push(name);
    } else pending.push([name, bytes]);
  }
  if (conflicts.length) throw new Error(`Nothing was changed. These existing paths conflict with the toolkit:\n${[...new Set(conflicts)].map(p => '  '+p).join('\n')}\nChoose a new subfolder, such as "My Case/Case Forge".`);
  if (dryRun) return { target, added:pending.length, total:files.size, dryRun:true };
  const madeFiles = [], madeDirs = [];
  function ensure(folder) {
    const stat = exists(folder);
    if (stat) {
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('A folder changed during setup. Please retry in a new folder.');
      return;
    }
    // Resolve the user-selected parent; system-level aliases such as /tmp are valid.
    const parent = dirname(folder);
    if (!exists(parent)) ensure(parent);
    mkdirSync(folder, { mode:0o700 }); madeDirs.push(folder);
  }
  try {
    if (!rootStat) {
      const parent = dirname(target);
      if (!exists(parent)) ensure(parent);
      mkdirSync(target, { mode:0o700 }); madeDirs.push(target);
    }
    const canonical = realpathSync(target);
    for (const [name, bytes] of pending) {
      const path = join(canonical, name); ensure(dirname(path));
      writeFileSync(path, bytes, { flag:'wx', mode:0o600 }); madeFiles.push([path,bytes]);
    }
  } catch (error) {
    for (const [path,bytes] of madeFiles.reverse()) {
      try { const stat=exists(path); if (stat?.isFile() && !stat.isSymbolicLink() && readFileSync(path).equals(bytes)) unlinkSync(path); } catch {}
    }
    for (const path of madeDirs.reverse()) { try { rmdirSync(path); } catch {} }
    throw new Error(`Setup could not finish: ${error.message}. Existing files were not overwritten.`);
  }
  return { target, added:pending.length, total:files.size, dryRun:false };
}

function main(args) {
  if (args[0] === 'facts') return factsMain(args.slice(1));
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log('Case Forge — free local toolkit\n\nUsage: case-forge init "./My-Case" [--dry-run]\n       case-forge facts --help\n\nAdds templates and AI guidance. Preserves existing files; conflicts stop setup.\nNo AI connection, account, subscription or document upload is performed.'); return;
  }
  const [command, destination, ...flags] = args;
  if (command !== 'init' || !destination || destination.startsWith('--') || flags.some(f=>f!=='--dry-run')) throw new Error('Use: case-forge init "./My-Case" [--dry-run]');
  const result=install(destination,{dryRun:flags.includes('--dry-run')});
  console.log(result.dryRun ? `Preview: ${result.added} files would be added to ${result.target}. Nothing changed.` : `Case Forge is ready in ${result.target}\n${result.added} files added. Existing files preserved.\n\nOpen CASE-FORGE.md, or give your folder-capable AI this instruction:\n"Read CASE-FORGE.md in this folder and help me get started."`);
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode=1; }
}
