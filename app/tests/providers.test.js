import { test } from "node:test";
import assert from "node:assert/strict";
import { Providers } from "../lib/providers.js";
import { validateAnalysis, analysisPrompt } from "../lib/analysis.js";
import { findings } from "./helpers.js";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("subscription bridge is opt-in and never attempts to collect an OAuth token", async () => {
  let calls = 0;
  const providers = new Providers({ claudeRunner: async () => { calls++; } });
  await assert.rejects(providers.connect({ provider: "claude-code" }), /development preview/);
  assert.equal(calls, 0);
});

test("Claude bridge uses a signed-in session with no tools, project hooks or case path", async () => {
  let command;
  const providers = new Providers({ enableClaudeCode: true, claudeRunner: async (args, input, options) => {
    if (args[0] === "auth") return JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "private@example.invalid" });
    command = { args, input, options };
    return JSON.stringify({ structured_output: { summary: "Test" } });
  } });
  await providers.connect({ provider: "claude-code" });
  assert.equal(JSON.stringify(providers.status()).includes("private@example"), false);
  assert.deepEqual(await providers.analyse("Synthetic document content", new AbortController().signal), { summary: "Test" });
  assert.equal(command.input, "Synthetic document content");
  assert.equal(command.args.includes("Synthetic document content"), false);
  assert.ok(command.args.includes("--safe-mode"));
  assert.ok(command.args.includes("--no-session-persistence"));
  assert.equal(command.args[command.args.indexOf("--tools") + 1], "");
  assert.ok(command.args.includes("--strict-mcp-config"));
});

test("API credentials are session-only, omitted from status, and calls go only to the fixed provider", async () => {
  const requests = [], key = "synthetic-key-for-unit-tests-only";
  const providers = new Providers({ fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return url.includes("/models/") ? json({ id: "test-model" }) : json({ stop_reason: "end_turn", content: [{ type: "text", text: '{"summary":"test"}' }] });
  } });
  await providers.connect({ provider: "anthropic", model: "test-model", apiKey: key });
  assert.equal(JSON.stringify(providers.status()).includes(key), false);
  await providers.analyse("Synthetic document", new AbortController().signal);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, "https://api.anthropic.com/v1/messages");
  assert.equal(requests[1].options.redirect, "error");
  providers.disconnect(); assert.equal(providers.connection, null);
});

test("local mode rejects Ollama cloud models and uses loopback only", async () => {
  const urls = [];
  const providers = new Providers({ fetchImpl: async (url) => {
    urls.push(url);
    return url.endsWith("/tags") ? json({ models: [{ name: "test" }] }) : json({ remote_host: "https://ollama.com" });
  } });
  await assert.rejects(providers.connect({ provider: "ollama", model: "test" }), /locally installed/);
  assert.ok(urls.every((url) => url.startsWith("http://127.0.0.1:11434/")));
  assert.equal(providers.connection, null);
});

test("local model adapter sends a schema and returns structured findings", async () => {
  const providers = new Providers({ fetchImpl: async (url, options) => {
    if (url.endsWith("/tags")) return json({ models: [{ name: "test" }] });
    if (url.endsWith("/show")) return json({ details: { family: "test" } });
    const body = JSON.parse(options.body);
    assert.equal(body.stream, false);
    assert.equal(body.format.type, "object");
    return json({ message: { content: '{"summary":"test"}' } });
  } });
  await providers.connect({ provider: "ollama", model: "test" });
  assert.equal(providers.status().connection.cloud, false);
  assert.equal(await providers.analyse("Synthetic document", new AbortController().signal), '{"summary":"test"}');
});

test("source matching rejects invented passages, invalid dates and single-source inconsistencies", () => {
  const id = "a".repeat(64);
  const documents = [{ id, name: "letter.pdf", pages: [{ page: 1, text: "On 2024-03-19, Alex reported that the changeover did not occur." }] }];
  const result = findings(id);
  result.findings[0].date = "2024-02-31";
  result.findings[1].kind = "inconsistency";
  const checked = validateAnalysis(result, documents);
  assert.deepEqual(checked.findings.map((f) => f.verified), [false, false, false]);
  assert.throws(() => analysisPrompt([{ ...documents[0], pages: [{ page: 1, text: "x".repeat(100_001) }] }]), /Nothing has been sent/);
});
