import { Worker } from "node:worker_threads";
import { parseExpressionAt } from "acorn";
import type {
  RuleCommand,
  RuleInput,
  RuleIntent,
  GeneratedModule,
} from "../contracts/rules.ts";
export function validateSource(source: string) {
  if (typeof source !== "string" || source.length > 12000)
    throw new Error("Source must be at most 12,000 characters.");
  let ast: any;
  try {
    ast = parseExpressionAt(source, 0, { ecmaVersion: 2022 });
  } catch {
    throw new Error(
      "Source must be one synchronous function expression, with no trailing code.",
    );
  }
  if (
    !["ArrowFunctionExpression", "FunctionExpression"].includes(ast.type) ||
    ast.async ||
    ast.generator ||
    source.slice(ast.end).trim()
  )
    throw new Error(
      "Source must be one synchronous function expression, with no trailing code.",
    );
  const forbidden = new Set([
    "ImportExpression",
    "AwaitExpression",
    "YieldExpression",
    "NewExpression",
    "ThisExpression",
  ]);
  const globals = new Set([
    "globalThis",
    "process",
    "require",
    "fetch",
    "eval",
    "Function",
    "Date",
    "Promise",
    "WebAssembly",
    "setTimeout",
    "setInterval",
    "Math",
  ]);
  function walk(node: any) {
    if (!node || typeof node !== "object") return;
    if (
      forbidden.has(node.type) ||
      (node.type === "Identifier" && globals.has(node.name))
    )
      throw new Error("Unsupported language feature or global.");
    for (const value of Object.values(node))
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
  }
  walk(ast);
}
export function validateCommands(value: unknown): RuleCommand[] {
  if (!Array.isArray(value) || value.length > 1)
    throw new Error("Expected zero or one command.");
  return value.map((c) => {
    if (
      !c ||
      typeof c !== "object" ||
      Object.keys(c).sort().join(",") !== "durationMs,kind,value"
    )
      throw new Error("Invalid command shape.");
    if (
      !["gravity", "speed"].includes(c.kind) ||
      !Number.isFinite(c.value) ||
      !Number.isInteger(c.durationMs) ||
      c.durationMs < 100 ||
      c.durationMs > 45000
    )
      throw new Error("Command outside allowed limits.");
    if (
      (c.kind === "gravity" &&
        (Math.abs(c.value) < 200 || Math.abs(c.value) > 1000)) ||
      (c.kind === "speed" && (c.value < 100 || c.value > 450))
    )
      throw new Error("Movement value outside allowed limits.");
    return { kind: c.kind, value: c.value, durationMs: c.durationMs };
  });
}
export function executeRule(
  source: string,
  inputs: RuleInput[],
  signal?: AbortSignal,
): Promise<RuleCommand[][]> {
  validateSource(source);
  if (signal?.aborted)
    return Promise.reject(new Error("Rule execution cancelled."));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
      workerData: { source, inputs },
      env: {},
      resourceLimits: {
        maxOldGenerationSizeMb: 32,
        maxYoungGenerationSizeMb: 8,
        stackSizeMb: 2,
      },
      execArgv: [],
    });
    let settled = false;
    const finish = (error?: Error, results?: RuleCommand[][]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      void worker.terminate();
      error ? reject(error) : resolve(results!);
    };
    const abort = () => finish(new Error("Rule execution cancelled."));
    const timer = setTimeout(
      () => finish(new Error("Rule worker exceeded its 1-second deadline.")),
      1000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    worker.on("message", (m) => {
      try {
        if (!m.ok) throw new Error(m.error);
        if (!Array.isArray(m.results) || m.results.length !== inputs.length)
          throw new Error("Invalid result count.");
        finish(undefined, m.results.map(validateCommands));
      } catch (e) {
        finish(e as Error);
      }
    });
    worker.on("error", (e) => finish(e));
    worker.on("exit", (code) => {
      if (!settled)
        finish(new Error(`Rule worker exited unexpectedly (${code}).`));
    });
  });
}
export async function validateModule(
  module: GeneratedModule,
  intent: RuleIntent,
  signal?: AbortSignal,
) {
  if (
    !module ||
    typeof module.name !== "string" ||
    module.name.length < 1 ||
    module.name.length > 60 ||
    typeof module.description !== "string" ||
    module.description.length > 200
  )
    throw new Error("Invalid rule manifest.");
  const inputs: RuleInput[] = [];
  for (const round of [1, 2, 17])
    for (let coinCount = 0; coinCount <= 12; coinCount++)
      for (const event of ["coin", "roundStart"] as const)
        inputs.push({ event, coinCount, round });
  const actual = await executeRule(module.source, inputs, signal);
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const applies =
      input.event === intent.hook &&
      (intent.hook === "roundStart" ||
        (input.coinCount > 0 && input.coinCount % intent.every === 0));
    const expected = applies
      ? [
          {
            kind: intent.kind,
            value: intent.value,
            durationMs: intent.durationMs,
          },
        ]
      : [];
    if (JSON.stringify(actual[i]) !== JSON.stringify(expected))
      throw new Error(
        `Behavior mismatch at ${JSON.stringify(input)}; expected ${JSON.stringify(expected)}.`,
      );
  }
  const repeat = await executeRule(module.source, inputs.slice(0, 12), signal);
  if (JSON.stringify(repeat) !== JSON.stringify(actual.slice(0, 12)))
    throw new Error("Rule is not deterministic.");
  return [
    "Synchronous function; restricted language surface",
    "QuickJS isolation: no host/network bindings; 8 MiB memory; 100 ms CPU budget",
    `${inputs.length} trusted behavioral scenarios passed`,
    "Fresh-worker deterministic replay passed",
    "Command shape, magnitude and duration limits passed",
  ];
}
