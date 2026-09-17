import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, openSync, closeSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { caseRoot, safePath, writeJson } from './files.js';
import { readZip } from './reader-zip.js';
import { AppError } from './errors.js';

export class ReaderError extends AppError {
  constructor(message, code = 'unreadable', details = {}) { super(message, 422); this.name = 'ReaderError'; this.code = code; Object.assign(this, details); }
}

// Release assets and model bytes are pinned. Setup never downloads an unversioned
// executable or accepts a checksum supplied by a document or remote response.
export const READER_PACKAGES = Object.freeze([
  { id: 'java', version: '21.0.12.1+1', file: 'java.zip', algorithm: 'sha256', digest: 'd35f31e712f0fcf6ac5a093edc90204fbff22f720ba3950bd09d331d5e621636', url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip', maxBytes: 60_000_000, zip: true },
  { id: 'tika', version: '3.3.2', file: 'tika-app-3.3.2.jar', algorithm: 'sha512', digest: '88c2032cba0d45feea361e6eebd2918bd04707614cdda5d89a1b167da5503c98e7b4cd368336f0402d559abcaf5006fcc7c825c32c749ae0417ea2f3b8423aba', url: 'https://archive.apache.org/dist/tika/3.3.2/tika-app-3.3.2.jar', maxBytes: 160_000_000 },
  { id: 'ffmpeg', version: '8.0', file: 'ffmpeg.zip', algorithm: 'sha256', digest: '647e467caf82b9fa200a562769b5ff4d736aaf725804ed2c64ea9752106fa569', url: 'https://github.com/GyanD/codexffmpeg/releases/download/8.0/ffmpeg-8.0-essentials_build.zip', maxBytes: 120_000_000, zip: true },
  { id: 'whisper', version: 'b5130', file: 'whisper.zip', algorithm: 'sha256', digest: 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c', url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip', maxBytes: 15_000_000, zip: true },
  { id: 'model', version: 'small-multilingual', file: 'ggml-small.bin', algorithm: 'sha256', digest: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.bin', maxBytes: 490_000_000 },
]);

export function readerDirectory() { return process.env.CASE_FORGE_READERS_DIR || join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'CaseForge', 'readers', 'v1'); }

export function getReaderStatus({ directory = readerDirectory() } = {}) {
  let receipt;
  try { receipt = JSON.parse(readFileSync(join(directory, 'installed.json'), 'utf8')); } catch { receipt = {}; }
  const paths = {}, missing = [];
  for (const key of ['java', 'tika', 'ffmpeg', 'ffprobe', 'whisper', 'model']) {
    const rel = receipt.paths?.[key];
    try {
      if (!rel) throw new Error();
      const file = safePath(caseRoot(directory), rel);
      if (!statSync(file).isFile()) throw new Error();
      paths[key] = file;
    } catch { missing.push(key); }
  }
  return { ready: missing.length === 0, state: missing.length ? 'setup_required' : 'ready', missing, paths, directory, versions: receipt.versions || {}, downloadBytes: 770_000_000, message: missing.length ? 'Set up local readers to scan Office documents, email, audio and video. The download includes Java, Apache Tika, FFmpeg and the multilingual Small transcription model.' : 'Local document and recording readers are ready.' };
}

const installs = new Map();
export function provisionReaders(options = {}) {
  const directory = options.directory || readerDirectory();
  if (installs.has(directory)) return installs.get(directory);
  const task = install({ ...options, directory }).finally(() => installs.delete(directory));
  installs.set(directory, task);
  return task;
}

async function install({ directory, signal, onProgress = () => {}, fetchImpl = fetch }) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new ReaderError('Automatic reader setup currently supports Windows x64.', 'dependencies_missing');
  if (getReaderStatus({ directory }).ready) return getReaderStatus({ directory });
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const root = caseRoot(directory), job = `.setup-${randomUUID()}`, paths = {}, versions = {};
  mkdirSync(safePath(root, job), { mode: 0o700 });
  try {
    for (const pkg of READER_PACKAGES) {
      signal?.throwIfAborted();
      const archive = safePath(root, `${job}/${pkg.file}`), fd = openSync(archive, 'wx', 0o600), hash = createHash(pkg.algorithm);
      let length = 0;
      onProgress({ state: 'downloading', dependency: pkg.id, bytes: 0, maxBytes: pkg.maxBytes });
      try {
        const response = await fetchImpl(pkg.url, { signal, redirect: 'follow' });
        if (!response.ok || !response.body || !response.url.startsWith('https:')) throw new ReaderError(`The ${pkg.id} reader download failed. Retry setup.`, 'setup_failed');
        for await (const chunk of response.body) {
          signal?.throwIfAborted(); length += chunk.length;
          if (length > pkg.maxBytes) throw new ReaderError('A reader download exceeded its expected size.', 'setup_failed');
          hash.update(chunk); writeSync(fd, chunk);
          onProgress({ state: 'downloading', dependency: pkg.id, bytes: length, maxBytes: pkg.maxBytes });
        }
      } finally { closeSync(fd); }
      if (hash.digest('hex') !== pkg.digest) throw new ReaderError(`The ${pkg.id} reader failed its download integrity check.`, 'setup_failed');
      const targetRel = `${pkg.id}-${pkg.version.replaceAll('+', '_')}`, target = safePath(root, targetRel);
      const stagingRel = `${job}/${pkg.id}`, staging = safePath(root, stagingRel);
      mkdirSync(staging, { mode: 0o700 });
      const entries = pkg.zip ? readZip(readFileSync(archive), { maxEntries: 10_000, maxBytes: 1_000_000_000, maxEntryBytes: 512_000_000 }) : [{ name: pkg.file, bytes: readFileSync(archive) }];
      for (const entry of entries) {
        signal?.throwIfAborted();
        const file = safePath(root, `${stagingRel}/${entry.name}`, true);
        writeFileSync(file, entry.bytes, { flag: 'wx', mode: 0o600 });
        const leaf = basename(entry.name).toLowerCase();
        const key = ({ 'java.exe': 'java', 'ffmpeg.exe': 'ffmpeg', 'ffprobe.exe': 'ffprobe', 'whisper-cli.exe': 'whisper', 'ggml-small.bin': 'model', 'tika-app-3.3.2.jar': 'tika' })[leaf];
        if (key) paths[key] = `${targetRel}/${entry.name}`;
      }
      // An interrupted prior install can leave a verified package behind. The
      // receipt is published only when the complete reader set is available.
      if (existsSync(target)) {
        for (const entry of entries) {
          const previous = readFileSync(safePath(root, `${targetRel}/${entry.name}`));
          if (!previous.equals(entry.bytes)) throw new ReaderError('An existing reader package has changed. Remove that reader package and retry setup.', 'setup_failed');
        }
      } else renameSync(staging, target);
      versions[pkg.id] = pkg.version;
      onProgress({ state: 'installed', dependency: pkg.id, bytes: length });
    }
    if (['java', 'tika', 'ffmpeg', 'ffprobe', 'whisper', 'model'].some((key) => !paths[key])) throw new ReaderError('The downloaded reader packages were missing required files.', 'setup_failed');
    writeJson(root, 'installed.json', { version: 1, paths, versions, installedAt: new Date().toISOString() });
    return getReaderStatus({ directory });
  } finally {
    // This generated child was resolved through safePath before removal.
    rmSync(safePath(root, job), { recursive: true, force: true });
  }
}

export function runReaderProcess(command, args, { signal, cwd, timeoutMs = 120_000, maxOutputBytes = 12_000_000, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason || new ReaderError('Reading cancelled.', 'cancelled')); return; }
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let stdout = '', stderr = '', total = 0, settled = false, stoppingError = null;
    const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve({ stdout, stderr }); };
    // Wait for close after requesting termination. Windows can retain open
    // output-file handles until then; rejecting early races case cleanup.
    const stop = (error) => { if (settled || stoppingError) return; stoppingError = error; child.kill(); };
    const abort = () => stop(signal.reason || new ReaderError('Reading cancelled.', 'cancelled'));
    const timer = setTimeout(() => stop(new ReaderError('The local reader exceeded its time limit. Try a smaller file.', 'incomplete')), timeoutMs);
    child.stdout.on('data', (data) => { total += Buffer.byteLength(data); if (total > maxOutputBytes) return stop(new ReaderError('The reader output exceeded the supported size. Split the file and retry.', 'incomplete')); stdout += data; });
    child.stderr.on('data', (data) => { onStderr?.(data); stderr = (stderr + data).slice(-500_000); });
    child.on('error', () => finish(stoppingError || new ReaderError('A local reader could not start. Run reader setup and retry.', 'dependencies_missing')));
    child.on('close', (code) => finish(stoppingError || (code === 0 ? null : new ReaderError(/password|encrypted/i.test(stderr) ? 'This file is password-protected. Import an unlocked copy.' : 'The local reader could not decode this file. Its original has been preserved.', 'unreadable'))));
    signal?.addEventListener('abort', abort, { once: true });
  });
}
