const { dirname, join } = require('node:path');
const { mkdirSync, copyFileSync, existsSync } = require('node:fs');
// Only the text-chat server is bundled. Shell and computer-use helpers are not.
const pkg = require.resolve('@openai/codex-win32-x64/package.json');
const source = join(dirname(pkg),'vendor','x86_64-pc-windows-msvc','bin','codex.exe');
const target = join(__dirname,'runtime'); mkdirSync(target,{recursive:true});
if (!existsSync(join(target,'LICENSE-Codex.txt'))) throw new Error('The Codex Apache-2.0 licence must accompany the runtime.');
copyFileSync(source,join(target,'codex.exe'));
console.log('Prepared pinned Codex runtime for ChatGPT sign-in.');
