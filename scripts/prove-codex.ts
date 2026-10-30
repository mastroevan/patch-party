import { randomUUID } from "node:crypto";
import { generateRule, loadSavedRule } from "../apps/server/codex/generate.ts";
import { defaultIntent } from "../packages/contracts/rules.ts";
import { validateModule } from "../packages/rule-runner/index.ts";

const intent = defaultIntent("gravity");
if (!process.argv.includes("--saved")) {
  console.log("Attempting live Codex SDK generation...");
  const artifact = await generateRule({
    jobId: randomUUID(),
    proposal: "Every coin flips gravity for 3 seconds",
    intent,
    signal: AbortSignal.timeout(120000),
    onProgress: (update) => console.log(JSON.stringify(update)),
  });
  console.log("Live Codex generation succeeded!");
  console.log(
    JSON.stringify(
      {
        source: "live-codex",
        hash: artifact.hash,
        threadId: artifact.threadId,
        generationMs: artifact.generationMs,
        checks: artifact.checks,
      },
      null,
      2,
    ),
  );
} else {
  const saved = await loadSavedRule(intent);
  if (!saved) throw new Error("No saved artifact found for intent.");
  const checks = await validateModule(saved, intent);
  console.log(
    JSON.stringify(
      { source: "saved-artifact-verified", hash: saved.hash, checks },
      null,
      2,
    ),
  );
}
