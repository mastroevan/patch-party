import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProposal, defaultIntent } from "../packages/contracts/rules.ts";
import { Party } from "../apps/server/party.ts";

test("parseProposal handles simple named rules", () => {
  const gravity = parseProposal("gravity");
  assert.ok(gravity);
  assert.equal(gravity.slot, "gravity");
  assert.equal(gravity.kind, "gravity");
  assert.equal(gravity.value, -850);
  assert.equal(gravity.durationMs, 3000);
  assert.equal(gravity.every, 1);

  const moon = parseProposal("moon boots");
  assert.ok(moon);
  assert.equal(moon.slot, "moon");
  assert.equal(moon.hook, "roundStart");
  assert.equal(moon.value, 430);

  const sprint = parseProposal("sprint");
  assert.ok(sprint);
  assert.equal(sprint.slot, "sprint");
  assert.equal(sprint.kind, "speed");
  assert.equal(sprint.value, 390);
});

test("parseProposal handles custom intervals and durations", () => {
  const customGravity = parseProposal(
    "every second coin flips gravity for 2 seconds",
  );
  assert.ok(customGravity);
  assert.equal(customGravity.slot, "gravity");
  assert.equal(customGravity.every, 2);
  assert.equal(customGravity.durationMs, 2000);
  assert.equal(customGravity.value, -850);

  const customSprint = parseProposal(
    "every third coin boosts speed for 5 seconds",
  );
  assert.ok(customSprint);
  assert.equal(customSprint.slot, "sprint");
  assert.equal(customSprint.every, 3);
  assert.equal(customSprint.durationMs, 5000);
  assert.equal(customSprint.value, 390);
});

test("parseProposal rejects unsupported mechanics", () => {
  assert.equal(parseProposal("dragons"), null);
  assert.equal(parseProposal("fly into space"), null);
  assert.equal(parseProposal("give me 1000 coins"), null);
  assert.equal(parseProposal("every coin flips gravity for 10 seconds"), null); // > 5 seconds
  assert.equal(
    parseProposal("every fourth coin flips gravity for 2 seconds"),
    null,
  ); // fourth not supported
});

test("party chat enforces samples mode vs codex mode for custom proposals", () => {
  const p = new Party();
  // In samples mode, custom proposals are rejected
  p.dispatch({
    type: "chat",
    message: {
      id: "1",
      userId: "u1",
      name: "alice",
      text: "!rule every second coin flips gravity for 2 seconds",
      source: "simulated",
    },
  });
  assert.match(
    p.state.feed.at(-1)!.text,
    /Custom parameters require Live Codex mode/,
  );

  // Switch to codex mode in lobby
  p.dispatch({ type: "mode", mode: "codex" });
  assert.equal(p.state.mode, "codex");

  // In codex mode, custom proposal is accepted
  p.dispatch({
    type: "chat",
    message: {
      id: "2",
      userId: "u1",
      name: "alice",
      text: "!rule every second coin flips gravity for 2 seconds",
      source: "simulated",
    },
  });
  assert.equal(p.state.authors.gravity, "alice");
  assert.equal(p.state.intents.gravity.every, 2);
  assert.equal(p.state.intents.gravity.durationMs, 2000);
});
