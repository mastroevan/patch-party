import { test } from "node:test";
import assert from "node:assert/strict";
import { Party } from "../apps/server/party.ts";
import {
  RuleCoordinator,
  type Generator,
} from "../apps/server/codex/coordinator.ts";
import {
  defaultIntent,
  type AcceptedRule,
} from "../packages/contracts/rules.ts";

function createMockArtifact(
  slot: "gravity" | "moon" | "sprint" = "gravity",
): AcceptedRule {
  const intent = defaultIntent(slot);
  return {
    name: slot === "gravity" ? "Gravity Glitch" : "Sugar Rush",
    description: intent.description,
    source:
      slot === "gravity"
        ? `function(input) {
            if (input.event === "coin" && input.coinCount > 0 && input.coinCount % 1 === 0) {
              return [{ kind: "gravity", value: -850, durationMs: 3000 }];
            }
            return [];
          }`
        : `function(input) {
            if (input.event === "coin" && input.coinCount > 0 && input.coinCount % 1 === 0) {
              return [{ kind: "speed", value: 390, durationMs: 3000 }];
            }
            return [];
          }`,
    hash: "test-hash-" + slot,
    threadId: "test-thread-id",
    createdAt: new Date().toISOString(),
    intent,
    checks: ["Mock checks passed"],
    generationMs: 1200,
  };
}

test("coordinator does not trigger build when mode is samples", () => {
  const p = new Party();
  let called = false;
  const mockGen: Generator = async () => {
    called = true;
    return createMockArtifact();
  };
  const coordinator = new RuleCoordinator(p, () => {}, mockGen);

  p.dispatch({ type: "start" });
  p.dispatch({
    type: "chat",
    message: {
      id: "1",
      userId: "u1",
      name: "alice",
      text: "!vote 1",
      source: "simulated",
    },
  });
  p.dispatch({ type: "lock" });

  coordinator.reconcile();
  assert.equal(called, false);
  assert.equal(p.state.build.status, "idle");
  coordinator.dispose();
});

test("coordinator starts build and marks ready on success in codex mode", async () => {
  const p = new Party();
  p.dispatch({ type: "mode", mode: "codex" });

  let progressReported = false;
  const mockGen: Generator = async (req) => {
    req.onProgress({ message: "Writing code..." });
    progressReported = true;
    return createMockArtifact("gravity");
  };

  let changeCount = 0;
  const coordinator = new RuleCoordinator(
    p,
    () => {
      changeCount++;
    },
    mockGen,
  );

  p.dispatch({ type: "start" });
  p.dispatch({
    type: "chat",
    message: {
      id: "1",
      userId: "u1",
      name: "alice",
      text: "!vote 1",
      source: "simulated",
    },
  });
  p.dispatch({ type: "lock" });

  coordinator.reconcile();
  assert.equal(p.state.build.status, "generating");
  assert.equal(progressReported, true);

  await coordinator.settled();
  assert.equal(p.state.build.status, "ready");
  assert.ok(p.state.build.artifact);
  assert.equal(p.state.build.artifact.name, "Gravity Glitch");
  assert.ok(changeCount > 0);
  coordinator.dispose();
});

test("coordinator marks build failed when generator throws, allowing skip or retry", async () => {
  const p = new Party();
  p.dispatch({ type: "mode", mode: "codex" });

  let attempts = 0;
  const mockGen: Generator = async () => {
    attempts++;
    if (attempts === 1) throw new Error("Rate limit / Credit exhaustion");
    return createMockArtifact("gravity");
  };

  const coordinator = new RuleCoordinator(p, () => {}, mockGen);

  p.dispatch({ type: "start" });
  p.dispatch({
    type: "chat",
    message: {
      id: "1",
      userId: "u1",
      name: "alice",
      text: "!vote 1",
      source: "simulated",
    },
  });
  p.dispatch({ type: "lock" });

  coordinator.reconcile();
  await coordinator.settled();

  assert.equal(p.state.build.status, "failed");
  assert.match(p.state.build.message, /Credit exhaustion/);

  // Results phase cannot advance next round while build is failed
  p.dispatch({ type: "finish" });
  p.dispatch({ type: "next" });
  assert.equal(p.state.phase, "results"); // next was blocked

  // Streamer can retry build
  p.dispatch({ type: "retry-build" });
  assert.equal(p.state.build.status, "idle");
  coordinator.reconcile();
  await coordinator.settled();

  assert.equal(p.state.build.status, "ready");
  assert.equal(attempts, 2);

  // Now next round is allowed
  p.dispatch({ type: "next" });
  assert.equal(p.state.phase, "reveal");
  coordinator.dispose();
});

test("coordinator handles cancel-build action", async () => {
  const p = new Party();
  p.dispatch({ type: "mode", mode: "codex" });

  let wasAborted = false;
  const mockGen: Generator = (req) => {
    return new Promise((_, reject) => {
      req.signal.addEventListener("abort", () => {
        wasAborted = true;
        reject(new Error("Cancelled"));
      });
    });
  };

  const coordinator = new RuleCoordinator(p, () => {}, mockGen);

  p.dispatch({ type: "start" });
  p.dispatch({
    type: "chat",
    message: {
      id: "1",
      userId: "u1",
      name: "alice",
      text: "!vote 1",
      source: "simulated",
    },
  });
  p.dispatch({ type: "lock" });

  coordinator.reconcile();
  assert.equal(p.state.build.status, "generating");

  p.dispatch({ type: "cancel-build" });
  assert.equal(p.state.build.status, "cancelled");
  coordinator.reconcile();

  assert.equal(wasAborted, true);
  coordinator.dispose();
});

test("coordinator handles generation timeout", async () => {
  const p = new Party();
  p.dispatch({ type: "mode", mode: "codex" });

  const slowGen: Generator = () => new Promise(() => {}); // never resolves
  const coordinator = new RuleCoordinator(p, () => {}, slowGen, 50); // 50ms deadline

  p.dispatch({ type: "start" });
  p.dispatch({
    type: "chat",
    message: {
      id: "1",
      userId: "u1",
      name: "alice",
      text: "!vote 1",
      source: "simulated",
    },
  });
  p.dispatch({ type: "lock" });

  coordinator.reconcile();
  assert.equal(p.state.build.status, "generating");

  await new Promise((r) => setTimeout(r, 80));
  assert.equal(p.state.build.status, "failed");
  assert.match(p.state.build.message, /timed out/);
  coordinator.dispose();
});

test("coordinator useSavedRule loads library artifact and marks ready", async () => {
  const p = new Party();
  p.dispatch({ type: "mode", mode: "codex" });
  p.dispatch({ type: "start" });
  p.dispatch({
    type: "chat",
    message: {
      id: "1",
      userId: "u1",
      name: "alice",
      text: "!vote 1",
      source: "simulated",
    },
  });
  p.dispatch({ type: "lock" });

  const failingGen: Generator = async () => {
    throw new Error("Out of credits");
  };
  const coordinator = new RuleCoordinator(p, () => {}, failingGen);

  coordinator.reconcile();
  await coordinator.settled();
  assert.equal(p.state.build.status, "failed");

  // Load saved rule
  const loaded = await coordinator.useSavedRule();
  assert.equal(loaded, true);
  assert.equal(p.state.build.status, "ready");
  assert.match(p.state.build.message, /Loaded verified rule from library/);
  assert.ok(p.state.build.artifact);
  assert.equal(p.state.build.artifact.intent.slot, "gravity");
  coordinator.dispose();
});

test("active artifact execution applies effects and safely handles runtime error", async () => {
  const p = new Party();
  p.dispatch({ type: "mode", mode: "codex" });

  const buggyArtifact = createMockArtifact("gravity");
  // Faulty code that throws at runtime
  buggyArtifact.source = `function(input) {
    if (input.coinCount > 1) throw "Unexpected division by zero in physics";
    return [{ kind: "gravity", value: -850, durationMs: 3000 }];
  }`;

  const coordinator = new RuleCoordinator(
    p,
    () => {},
    async () => buggyArtifact,
  );

  p.dispatch({ type: "start" });
  p.dispatch({
    type: "chat",
    message: {
      id: "1",
      userId: "u1",
      name: "alice",
      text: "!vote 1",
      source: "simulated",
    },
  });
  p.dispatch({ type: "lock" });
  coordinator.reconcile();
  await coordinator.settled();

  // Advance to reveal and next round
  p.dispatch({ type: "finish" });
  p.dispatch({ type: "next" });
  assert.equal(p.state.phase, "reveal");
  p.tick(3000);
  assert.equal(p.state.phase, "playing");
  assert.ok(p.state.activeArtifact);

  // First coin: works normally
  coordinator.event({ event: "coin", coinCount: 1, round: p.state.round });
  await coordinator.settled();
  assert.equal(p.state.effects.length, 1);
  assert.equal(p.state.effects[0].kind, "gravity");
  assert.equal(p.state.effects[0].value, -850);

  // Second coin: triggers runtime error
  coordinator.event({ event: "coin", coinCount: 2, round: p.state.round });
  await coordinator.settled();

  // Rule is safely disabled, classic restored, gameplay unharmed
  assert.equal(p.state.activeArtifact, null);
  assert.equal(p.state.activeRule, "classic");
  assert.equal(p.state.effects.length, 0);
  assert.match(p.state.runtimeError!, /Unexpected division by zero/);
  coordinator.dispose();
});
