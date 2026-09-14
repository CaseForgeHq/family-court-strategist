#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FactRegistry } from "./lib/facts.js";
import { readLocal } from "./lib/files.js";

export const FACT_HELP = `Case Forge verified facts

Usage: case-forge facts <case-folder> <command> [arguments]
  list
  show FACT-00001
  propose input.json
  verify FACT-00001 review.json
  conflict FACT-00001 conflict.json
  resolve FACT-00001 resolution.json
  check
  render template.md
  export template.md new-output.md

Input JSON paths are relative to your working directory. Templates, sources and
exports are relative to the case folder. Export only creates a new file.
Verify and resolve require explicit human review; AI agents must not self-verify.
See _system/verified-facts.md in the toolkit for the schema and examples.`;

export function factsMain(args) {
  if (!args.length || args.includes("--help")) { console.log(FACT_HELP); return; }
  const [folder, command, ...rest] = args;
  const arity = { list: 0, show: 1, propose: 1, verify: 2, conflict: 2, resolve: 2, check: 0, render: 1, export: 2 };
  if (!Object.hasOwn(arity, command) || rest.length !== arity[command]) throw new Error(FACT_HELP);
  const registry = new FactRegistry(folder);
  const input = (path) => {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an input JSON object.");
    return value;
  };
  let result;
  if (command === "list") result = registry.list();
  if (command === "show") result = registry.get(rest[0]);
  if (command === "propose") result = registry.propose(input(rest[0]));
  if (["verify", "conflict", "resolve"].includes(command)) result = registry[command](rest[0], input(rest[1]));
  if (command === "check") { result = registry.check(); if (!result.ok) process.exitCode = 1; }
  if (command === "render") {
    result = registry.render(readLocal(registry.root, rest[0]).toString("utf8"));
  }
  if (command === "export") result = registry.export(...rest);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { factsMain(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
