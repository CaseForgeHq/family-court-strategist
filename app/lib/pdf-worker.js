import { parentPort, workerData } from "node:worker_threads";

try {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(workerData), isEvalSupported: false,
    useSystemFonts: false, disableFontFace: true, verbosity: 0,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 250) throw new Error("This preview supports PDFs with up to 250 pages. Split this document into smaller files.");
    const pages = [];
    let length = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const { items } = await page.getTextContent();
      const text = items.filter((item) => "str" in item).map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("").trim();
      length += text.length;
      if (length > 1_000_000) throw new Error("This PDF contains too much text. Split it into smaller files.");
      pages.push({ page: number, text });
      page.cleanup();
    }
    parentPort.postMessage({ pages });
  } finally { await task.destroy(); }
} catch (error) {
  parentPort.postMessage({ error: error.name === "PasswordException"
    ? "This PDF is password-protected. Import an unlocked copy."
    : /preview supports|too much text/.test(error.message) ? error.message
      : "This PDF could not be read. Try exporting a fresh PDF from the original application." });
}
