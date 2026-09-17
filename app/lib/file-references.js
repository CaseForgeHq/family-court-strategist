import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { AppError } from "./errors.js";
import { readJson, writeJson } from "./files.js";

const DOCUMENT_ID = /^[a-f0-9]{64}$/;
const PREFIX = /^[A-F0-9]{12}$/;
const REFERENCE = /^CF-([A-F0-9]{12})-([0-9]{6,16})$/;
const format = (prefix, number) => `CF-${prefix}-${String(number).padStart(6, "0")}`;

export function isFileReference(value) {
  const match = typeof value === "string" && value.match(REFERENCE);
  if (!match) return false;
  const number = Number(match[2]);
  return Number.isSafeInteger(number) && number > 0 && format(match[1], number) === value;
}

function validateRegistry(value) {
  if (!value || value.version !== 1 || !PREFIX.test(value.prefix) ||
      !Number.isSafeInteger(value.nextNumber) || value.nextNumber < 1 ||
      !value.references || typeof value.references !== "object" || Array.isArray(value.references)) {
    throw new AppError("The file reference register needs recovery. Restore its backup before adding files.", 409);
  }
  const seen = new Set();
  for (const [id, reference] of Object.entries(value.references)) {
    if (!DOCUMENT_ID.test(id) || !isFileReference(reference) || !reference.startsWith(`CF-${value.prefix}-`) ||
        Number(reference.slice(reference.lastIndexOf("-") + 1)) >= value.nextNumber || seen.has(reference)) {
      throw new AppError("The file reference register needs recovery. Restore its backup before adding files.", 409);
    }
    seen.add(reference);
  }
  return value;
}

/**
 * Persistent references for one desktop profile (or one standalone preview case).
 * The caller owns mutation permission. Construction never creates a directory or
 * file. Allocation is synchronous and rereads disk so repeated allocator instances
 * in the single desktop/server process never reuse an allocated number.
 */
export class FileReferences {
  constructor({ root, relativePath = "file-references.json" }) {
    this.root = realpathSync(root);
    this.relativePath = relativePath;
  }

  read() {
    try { return validateRegistry(readJson(this.root, this.relativePath)); }
    catch (error) {
      if (error.code === "ENOENT") return null;
      if (error instanceof SyntaxError) throw new AppError("The file reference register needs recovery. Restore its backup before adding files.", 409);
      throw error;
    }
  }

  allocate(documentId) {
    if (!DOCUMENT_ID.test(documentId)) throw new AppError("A valid document is required for a file reference.", 400);
    const registry = this.read() || { version: 1, prefix: randomBytes(6).toString("hex").toUpperCase(), nextNumber: 1, references: {} };
    if (registry.references[documentId]) return registry.references[documentId];
    if (registry.nextNumber >= Number.MAX_SAFE_INTEGER) throw new AppError("The file reference register has reached its number limit.", 409);
    const reference = format(registry.prefix, registry.nextNumber);
    registry.references[documentId] = reference;
    registry.nextNumber++;
    // Same-directory atomic replacement; the shared storage helpers reject links.
    writeJson(this.root, this.relativePath, registry);
    return reference;
  }
}

export function createFileReferences(options) { return new FileReferences(options); }
