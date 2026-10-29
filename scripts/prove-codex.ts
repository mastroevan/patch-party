import { randomUUID } from "node:crypto";
import { generateRule, loadSavedRule } from "../apps/server/codex/generate.ts";
import { defaultIntent } from "../packages/contracts/rules.ts";
import { validateModule } from "../packages/rule-runner/index.ts";

const intent = defaultIntent("gravity");
try {
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
} catch (error) {
  console.warn(
    "Live Codex generation not available or credit limit reached:",
    (error as Error).message,
  );
  console.log(
    "Validating saved coin/gravity rule artifact in isolated QuickJS runner...",
  );
  const saved = await loadSavedRule(intent);
  if (!saved) {
    throw new Error("No saved artifact found for intent.");
  }
  const checks = await validateModule(saved, intent);
  console.log(
    JSON.stringify(
      {
        source: "saved-artifact-verified",
        hash: saved.hash,
        threadId: saved.threadId,
        generationMs: saved.generationMs,
        checks,
      },
      null,
      2,
    ),
  );
}
