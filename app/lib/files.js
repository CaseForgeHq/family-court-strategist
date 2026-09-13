import { constants, lstatSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, realpathSync, rmSync } from "node:fs";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";

// All application-owned writes use generated path components beneath the selected
// case. Refuse symlinks, including a replaced case root, instead of following them.
export function caseRoot(path) {
  const root = realpathSync(path);
  if (!lstatSync(root).isDirectory()) throw new AppError("Choose a case folder.");
  return root;
}

export function safePath(root, rel, createParents = false) {
  if (realpathSync(root) !== root || lstatSync(root).isSymbolicLink()) throw new AppError("The case folder has changed. Reopen it before continuing.", 409);
  const full = resolve(root, rel);
  const inside = relative(root, full);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new AppError("Invalid case file path.");
  const parts = inside.split(/[\\/]/);
  let cursor = root;
  for (let i = 0; i < parts.length; i++) {
    cursor = join(cursor, parts[i]);
    let st;
    try { st = lstatSync(cursor); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (i < parts.length - 1 && createParents) mkdirSync(cursor, { mode: 0o700 });
      continue;
    }
    if (st.isSymbolicLink() || (i < parts.length - 1 && !st.isDirectory())) throw new AppError("A case storage path is a link or is not a folder. Choose a regular case folder.", 409);
  }
  return full;
}

export function readLocal(root, rel) {
  const file = safePath(root, rel);
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try { return readFileSync(fd); } finally { closeSync(fd); }
}

export function writeNew(root, rel, data) {
  const file = safePath(root, rel, true);
  writeFileSync(file, data, { flag: "wx", mode: 0o600 });
  return file;
}

export function writeJson(root, rel, value) {
  const target = safePath(root, rel, true);
  const temp = join(dirname(target), `.pending-${randomUUID()}`);
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    safePath(root, rel);
    renameSync(temp, target);
  } finally { rmSync(temp, { force: true }); }
}

export function readJson(root, rel) {
  return JSON.parse(readLocal(root, rel).toString("utf8"));
}
