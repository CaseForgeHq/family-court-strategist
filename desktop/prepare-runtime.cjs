const { dirname, join } = require('node:path');
const { mkdirSync, copyFileSync, existsSync } = require('node:fs');
// Only the text-chat server is bundled. Shell and computer-use helpers are not.
const pkg = require.resolve('@openai/codex-win32-x64/package.json');
const source = join(dirname(pkg),'vendor','x86_64-pc-windows-msvc','bin','codex.exe');
const target = join(__dirname,'runtime'); mkdirSync(target,{recursive:true});
if (!existsSync(join(target,'LICENSE-Codex.txt'))) throw new Error('The Codex Apache-2.0 licence must accompany the runtime.');
copyFileSync(source,join(target,'codex.exe'));
console.log('Prepared pinned Codex runtime for ChatGPT sign-in.');
if (process.platform === 'win32') {
  const { execFileSync } = require('node:child_process');
  const compiler = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  execFileSync(compiler, ['/nologo', '/target:winexe', '/optimize+', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll', '/reference:System.Xml.Linq.dll',
    `/resource:${join(__dirname, '../brand/symbol.svg')},CaseForgeLogo.svg`,
    `/out:${join(target, 'CaseForgeUpdate.exe')}`, join(__dirname, 'update-handoff.cs')], { stdio: 'inherit', windowsHide: true });
  console.log('Prepared independent update status window.');
  require('app-builder-lib/out/toolsets/7zip').getPath7za().then(extractor => {
    copyFileSync(extractor, join(target, '7za.exe'));
    for (const name of ['LICENSE.txt','COPYING']) copyFileSync(join(dirname(dirname(extractor)), name), join(target, `7zip-${name}`));
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
