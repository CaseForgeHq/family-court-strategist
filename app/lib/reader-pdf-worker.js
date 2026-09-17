import { parentPort, workerData } from 'node:worker_threads';
import { readLocal } from './files.js';

try {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');
  const task = getDocument({ data: new Uint8Array(readLocal(workerData.root, workerData.original)), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 500) throw new Error('This PDF exceeds 500 pages. Split it into smaller files.');
    let total = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number), content = await page.getTextContent();
      const text = content.items.filter((item) => 'str' in item).map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
      total += text.length;
      if (total > 4_000_000) throw new Error('The extracted PDF text exceeds the supported size. Split it into smaller files.');
      // The first page supports document identity/stamp review. Text-poor pages
      // and possible filing/seal pages need vision; other searchable pages can
      // be analysed from text without paying for the same content twice.
      const visual = number === 1 || text.length < 80 || /\b(stamp(?:ed)?|seal(?:ed)?|filed|lodged|endorsed)\b/i.test(text);
      let image;
      if (visual) {
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 1600 / Math.max(natural.width, natural.height)) });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        image = canvas.toBuffer('image/png'); canvas.width = 1; canvas.height = 1;
      }
      parentPort.postMessage({ page: number, text, image, totalPages: pdf.numPages });
      page.cleanup();
    }
    const embedded = await pdf.getAttachments();
    let attachmentBytes = 0;
    for (const attachment of Object.values(embedded || {})) {
      attachmentBytes += attachment.content?.length || 0;
      if (attachmentBytes > 256 * 1024 * 1024) throw new Error('Embedded PDF files exceed the supported size.');
      parentPort.postMessage({ attachment: { name: attachment.filename, bytes: attachment.content } });
    }
    parentPort.postMessage({ done: true });
  } finally { await task.destroy(); }
} catch (error) {
  parentPort.postMessage({ error: error.name === 'PasswordException' ? 'This PDF is password-protected. Import an unlocked copy.' : /exceeds|supported size/.test(error.message) ? error.message : 'This PDF could not be fully read. Try exporting a fresh PDF from the original application.' });
}
