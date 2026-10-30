import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createPartyServer } from "../apps/server/server.ts";
import { artifactHash } from "../apps/server/codex/generate.ts";
import { until } from "./helpers/twitch.ts";
const origin = "http://127.0.0.1:5173",
  key = "recovery-test-operator-key-12345";
async function artifact() {
  const { artifact } = JSON.parse(
    await readFile(
      new URL("../artifacts/baselines/gravity.json", import.meta.url),
      "utf8",
    ),
  );
  artifact.origin = "live-codex";
  artifact.name = "Offline recovery fixture";
  artifact.threadId = "mock-generator";
  artifact.hash = artifactHash(artifact, artifact.intent);
  return artifact;
}
async function start(
  directory: string,
  generated: Awaited<ReturnType<typeof artifact>>,
) {
  const app = createPartyServer({
    origin,
    operatorKey: key,
    storageDirectory: directory,
    generate: async () => generated,
  });
  await app.listen(0);
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  const login = await fetch(base + "/api/operator/session", {
    method: "POST",
    headers: { Origin: origin },
    body: JSON.stringify({ key }),
  });
  const ws = new WebSocket(base.replace("http:", "ws:") + "/ws", {
    headers: {
      Origin: origin,
      Cookie: login.headers.get("set-cookie")!.split(";")[0],
    },
  });
  const first = once(ws, "message");
  await once(ws, "open");
  await first;
  return { app, ws, send: (a: unknown) => ws.send(JSON.stringify(a)) };
}
test("restart restores a fresh lobby and credited library, then explicitly previews and activates a saved rule", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "patch-party-restart-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const generated = await artifact();
  const first = await start(dir, generated);
  let closed = false;
  t.after(() => (closed ? Promise.resolve() : first.app.close()));
  first.send({ type: "mode", mode: "codex" });
  first.send({
    type: "chat",
    message: {
      id: "nominate",
      userId: "alice",
      name: "alice",
      text: "!rule gravity",
      source: "simulated",
    },
  });
  first.send({ type: "start" });
  await until(() => first.app.party.state.phase === "playing");
  first.send({
    type: "chat",
    message: {
      id: "vote",
      userId: "alice",
      name: "alice",
      text: "!vote 1",
      source: "simulated",
    },
  });
  first.send({ type: "lock" });
  await until(() => first.app.party.state.build.status === "ready");
  assert.equal(first.app.party.state.library[0].author, "alice");
  first.send({ type: "finish" });
  first.send({ type: "next" });
  await until(() => first.app.party.state.phase === "reveal");
  first.app.party.tick(3000);
  first.send({
    type: "coin",
    roundId: first.app.party.state.roundId,
    coinId: 0,
  });
  await until(() => first.app.party.state.effects.length > 0);
  await first.app.close();
  closed = true;
  const second = await start(dir, generated);
  t.after(() => second.app.close());
  const s = second.app.party.state;
  assert.equal(s.phase, "lobby");
  assert.equal(s.score, 0);
  assert.equal(s.best, 10);
  assert.equal(s.mode, "codex");
  assert.equal(s.activeArtifact, null);
  assert.equal(s.build.status, "idle");
  assert.deepEqual(s.votes, {});
  assert.deepEqual(s.effects, []);
  assert.equal(s.library[0].hash, generated.hash);
  assert.equal(s.library[0].author, "alice");
  second.send({ type: "load-rule", hash: generated.hash });
  await until(() => s.build.status === "ready");
  assert.equal(s.activeArtifact, null);
  assert.equal(s.pendingAuthor, "alice");
  second.send({ type: "preview-rule" });
  await until(() => s.preview !== null);
  assert.equal(s.preview!.hash, generated.hash);
  assert.equal(s.preview!.samples[1].commands[0].value, -850);
  second.send({ type: "start" });
  await until(() => s.phase === "reveal");
  assert.equal(s.activeArtifact!.hash, generated.hash);
  assert.equal(s.activeArtifact!.origin, "library");
  second.app.party.tick(3000);
  second.send({ type: "coin", roundId: s.roundId, coinId: 0 });
  await until(() => s.effects.length > 0);
  second.send({ type: "revert" });
  await until(() => s.activeRule === "classic");
  assert.deepEqual(s.effects, []);
  assert.equal(s.score, 10);
});

test("a failed save leaves original gameplay and skip recovery available", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "patch-party-save-failure-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const blocked = join(dir, "blocked");
  await writeFile(blocked, "not a directory");
  const f = await start(blocked, await artifact());
  t.after(() => f.app.close());
  f.send({ type: "mode", mode: "codex" });
  f.send({ type: "start" });
  await until(() => f.app.party.state.phase === "playing");
  f.send({
    type: "chat",
    message: {
      id: "vote",
      userId: "alice",
      name: "alice",
      text: "!vote 1",
      source: "simulated",
    },
  });
  f.send({ type: "lock" });
  await until(() => f.app.party.state.build.status === "failed");
  assert.match(f.app.party.state.build.message, /could not be saved/);
  assert.equal(f.app.party.state.phase, "playing");
  f.send({ type: "finish" });
  f.send({ type: "skip-rule" });
  f.send({ type: "next" });
  await until(() => f.app.party.state.phase === "reveal");
  f.app.party.tick(3000);
  assert.equal(f.app.party.state.activeRule, "classic");
});
