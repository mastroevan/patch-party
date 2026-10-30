import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuleLibrary } from "../apps/server/library.ts";

async function baseline(slot = "gravity") {
  return JSON.parse(
    await readFile(
      new URL(`../artifacts/baselines/${slot}.json`, import.meta.url),
      "utf8",
    ),
  ).artifact;
}
async function directory(t: any) {
  const dir = await mkdtemp(join(tmpdir(), "patch-party-library-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
test("accepted rules persist with author credit and are checked again before library reuse", async (t) => {
  const dir = await directory(t),
    rule = await baseline(),
    library = new RuleLibrary(dir);
  await library.save(rule, "alice", "gravity");
  assert.equal(
    (await stat(join(dir, `rule-${rule.hash}.json`))).mode & 0o777,
    0o600,
  );
  const restarted = new RuleLibrary(dir);
  const restored = await restarted.restore();
  assert.equal(restored.warning, null);
  assert.equal(restarted.summaries()[0].author, "alice");
  const loaded = await restarted.load(rule.hash);
  assert.equal(loaded.artifact.origin, "library");
  assert.equal(loaded.artifact.source, rule.source);
  assert.match(
    loaded.artifact.checks[2],
    /trusted behavioral scenarios passed/,
  );
});
test("corrupt and tampered saved rules are skipped while other saved rules remain usable", async (t) => {
  const dir = await directory(t),
    gravity = await baseline(),
    moon = await baseline("moon"),
    library = new RuleLibrary(dir);
  await library.save(gravity, "alice", "gravity");
  await library.save(moon, "bob", "moon");
  const path = join(dir, `rule-${gravity.hash}.json`),
    record = JSON.parse(await readFile(path, "utf8"));
  record.artifact.source = "function(input) { while(true) {} }";
  await writeFile(path, JSON.stringify(record));
  await writeFile(join(dir, `rule-${"a".repeat(64)}.json`), "{broken");
  const restarted = new RuleLibrary(dir);
  const result = await restarted.restore();
  assert.match(result.warning!, /integrity/);
  assert.equal(restarted.summaries().length, 1);
  assert.equal((await restarted.load(moon.hash)).author, "bob");
  await assert.rejects(restarted.load(gravity.hash), /unavailable/);
});
test("only lobby preferences persist; malformed preferences start clean without losing rules", async (t) => {
  const dir = await directory(t),
    rule = await baseline(),
    library = new RuleLibrary(dir);
  await library.save(rule, "alice", "gravity");
  await library.savePreferences(80, "codex");
  const restored = await new RuleLibrary(dir).restore();
  assert.deepEqual(restored.preferences, {
    version: 1,
    best: 80,
    mode: "codex",
  });
  await writeFile(
    join(dir, "lobby.json"),
    JSON.stringify({ version: 1, best: -10, mode: "codex", phase: "playing" }),
  );
  const restarted = new RuleLibrary(dir);
  const bad = await restarted.restore();
  assert.equal(bad.preferences, null);
  assert.match(bad.warning!, /clean lobby/);
  assert.equal(restarted.summaries().length, 1);
});

test("earlier accepted artifacts migrate without changing originals or inventing author credit", async (t) => {
  const dir = await directory(t),
    legacy = await directory(t),
    rule = await baseline();
  const original = JSON.stringify({
    artifact: rule,
    prompt: "earlier accepted record",
  });
  await writeFile(join(legacy, `${rule.hash}.json`), original);
  const library = new RuleLibrary(dir);
  await library.importArtifacts(legacy);
  assert.equal(library.summaries()[0].author, "community");
  assert.equal((await library.load(rule.hash)).artifact.origin, "library");
  assert.equal(
    await readFile(join(legacy, `${rule.hash}.json`), "utf8"),
    original,
  );
});
