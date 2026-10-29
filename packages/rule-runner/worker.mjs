import { parentPort, workerData } from "node:worker_threads";
import { getQuickJS } from "quickjs-emscripten";
// This worker has no application environment. No host functions or module loaders
// are installed into QuickJS; generated code never executes in Node's JS realm.
try {
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(8 * 1024 * 1024);
  runtime.setMaxStackSize(128 * 1024);
  const deadline = performance.now() + 100;
  runtime.setInterruptHandler(() => performance.now() > deadline);
  const vm = runtime.newContext();
  try {
    const input = JSON.stringify(workerData.inputs);
    const result = vm.evalCode(
      `"use strict"; const fn = (${workerData.source}); const inputs = ${input}; JSON.stringify(inputs.map(input => fn(Object.freeze(input))));`,
    );
    if (result.error) {
      const err = vm.dump(result.error);
      result.error.dispose();
      const msg =
        typeof err === "string"
          ? err
          : String(err?.message ?? "Rule execution failed");
      throw new Error(msg);
    }
    let output;
    try {
      output = vm.dump(result.value);
    } finally {
      result.value.dispose();
    }
    if (typeof output !== "string" || output.length > 32000)
      throw new Error("Rule output exceeds limit or is not JSON.");
    parentPort.postMessage({ ok: true, results: JSON.parse(output) });
  } finally {
    vm.dispose();
    runtime.dispose();
  }
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: String(error.message ?? error).slice(0, 300),
  });
}
