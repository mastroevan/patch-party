#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
// Preserve Codex authentication while excluding user tools, MCP servers and hooks.
const args = process.argv.slice(2);
const index = args.indexOf("exec");
if (index < 0) throw new Error("This adapter only supports codex exec.");
args.splice(index + 1, 0, "--ignore-user-config", "--ignore-rules");
const override =
  process.env.PATCH_PARTY_CODEX_PATH || process.env.CODEX_APP_RUNTIME_CLI_PATH;
// Use the SDK's matching CLI instead of an unrelated, potentially retired global CLI.
const sdkRequire = createRequire(import.meta.resolve("@openai/codex-sdk"));
const cli = join(
  dirname(sdkRequire.resolve("@openai/codex/package.json")),
  "bin",
  "codex.js",
);
const child = spawn(
  override || process.execPath,
  override ? args : [cli, ...args],
  {
    stdio: "inherit",
    env: process.env,
  },
);
child.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
