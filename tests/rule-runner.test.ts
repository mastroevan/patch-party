import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSource,
  validateCommands,
  executeRule,
  validateModule,
} from "../packages/rule-runner/index.ts";
import { defaultIntent } from "../packages/contracts/rules.ts";

test("validateSource accepts valid pure synchronous function expressions", () => {
  assert.doesNotThrow(() => validateSource("function(input) { return []; }"));
  assert.doesNotThrow(() => validateSource("(input) => []"));
  assert.doesNotThrow(() =>
    validateSource(
      "function(input) { if (input.event === 'coin' && input.coinCount > 0) return [{kind: 'gravity', value: -850, durationMs: 3000}]; return []; }",
    ),
  );
});

test("validateSource rejects non-function expressions, async, generators, and trailing code", () => {
  assert.throws(
    () => validateSource("const x = 1;"),
    /one synchronous function expression/,
  );
  assert.throws(
    () => validateSource("42"),
    /one synchronous function expression/,
  );
  assert.throws(
    () => validateSource("{ a: 1 }"),
    /one synchronous function expression/,
  );
  assert.throws(
    () => validateSource("async function(input) {}"),
    /one synchronous function expression/,
  );
  assert.throws(
    () => validateSource("function*(input) {}"),
    /one synchronous function expression/,
  );
  assert.throws(
    () => validateSource("function(input) {} ; 123"),
    /no trailing code/,
  );
});

test("validateSource rejects forbidden AST nodes and globals", () => {
  assert.throws(
    () => validateSource("function(input) { return new Array(); }"),
    /Unsupported language feature/,
  );
  assert.throws(
    () => validateSource("function(input) { return this.x; }"),
    /Unsupported language feature/,
  );
  assert.throws(
    () => validateSource("function(input) { return Math.random(); }"),
    /Unsupported language feature/,
  );
  assert.throws(
    () => validateSource("function(input) { return Date.now(); }"),
    /Unsupported language feature/,
  );
  assert.throws(
    () =>
      validateSource("function(input) { return fetch('http://evil.com'); }"),
    /Unsupported language feature/,
  );
  assert.throws(
    () => validateSource("function(input) { return eval('1'); }"),
    /Unsupported language feature/,
  );
  assert.throws(
    () => validateSource("function(input) { return process.env; }"),
    /Unsupported language feature/,
  );
  assert.throws(
    () => validateSource("function(input) { return globalThis; }"),
    /Unsupported language feature/,
  );
});

test("validateCommands validates shape, kinds, magnitude and durations", () => {
  assert.deepEqual(validateCommands([]), []);
  assert.deepEqual(
    validateCommands([{ kind: "gravity", value: -850, durationMs: 3000 }]),
    [{ kind: "gravity", value: -850, durationMs: 3000 }],
  );
  assert.deepEqual(
    validateCommands([{ kind: "speed", value: 390, durationMs: 3000 }]),
    [{ kind: "speed", value: 390, durationMs: 3000 }],
  );

  // Rejects multiple commands
  assert.throws(
    () =>
      validateCommands([
        { kind: "gravity", value: -850, durationMs: 3000 },
        { kind: "speed", value: 390, durationMs: 3000 },
      ]),
    /Expected zero or one command/,
  );

  // Rejects invalid shapes
  assert.throws(
    () => validateCommands([{ kind: "gravity", value: -850 }]),
    /Invalid command shape/,
  );
  assert.throws(
    () =>
      validateCommands([
        { kind: "gravity", value: -850, durationMs: 3000, extra: true },
      ]),
    /Invalid command shape/,
  );

  // Rejects out of range gravity (magnitude must be 200..1000)
  assert.throws(
    () =>
      validateCommands([{ kind: "gravity", value: -100, durationMs: 3000 }]),
    /Movement value outside allowed limits/,
  );
  assert.throws(
    () =>
      validateCommands([{ kind: "gravity", value: 1200, durationMs: 3000 }]),
    /Movement value outside allowed limits/,
  );

  // Rejects out of range speed (100..450)
  assert.throws(
    () => validateCommands([{ kind: "speed", value: 50, durationMs: 3000 }]),
    /Movement value outside allowed limits/,
  );
  assert.throws(
    () => validateCommands([{ kind: "speed", value: 500, durationMs: 3000 }]),
    /Movement value outside allowed limits/,
  );

  // Rejects out of range duration (100..45000)
  assert.throws(
    () => validateCommands([{ kind: "gravity", value: -850, durationMs: 50 }]),
    /Command outside allowed limits/,
  );
  assert.throws(
    () =>
      validateCommands([{ kind: "gravity", value: -850, durationMs: 50000 }]),
    /Command outside allowed limits/,
  );
});

test("executeRule runs pure code in isolated QuickJS worker", async () => {
  const source = `function(input) {
    if (input.event === "coin" && input.coinCount > 0) {
      return [{ kind: "gravity", value: -850, durationMs: 3000 }];
    }
    return [];
  }`;

  const results = await executeRule(source, [
    { event: "coin", coinCount: 1, round: 1 },
    { event: "coin", coinCount: 0, round: 1 },
    { event: "roundStart", coinCount: 0, round: 1 },
  ]);

  assert.equal(results.length, 3);
  assert.deepEqual(results[0], [
    { kind: "gravity", value: -850, durationMs: 3000 },
  ]);
  assert.deepEqual(results[1], []);
  assert.deepEqual(results[2], []);
});

test("executeRule terminates infinite loops within CPU deadline", async () => {
  const badSource = "function(input) { while (true) {} }";
  await assert.rejects(async () => {
    await executeRule(badSource, [{ event: "coin", coinCount: 1, round: 1 }]);
  }, /interrupted|exceeded its 1-second deadline/);
});

test("executeRule respects AbortSignal", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(async () => {
    await executeRule(
      "function(input) { return []; }",
      [{ event: "coin", coinCount: 1, round: 1 }],
      controller.signal,
    );
  }, /Rule execution cancelled/);
});

test("validateModule checks trusted scenarios and determinism", async () => {
  const gravityModule = {
    name: "Gravity Flip",
    description: "Every coin flips gravity for 3 seconds.",
    source: `function(input) {
      if (input.event === "coin" && input.coinCount > 0 && input.coinCount % 1 === 0) {
        return [{ kind: "gravity", value: -850, durationMs: 3000 }];
      }
      return [];
    }`,
  };

  const checks = await validateModule(gravityModule, defaultIntent("gravity"));
  assert.equal(checks.length, 5);
  assert.match(checks[2], /78 trusted behavioral scenarios passed/);

  // Mismatched behavior should be rejected
  const mismatched = {
    name: "Broken Flip",
    description: "Returns wrong value",
    source: `function(input) {
      if (input.event === "coin" && input.coinCount > 0) {
        return [{ kind: "gravity", value: -500, durationMs: 3000 }];
      }
      return [];
    }`,
  };

  await assert.rejects(async () => {
    await validateModule(mismatched, defaultIntent("gravity"));
  }, /Behavior mismatch/);
});
