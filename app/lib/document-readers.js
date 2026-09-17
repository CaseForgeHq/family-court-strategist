import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { Worker } from 'node:worker_threads';
import { readLocal, safePath } from './files.js';
import { ReaderError, getReaderStatus, runReaderProcess } from './reader-dependencies.js';
import { readZip } from './reader-zip.js';

export { ReaderError, getReaderStatus, provisionReaders } from './reader-dependencies.js';
export const MAX_DOCUMENT_BYTES = 512 * 1024 * 1024;
export const SUPPORTED_EXTENSIONS = Object.freeze(['.pdf', '.txt', '.md', '.csv', '.tsv', '.json', '.xml', '.html', '.htm', '.rtf', '.doc', '.docx', '.odt', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp', '.eml', '.msg', '.mbox', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.mp4', '.mov', '.mkv', '.webm', '.avi', '.mpeg', '.mpg', '.zip']);
const TEXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.xml']);
const AUDIO = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus']);
const VIDEO = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.mpeg', '.mpg']);
const IMAGES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff']);
const MAX_TEXT = 4_000_000, MAX_FRAMES = 1000;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function validateImport(filename, bytes) {
  if (typeof filename !== 'string') throw new ReaderError('Choose a file to import.', 'unsupported');
  const name = filename.split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, '').trim();
  let extension = extname(name).toLowerCase();
  if (!name || name.length > 180) throw new ReaderError('Choose a supported document, image, email, recording or ZIP archive.', 'unsupported');
  if (!bytes?.length || bytes.length > MAX_DOCUMENT_BYTES) throw new ReaderError('Choose a non-empty file up to 512 MB.', 'unsupported');
  const head = bytes.subarray(0, 1024), ascii = head.toString('latin1');
  let format = TEXT.has(extension) ? 'text' : AUDIO.has(extension) ? 'audio' : VIDEO.has(extension) ? 'video' : IMAGES.has(extension) ? 'image' : extension === '.zip' ? 'archive' : extension === '.pdf' ? 'pdf' : 'office';
  // Bytes take precedence over a misleading extension for recognizable formats.
  if (head.includes(Buffer.from('%PDF-'))) { format = 'pdf'; extension = '.pdf'; }
  else if (head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { format = 'image'; extension = '.png'; }
  else if (head.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) { format = 'image'; extension = '.jpg'; }
  else if (/^GIF8[79]a/.test(ascii)) { format = 'image'; extension = '.gif'; }
  else if (/^BM/.test(ascii)) { format = 'image'; extension = '.bmp'; }
  else if (/^RIFF[\s\S]{4}WEBP/.test(ascii)) { format = 'image'; extension = '.webp'; }
  else if (/^RIFF[\s\S]{4}WAVE/.test(ascii)) { format = 'audio'; extension = '.wav'; }
  else if (/^fLaC/.test(ascii)) { format = 'audio'; extension = '.flac'; }
  else if (/^OggS/.test(ascii)) { format = 'audio'; extension = '.ogg'; }
  else if (/^ID3/.test(ascii)) { format = 'audio'; extension = '.mp3'; }
  else if (/^RIFF[\s\S]{4}AVI /.test(ascii)) { format = 'video'; extension = '.avi'; }
  else if (ascii.slice(4, 8) === 'ftyp') { format = AUDIO.has(extension) ? 'audio' : 'video'; if (!SUPPORTED_EXTENSIONS.includes(extension)) extension = '.mp4'; }
  else if (/^\{\\rtf/.test(ascii)) { format = 'office'; extension = '.rtf'; }
  else if (head.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) { format = 'office'; if (!SUPPORTED_EXTENSIONS.includes(extension)) extension = '.doc'; }
  else if (extension === '.pdf') throw new ReaderError('This file does not contain a valid PDF header.', 'unreadable');
  if (!SUPPORTED_EXTENSIONS.includes(extension)) throw new ReaderError('Choose a supported document, image, email, recording or ZIP archive.', 'unsupported');
  return { name, extension, format };
}

function requireReaders(dependencies, keys) {
  const missing = keys.filter((key) => !dependencies[key] || !existsSync(dependencies[key]));
  if (missing.length) throw new ReaderError('Set up local readers before scanning this file.', 'dependencies_missing', { missing });
}

function writeDerived(root, rel, bytes) {
  const path = safePath(root, rel, true);
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  return rel;
}

function cleanText(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new ReaderError('Save this text document as UTF-8 and import it again.'); }
  if (text.includes('\0') || text.length > MAX_TEXT) throw new ReaderError('The file is not readable UTF-8 text, or its text exceeds the supported size.', 'incomplete');
  return text;
}

export function parseDelimited(text, delimiter) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && (quoted || !value)) {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(value); rows.push(row); row = []; value = '';
    } else value += char;
  }
  if (quoted) throw new ReaderError('This delimited text has an unfinished quoted cell.');
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}

const columnName = (number) => { let result = ''; for (let n = number; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + ((n - 1) % 26)) + result; return result; };
export function textPages(text, extension) {
  if (extension === '.csv' || extension === '.tsv') return parseDelimited(text, extension === '.csv' ? ',' : '\t').flatMap((row, r) => row.map((value, c) => ({ text: value, anchor: { kind: 'cell', sheet: null, row: r + 1, column: c + 1, cell: `${columnName(c + 1)}${r + 1}` } }))).map((value, i) => ({ page: i + 1, ...value }));
  return text.split(/\r?\n\s*\r?\n/).map((text, i) => ({ page: i + 1, text: text.trim(), anchor: { kind: 'paragraph', paragraph: i + 1 } })).filter((value) => value.text);
}

function decodeXml(text) {
  return text.replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos|nbsp);/gi, (_, numeric, named) => {
    if (numeric) { const value = numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : Number(numeric); return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '\ufffd'; }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[named.toLowerCase()];
  });
}

export function parseTikaXhtml(xhtml, { spreadsheet = false } = {}) {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(xhtml)?.[1] || xhtml;
  const pages = []; let paragraph = 0, table = 0, row = 0, col = 0, heading = '', current = '', tag = '', anchor = null;
  const flush = () => { const text = decodeXml(current).replace(/[ \t]+/g, ' ').trim(); if (text) pages.push({ page: pages.length + 1, text, anchor: anchor || { kind: 'paragraph', paragraph: ++paragraph } }); current = ''; anchor = null; };
  for (const token of body.match(/<[^>]*>|[^<]+/g) || []) {
    if (!token.startsWith('<')) { current += token; continue; }
    const closing = /^<\//.test(token), name = /^<\/?([\w:-]+)/.exec(token)?.[1]?.toLowerCase();
    if (name === 'table' && !closing) { flush(); table++; row = 0; }
    else if (name === 'tr' && !closing) { flush(); row++; col = 0; }
    else if ((name === 'td' || name === 'th') && !closing) { flush(); col++; tag = name; anchor = { kind: 'cell', table, row, column: col, cell: `${columnName(col)}${row}`, sheet: spreadsheet ? heading || null : null, locationBasis: 'extracted-table' }; }
    else if (/^h[1-6]$/.test(name || '')) { if (closing) { heading = decodeXml(current).trim(); flush(); } else { flush(); tag = name; } }
    else if (['p', 'li', 'td', 'th', 'tr', 'div'].includes(name) && closing) flush();
    else if (['p', 'li'].includes(name) && !closing) { flush(); tag = name; }
    else if (name === 'br') current += '\n';
  }
  flush();
  return pages;
}

async function readPdf({ root, record, base, signal, onProgress }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./reader-pdf-worker.js', import.meta.url), { workerData: { root, original: record.original }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512 } });
    const pages = [], images = [], attachments = []; let settled = false;
    const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); void worker.terminate(); error ? reject(error) : resolve({ pages, images, attachments }); };
    const abort = () => finish(signal.reason || new ReaderError('Reading cancelled.', 'cancelled'));
    const timer = setTimeout(() => finish(new ReaderError('PDF reading exceeded the time limit. Split the file and retry.', 'incomplete')), 300_000);
    worker.on('message', (message) => {
      if (settled) return;
      if (message.error) return finish(new ReaderError(message.error));
      if (message.done) return finish();
      try {
        if (message.attachment) {
          const bytes = Buffer.from(message.attachment.bytes), name = String(message.attachment.name || 'attachment.bin').split(/[\\/]/).pop().replace(/[\x00-\x1f:]/g, '_');
          const path = writeDerived(root, `${base}/attachments/${attachments.length}-${digest(bytes)}${extname(name).slice(0, 12)}`, bytes);
          attachments.push({ name, path, parentId: record.id, source: { kind: 'pdf-attachment', embeddedPath: message.attachment.name } });
          return;
        }
        const anchor = { kind: 'page', page: message.page };
        pages.push({ page: message.page, text: message.text, anchor });
        if (message.image) images.push({ path: writeDerived(root, `${base}/page-${message.page}.png`, Buffer.from(message.image)), page: message.page, anchor });
        onProgress?.({ stage: 'reading', label: `Reading page ${message.page} of ${message.totalPages}` });
      } catch (error) { finish(error); }
    });
    worker.on('error', () => finish(new ReaderError('The PDF reader could not finish.')));
    worker.on('exit', () => { if (!settled) finish(new ReaderError('The PDF reader stopped before finishing.')); });
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  });
}

function extractedFiles(root, rel, result = [], budget = { bytes: 0 }, depth = 0) {
  if (depth > 8) throw new ReaderError('Embedded files exceed the supported nesting depth.', 'incomplete');
  for (const name of readdirSync(safePath(root, rel))) {
    const child = `${rel}/${name}`, file = safePath(root, child), stat = statSync(file);
    if (stat.isDirectory()) extractedFiles(root, child, result, budget, depth + 1);
    else {
      budget.bytes += stat.size;
      if (budget.bytes > MAX_DOCUMENT_BYTES || result.length >= 1000) throw new ReaderError('Embedded files exceed the supported extraction size.', 'incomplete');
      result.push({ name, path: child, bytes: stat.size });
    }
  }
  return result;
}

async function readTika({ root, record, base, dependencies, signal, runProcess }) {
  requireReaders(dependencies, ['java', 'tika']);
  const original = safePath(root, record.original);
  const args = ['-Xmx512m', '-Djava.awt.headless=true', '-jar', dependencies.tika];
  const result = await runProcess(dependencies.java, [...args, '-J', '-x', original], { signal });
  let items;
  try { items = JSON.parse(result.stdout); } catch { throw new ReaderError('The Office/email reader returned an unreadable result.'); }
  if (!Array.isArray(items) || !items.length || items.length > 1000) throw new ReaderError('The reader did not return a complete document.', 'incomplete');
  const warnings = [];
  for (const item of items) if (Object.keys(item).some((key) => /^X-TIKA:EXCEPTION|write_limit_reached|embedded_resource_limit_reached/i.test(key))) warnings.push('The reader reported content it could not fully extract.');
  const metadata = items[0], content = String(metadata['X-TIKA:content'] || '');
  const pages = parseTikaXhtml(content, { spreadsheet: ['.xls', '.xlsx', '.ods'].includes(record.extension) });
  if (pages.reduce((n, p) => n + p.text.length, 0) > MAX_TEXT) throw new ReaderError('The extracted text exceeds the supported size. Split the document and retry.', 'incomplete');
  const attachments = [];
  if (items.length > 1) {
    const target = `${base}/embedded`; mkdirSync(safePath(root, target), { mode: 0o700 });
    // Tika 3.3.2's FileEmbeddedDocumentExtractor normalizes and containment-checks
    // paths. The directory is new, app-generated and contains no links.
    const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    let monitorError;
    const monitor = setInterval(() => { try { extractedFiles(root, target); } catch (error) { monitorError = error; controller.abort(error); } }, 250);
    try { await runProcess(dependencies.java, [...args, `--extract-dir=${safePath(root, target)}`, '-z', original], { signal: controller.signal }); }
    finally { clearInterval(monitor); signal?.removeEventListener('abort', abort); }
    if (monitorError) throw monitorError;
    const extracted = extractedFiles(root, target);
    for (const file of extracted) {
      const meta = items.slice(1).find((item) => file.name.endsWith(String(item.resourceName || '\0')));
      attachments.push({ ...file, parentId: record.id, source: { kind: 'attachment', embeddedPath: meta?.['X-TIKA:embedded_resource_path'] || file.name, relationshipId: meta?.['embeddedRelationshipId'] || null } });
    }
    if (extracted.length < items.length - 1) warnings.push('Some embedded records could not be saved as separate original attachments.');
  }
  if (!pages.some((p) => p.text.trim()) && !attachments.length) throw new ReaderError('The reader found no readable document content.');
  return { pages, images: [], attachments, metadata, warnings, reader: { name: 'Apache Tika', version: '3.3.2' } };
}

export function parseWhisperTranscript(value) {
  if (!Array.isArray(value?.transcription)) throw new ReaderError('The transcription reader did not return timestamped text.');
  return value.transcription.map((segment, i) => {
    const startMs = Number(segment.offsets?.from), endMs = Number(segment.offsets?.to);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs < startMs || typeof segment.text !== 'string') throw new ReaderError('The transcription reader returned invalid source timestamps.');
    return { page: i + 1, text: segment.text.trim(), anchor: { kind: 'timestamp', startMs, endMs, speaker: null } };
  }).filter((segment) => segment.text);
}

async function perceptualHash(path) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const canvas = createCanvas(9, 8), context = canvas.getContext('2d');
  context.drawImage(await loadImage(path), 0, 0, 9, 8);
  const pixels = context.getImageData(0, 0, 9, 8).data; let hash = 0n;
  const gray = (n) => pixels[n] * 0.299 + pixels[n + 1] * 0.587 + pixels[n + 2] * 0.114;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash = (hash << 1n) | BigInt(gray((y * 9 + x) * 4) > gray((y * 9 + x + 1) * 4));
  const average = [0, 0, 0];
  for (let i = 0; i < pixels.length; i += 4) for (let channel = 0; channel < 3; channel++) average[channel] += pixels[i + channel] / 72;
  return { bits: hash, average };
}
const similar = (a, b) => { let bits = a.bits ^ b.bits, count = 0; while (bits) { bits &= bits - 1n; count++; } return count <= 4 && a.average.every((v, i) => Math.abs(v - b.average[i]) <= 10); };

async function readMedia({ root, record, base, dependencies, signal, runProcess, format, onProgress }) {
  requireReaders(dependencies, ['ffmpeg', 'ffprobe']);
  const original = safePath(root, record.original), options = { signal, timeoutMs: 7_200_000 };
  const probe = await runProcess(dependencies.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-show_streams', '-of', 'json', original], { signal });
  let info; try { info = JSON.parse(probe.stdout); } catch { throw new ReaderError('The recording metadata could not be read.'); }
  const durationSeconds = Number(info.format?.duration), audio = info.streams?.some((s) => s.codec_type === 'audio'), video = info.streams?.some((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 7200) throw new ReaderError('Recordings must have a readable duration of up to two hours. Split longer recordings and retry.', 'incomplete');
  if (!audio && !video) throw new ReaderError('No readable audio or video track was found.');
  const pages = [], images = [], warnings = [], samples = [];
  if (audio) {
    requireReaders(dependencies, ['whisper', 'model']);
    onProgress?.({ stage: 'reading', label: 'Transcribing recording locally' });
    const wav = safePath(root, `${base}/audio.wav`), transcript = safePath(root, `${base}/transcript`);
    await runProcess(dependencies.ffmpeg, ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', original, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], options);
    try {
      await runProcess(dependencies.whisper, ['-m', dependencies.model, '-f', wav, '-l', 'auto', '-oj', '-of', transcript, '-t', '2', '-ng'], options);
      pages.push(...parseWhisperTranscript(JSON.parse(readFileSync(`${transcript}.json`, 'utf8'))));
    } finally { rmSync(safePath(root, `${base}/audio.wav`), { force: true }); }
    if (!pages.length) warnings.push('No intelligible speech was transcribed. Review the original recording.');
    warnings.push('Transcript is machine-generated; speaker identities are unknown unless established by the content.');
  }
  if (video) {
    onProgress?.({ stage: 'reading', label: 'Sampling video scenes and ten-second frames' });
    for (const [kind, selection] of [['interval', 'select=isnan(prev_selected_t)+gte(t-prev_selected_t\\,10)'], ['scene', "select=eq(n\\,0)+gt(scene\\,0.3)"]]) {
      const timestamps = [];
      const result = await runProcess(dependencies.ffmpeg, ['-nostdin', '-v', 'info', '-protocol_whitelist', 'file,pipe', '-i', original, '-map', '0:v:0', '-an', '-vf', `${selection},scale=1280:720:force_original_aspect_ratio=decrease,showinfo`, '-fps_mode', 'vfr', '-frames:v', String(MAX_FRAMES + 1), safePath(root, `${base}/${kind}-%06d.png`)], options);
      for (const match of result.stderr.matchAll(/\bpts_time:([\d.]+)/g)) timestamps.push(Math.round(Number(match[1]) * 1000));
      const files = readdirSync(safePath(root, base)).filter((name) => new RegExp(`^${kind}-\\d{6}\\.png$`).test(name)).sort();
      if (files.length > MAX_FRAMES) throw new ReaderError('Video sampling reached its frame limit. Split the recording and retry.', 'incomplete');
      if (files.length !== timestamps.length) throw new ReaderError('Video frame timestamps could not be matched reliably.', 'incomplete');
      files.forEach((name, i) => samples.push({ path: `${base}/${name}`, timestampMs: timestamps[i], kind }));
    }
    samples.sort((a, b) => a.timestampMs - b.timestampMs);
    let previous;
    for (const sample of samples) {
      signal?.throwIfAborted(); const hash = await perceptualHash(safePath(root, sample.path));
      if (previous && similar(hash, previous.hash)) { sample.duplicateOf = previous.path; rmSync(safePath(root, sample.path), { force: true }); }
      else {
        const page = pages.length + 1, anchor = { kind: 'timestamp', startMs: sample.timestampMs, endMs: sample.timestampMs };
        pages.push({ page, text: '', anchor });
        images.push({ path: sample.path, page, timestampMs: sample.timestampMs, anchor });
        previous = { hash, path: sample.path };
      }
    }
    warnings.push('Video visuals are sampled at ten-second intervals and scene changes; near-duplicate sampled frames are omitted. Unsampled moments have not been visually reviewed.');
  }
  return { pages, images, attachments: [], warnings, visualSampled: Boolean(video), durationSeconds, samples, reader: { name: 'FFmpeg / whisper.cpp multilingual Small', version: '8.0 / b5130' }, metadata: { audio, video, format: info.format?.format_name } };
}

export async function readDocument({ root, record, signal, dependencies = getReaderStatus().paths, onProgress, runProcess = runReaderProcess }) {
  signal?.throwIfAborted();
  if (!/^[a-f0-9]{64}$/.test(record?.id || '')) throw new ReaderError('The document identifier is invalid.');
  const bytes = readLocal(root, record.original), detected = validateImport(record.name, bytes);
  if (digest(bytes) !== record.id) throw new ReaderError('The stored original has changed. Reimport it before scanning.', 'source_changed');
  const base = `.case-forge/derived/${record.id}/read-${randomUUID()}`;
  mkdirSync(safePath(root, base, true), { mode: 0o700 });
  const context = { root, record: { ...record, extension: detected.extension }, base, dependencies, signal, onProgress, runProcess, format: detected.format };
  try {
    let result;
    if (detected.format === 'text') result = { pages: textPages(cleanText(bytes), detected.extension), images: [], attachments: [], reader: { name: 'UTF-8 text', version: '1' } };
    else if (detected.format === 'pdf') {
      result = { ...await readPdf(context), reader: { name: 'PDF.js', version: '6.3.289' } };
      result.visualReviewedPages = result.images.map((image) => image.page);
      result.visualOmittedPages = result.pages.filter((page) => !result.visualReviewedPages.includes(page.page)).map((page) => page.page);
      if (result.visualOmittedPages.length) result.warnings = ['Searchable PDF pages are read as text. Visual inspection covers the first page, text-poor pages and pages with filing or seal indicators; other page graphics have not been inspected.'];
    }
    else if (detected.format === 'image') {
      const { createCanvas, loadImage } = await import('@napi-rs/canvas');
      let source;
      try { source = await loadImage(bytes); } catch { throw new ReaderError('This image could not be decoded. Export a PNG or JPEG copy and retry.'); }
      if (!source.width || !source.height || source.width * source.height > 100_000_000) throw new ReaderError('The image dimensions exceed the supported size.', 'incomplete');
      const scale = Math.min(1, 2048 / Math.max(source.width, source.height)), canvas = createCanvas(Math.ceil(source.width * scale), Math.ceil(source.height * scale));
      canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
      const multiFrame = ['.gif', '.tif', '.tiff'].includes(detected.extension);
      result = { pages: [{ page: 1, text: '', anchor: { kind: 'image', image: 1 } }], images: [{ path: writeDerived(root, `${base}/image.png`, canvas.toBuffer('image/png')), page: 1, anchor: { kind: 'image', image: 1 } }], attachments: [], warnings: multiFrame ? ['Only the first image frame was decoded. Export all pages or frames individually before completing the scan.'] : [], incomplete: multiFrame, reader: { name: 'Native image decoder', version: '1' } };
    } else if (detected.format === 'audio' || detected.format === 'video') result = await readMedia(context);
    else if (detected.format === 'archive') {
      let members; try { members = readZip(bytes); } catch (error) { throw new ReaderError(error.message, 'incomplete'); }
      const attachments = members.map((member, index) => ({ name: basename(member.name), path: writeDerived(root, `${base}/attachments/${index}-${digest(member.bytes)}${extname(member.name).slice(0, 12)}`, member.bytes), parentId: record.id, source: { kind: 'archive-member', embeddedPath: member.name } }));
      result = { pages: [{ page: 1, text: `Archive contains ${attachments.length} files. Each member is registered independently and requires its own scan.\n${members.map((m) => m.name).join('\n')}`, anchor: { kind: 'archive-manifest' } }], images: [], attachments, reader: { name: 'ZIP integrity reader', version: '1' }, warnings: ['Archive member contents are not analysed as part of the archive manifest. Scan each member separately.'] };
    } else result = await readTika(context);
    signal?.throwIfAborted();
    if (!result.pages.length && !result.images.length && !result.attachments.length) throw new ReaderError('No readable content was found.');
    return { version: 1, documentId: record.id, format: detected.format, ...result, coverage: { complete: !result.incomplete && !(result.warnings || []).some((w) => /could not fully|could not be saved|No intelligible/.test(w)), textComplete: !result.incomplete, visualSampled: Boolean(result.visualSampled), warnings: result.warnings || [], ...(result.durationSeconds ? { durationSeconds: result.durationSeconds, intervalSeconds: 10, samples: result.samples } : {}), pages: result.pages.length, images: result.images.length }, createdAt: new Date().toISOString() };
  } catch (error) {
    rmSync(safePath(root, base), { recursive: true, force: true });
    throw error instanceof ReaderError || signal?.aborted ? error : new ReaderError('The local reader could not finish. The original file has been preserved.');
  }
}
