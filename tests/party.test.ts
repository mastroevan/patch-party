import { test } from "node:test";
import assert from "node:assert/strict";
import { Party } from "../apps/server/party.ts";
import { voteCounts } from "../packages/contracts/index.ts";
import { modifiers, advanceEffect } from "../packages/game/mechanics.ts";
function chat(p: Party, id: string, user: string, text: string) {
  p.dispatch({
    type: "chat",
    message: { id, userId: user, name: user, text, source: "simulated" },
  });
}
test("latest vote replaces previous; duplicate delivery does not revert it", () => {
  const p = new Party();
  p.dispatch({ type: "start" });
  chat(p, "1", "a", "!vote 1");
  chat(p, "2", "a", "!vote 2");
  chat(p, "1", "a", "!vote 1");
  assert.deepEqual(voteCounts(p.state), [0, 1, 0]);
});
test("winner changes rule only at next-round reveal and resets score", () => {
  const p = new Party();
  p.dispatch({ type: "start" });
  p.dispatch({ type: "coin", roundId: p.state.roundId, coinId: 0 });
  chat(p, "1", "a", "!vote 1");
  p.dispatch({ type: "lock" });
  assert.equal(p.state.activeRule, "classic");
  p.tick(45000);
  assert.equal(p.state.phase, "results");
  assert.equal(p.state.score, 10);
  p.dispatch({ type: "next" });
  assert.equal(p.state.activeRule, "gravity");
  p.tick(3000);
  assert.equal(p.state.phase, "playing");
  assert.equal(p.state.round, 2);
  assert.equal(p.state.score, 0);
  assert.equal(p.state.best, 10);
  assert.deepEqual(voteCounts(p.state), [0, 0, 0]);
});
test("pause freezes deadline and ignores collection; reset rejects stale gameplay", () => {
  const p = new Party();
  p.dispatch({ type: "start" });
  const id = p.state.roundId;
  p.dispatch({ type: "pause" });
  p.tick(45000);
  assert.equal(p.state.remainingMs, 45000);
  p.dispatch({ type: "coin", roundId: id, coinId: 0 });
  assert.equal(p.state.score, 0);
  p.dispatch({ type: "pause" });
  p.tick(1000);
  assert.equal(p.state.remainingMs, 44000);
  p.dispatch({ type: "reset" });
  p.dispatch({ type: "start" });
  p.dispatch({ type: "coin", roundId: id, coinId: 0 });
  assert.equal(p.state.score, 0);
  assert.equal(p.state.activeRule, "classic");
});
test("ties choose first slot, no votes select classic, late votes rejected", () => {
  const p = new Party();
  p.dispatch({ type: "start" });
  chat(p, "1", "a", "!vote 2");
  chat(p, "2", "b", "!vote 1");
  p.dispatch({ type: "lock" });
  chat(p, "3", "c", "!vote 2");
  assert.equal(p.state.pendingRule, "gravity");
  assert.deepEqual(voteCounts(p.state), [1, 1, 0]);
  const empty = new Party();
  empty.dispatch({ type: "start" });
  empty.tick(45000);
  assert.equal(empty.state.pendingRule, "classic");
});
test("sample nomination credits its author; unsupported freeform is explicit", () => {
  const p = new Party();
  chat(p, "1", "alice", "!rule coins flip gravity");
  assert.equal(p.state.authors.gravity, "alice");
  chat(p, "2", "bob", "!rule dragons");
  assert.match(p.state.feed.at(-1)!.text, /not supported yet/);
  p.dispatch({ type: "start" });
  chat(p, "3", "bob", "!rule gravity");
  assert.equal(p.state.authors.gravity, "alice");
});
test("coin replay, invalid IDs and respawn spam cannot inflate state", () => {
  const p = new Party();
  p.dispatch({ type: "start" });
  const roundId = p.state.roundId;
  for (const coinId of [0, 0, -1, 8, NaN])
    p.dispatch({ type: "coin", roundId, coinId });
  assert.equal(p.state.score, 10);
  p.dispatch({ type: "death", roundId });
  p.dispatch({ type: "death", roundId });
  assert.equal(p.state.score, 5);
  assert.equal(p.state.deaths, 1);
  p.tick(4000);
  p.dispatch({ type: "coin", roundId, coinId: 0 });
  assert.equal(p.state.score, 15);
});
test("rule modifiers expire and paused effect does not age", () => {
  assert.equal(modifiers("gravity", 3000).gravity, -850);
  assert.equal(modifiers("gravity", 0).gravity, 850);
  assert.equal(modifiers("sprint", 3000).speed, 390);
  assert.equal(modifiers("sprint", 0).speed, 230);
  assert.ok(modifiers("moon", 0).gravity < 850);
  assert.equal(advanceEffect(3000, 500, true), 3000);
  assert.equal(advanceEffect(20, 100, false), 0);
});
