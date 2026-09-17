import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "./errors.js";
import { SYSTEM_PROMPT, ANALYSIS_SCHEMA } from "./analysis.js";

const TIMEOUT = 180_000;
const MAX_RESPONSE = 1_000_000;

function claudeBinary() {
  const local = join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  return existsSync(local) ? local : "claude";
}

export function runClaude(args, input, { signal, cwd, timeout = TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    // No shell, no document text in process arguments, no tools, no inherited
    // project customisations. Auth stays with the user's own Claude installation.
    const child = spawn(claudeBinary(), args, { cwd, shell: false, windowsHide: true,
      env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "", finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) child.kill("SIGKILL");
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new AppError("Analysis cancelled.", 409));
    const timer = setTimeout(() => finish(new AppError("Claude did not finish in time. Try fewer pages or check your account limits.", 504)), timeout);
    child.stdout.on("data", (part) => {
      output += part;
      if (output.length > MAX_RESPONSE) finish(new AppError("Claude returned too much output. Try a smaller document.", 422));
    });
    child.stderr.on("data", () => {}); // Never persist auth diagnostics or document text.
    child.stdin.on("error", () => {});
    child.on("error", () => finish(new AppError("Claude Code was not found. Install it and sign in separately, then reconnect.", 503)));
    child.on("close", (code) => code === 0 ? finish(null, output) : finish(new AppError("Claude could not complete the request. Check its sign-in, account limits and network connection.", 502)));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    else child.stdin.end(input);
  });
}

async function responseJson(response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(response.status === 401 || response.status === 403
      ? "The provider rejected this connection. Check your credentials and account access."
      : response.status === 429 ? "The provider's usage limit was reached. Wait before retrying."
        : `The provider could not complete the request (HTTP ${response.status}).`, 502);
  }
  const reader = response.body.getReader();
  let bytes = 0, chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_RESPONSE) throw new AppError("The provider response was too large.", 422);
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); }
}

export class Providers {
  constructor({ enableClaudeCode = false, fetchImpl = fetch, claudeRunner = runClaude } = {}) {
    this.enableClaudeCode = enableClaudeCode;
    this.fetch = fetchImpl;
    this.claude = claudeRunner;
    this.connection = null;
  }

  status() {
    const connection = this.connection;
    return { claudeCodeEnabled: this.enableClaudeCode, connection: connection && {
      provider: connection.provider, model: connection.model, cloud: connection.provider !== "ollama",
    } };
  }

  async localModels() {
    // Explicit discovery reads installed names only. It never downloads a model,
    // calls a cloud endpoint, starts an engine, or sends any case content.
    try {
      const result = await responseJson(await this.fetch("http://127.0.0.1:11434/api/tags", {
        method: "GET", signal: AbortSignal.timeout(5_000), redirect: "error",
      }));
      if (!Array.isArray(result.models)) throw new Error("Invalid model list");
      const seen = new Set(), models = [];
      let excludedCloudModels = 0;
      for (const item of result.models) {
        const name = item?.name || item?.model;
        if (typeof name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(name) || seen.has(name)) continue;
        seen.add(name);
        if (/cloud/i.test(name) || item.remote_host || item.remote_model || item.details?.remote_host || item.details?.remote_model) { excludedCloudModels++; continue; }
        models.push({ name });
      }
      models.sort((a, b) => a.name.localeCompare(b.name));
      return { available: true, models, excludedCloudModels, message: models.length
        ? "Choose an installed model below. Check connection will confirm it can run locally."
        : "No local models were found. Install a local model in Ollama, then try again. Case Forge does not include an AI engine or model." };
    } catch {
      return { available: false, models: [], excludedCloudModels: 0,
        message: "Could not reach Ollama on this computer. If it is installed, open it and try again. Otherwise install Ollama and a local model first. Case Forge does not include either." };
    }
  }

  async connect({ provider, model, apiKey }) {
    if (!["claude-code", "anthropic", "ollama"].includes(provider)) throw new AppError("Choose a supported connection.");
    if (provider === "claude-code") {
      if (!this.enableClaudeCode) throw new AppError("Subscription connection is a development preview. Public sign-in is not available yet.", 403);
      const raw = await this.claude(["auth", "status", "--json"], "", { timeout: 10_000, cwd: tmpdir() });
      let auth;
      try { auth = JSON.parse(raw); } catch { throw new AppError("Could not check Claude's sign-in. Open Claude Code and sign in there first.", 503); }
      if (auth.loggedIn !== true || !["oauth", "claude.ai"].includes(auth.authMethod)) throw new AppError("Sign in to Claude Code with your subscription first. An API-key session should use the API connection instead.");
      model = "sonnet";
    } else {
      if (typeof model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(model)) throw new AppError("Enter a valid model name.");
      const signal = AbortSignal.timeout(12_000);
      if (provider === "anthropic") {
        if (typeof apiKey !== "string" || apiKey.length < 20 || apiKey.length > 300 || /\s/.test(apiKey)) throw new AppError("Enter your API key. It is kept in memory for this app session only.");
        const result = await responseJson(await this.fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, {
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, signal, redirect: "error",
        }));
        if (result.id !== model) throw new AppError("That model could not be verified. Enter its full model ID.");
      } else {
        const result = await responseJson(await this.fetch("http://127.0.0.1:11434/api/tags", { signal, redirect: "error" }));
        const found = result.models?.find((item) => item.name === model || item.model === model);
        if (!found) throw new AppError("This model is not installed in Ollama. Enter the name shown in your Ollama app.");
        const info = await responseJson(await this.fetch("http://127.0.0.1:11434/api/show", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }), signal, redirect: "error",
        }));
        if (info.remote_host || info.remote_model || /cloud/i.test(model)) throw new AppError("Choose a locally installed model. Cloud-routed Ollama models are not supported in local mode.");
      }
    }
    this.connection = { provider, model, ...(provider === "anthropic" ? { apiKey } : {}) };
    return this.status();
  }

  disconnect() { this.connection = null; }

  async analyse(prompt, signal, connection = this.connection) {
    if (!connection) throw new AppError("Connect your AI before starting analysis.", 409);
    const { provider, model, apiKey } = connection;
    signal = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]);
    if (provider === "claude-code") {
      const cwd = await mkdtemp(join(tmpdir(), "strategist-claude-"));
      try {
        const output = await this.claude([
          "--safe-mode", "--print", "--output-format", "json", "--model", model,
          "--tools", "", "--permission-mode", "dontAsk", "--no-chrome",
          "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
          "--disable-slash-commands", "--no-session-persistence", "--setting-sources", "",
          "--system-prompt", SYSTEM_PROMPT, "--json-schema", JSON.stringify(ANALYSIS_SCHEMA),
        ], prompt, { signal, cwd });
        const result = JSON.parse(output);
        if (result.is_error) throw new AppError("Claude could not finish analysis. Check its account limits and retry.", 502);
        return result.structured_output || result.result;
      } finally { await rm(cwd, { recursive: true, force: true }); }
    }
    const result = provider === "anthropic"
      ? await responseJson(await this.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", redirect: "error", signal,
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 8192, system: SYSTEM_PROMPT, messages: [{ role: "user", content: prompt }] }),
      }))
      : await responseJson(await this.fetch("http://127.0.0.1:11434/api/chat", {
        method: "POST", redirect: "error", signal, headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, stream: false, format: ANALYSIS_SCHEMA, options: { temperature: 0 },
          messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }] }),
      }));
    if (provider === "anthropic" && result.stop_reason !== "end_turn") throw new AppError("The model stopped before completing its findings. Try a smaller document.", 422);
    return provider === "anthropic" ? result.content?.filter((c) => c.type === "text").map((c) => c.text).join("") : result.message?.content;
  }
}
