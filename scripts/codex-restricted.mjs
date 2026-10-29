#!/usr/bin/env node
import { spawn } from "node:child_process";
// SDK adapter: preserve normal Codex auth while excluding user tools, MCP servers,
// hooks, rules and shell access from untrusted viewer-driven coding tasks.
const args = process.argv.slice(2);
const index = args.indexOf("exec");
if (index < 0) throw new Error("This adapter only supports codex exec.");
args.splice(index + 1, 0, "--ignore-user-config", "--ignore-rules");
const child = spawn(process.env.PATCH_PARTY_CODEX_PATH || "codex", args, {
  stdio: "inherit",
  env: process.env,
});
child.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
