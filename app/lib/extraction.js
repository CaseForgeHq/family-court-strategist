import { Worker } from "node:worker_threads";
import { AppError } from "./errors.js";

export const MAX_UPLOAD = 20 * 1024 * 1024;

export async function extractDocument(bytes, extension, signal) {
  if (!bytes.length || bytes.length > MAX_UPLOAD) throw new AppError("Choose a non-empty PDF, TXT or Markdown file up to 20 MB.");
  if (extension !== ".pdf") {
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new AppError("Save this text document as UTF-8 and import it again."); }
    if (text.includes("\0") || text.length > 1_000_000) throw new AppError("This is not a supported text document, or it is too large.");
    return [{ page: 1, text: text.trim() }];
  }
  if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new AppError("This file does not contain a valid PDF header.");
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pdf-worker.js", import.meta.url), {
      workerData: bytes, resourceLimits: { maxOldGenerationSizeMb: 256 },
      // Do not inherit CLI --input-type; worker entry is a file.
      execArgv: [],
    });
    let settled = false;
    const finish = (error, pages) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      void worker.terminate();
      error ? reject(error) : resolve(pages);
    };
    const abort = () => finish(new AppError("Document reading was cancelled.", 409));
    const timer = setTimeout(() => finish(new AppError("Reading this PDF took too long. Try a smaller document.")), 30_000);
    worker.on("message", (result) => finish(result.error ? new AppError(result.error) : null, result.pages));
    worker.on("error", () => finish(new AppError("The PDF reader could not finish. Try a smaller or freshly exported PDF.")));
    worker.on("exit", () => { if (!settled) finish(new AppError("The PDF reader stopped unexpectedly.")); });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
