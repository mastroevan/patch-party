import { readFile } from "node:fs/promises";
import { artifactHash } from "../apps/server/codex/generate.ts";
import { request as httpRequest } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createPartyServer } from "../apps/server/server.ts";
import { fixture, flush, until } from "./helpers/twitch.ts";
const ORIGIN = "http://127.0.0.1:5173",
  KEY = "server-operator-test-key-123456";
async function running(options: Parameters<typeof createPartyServer>[0] = {}) {
  const app = createPartyServer({
    operatorKey: KEY,
    origin: ORIGIN,
    ...options,
  });
  await app.listen(0);
  const port = (app.server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/operator/session`, {
    method: "POST",
    headers: { Origin: options.origin || ORIGIN },
    body: JSON.stringify({ key: KEY }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  return { app, base, cookie, ws: `ws://127.0.0.1:${port}` };
}
async function connect(url: string, cookie?: string) {
  const ws = new WebSocket(url, {
    headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
  });
  const first = once(ws, "message");
  await once(ws, "open");
  const [raw] = await first;
  return { ws, first: JSON.parse(String(raw)) };
}

test("operator HTTP and WebSocket access require authentication and reject cross-origin requests", async (t) => {
  const f = await running();
  t.after(() => f.app.close());
  assert.equal((await fetch(`${f.base}/api/twitch/status`)).status, 401);
  assert.equal(
    (
      await fetch(`${f.base}/api/twitch/status`, {
        headers: { Cookie: f.cookie },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${f.base}/api/operator/session`, {
        method: "POST",
        headers: { Origin: "https://evil.test" },
        body: JSON.stringify({ key: KEY }),
      })
    ).status,
    403,
  );
  assert.equal(
    await new Promise<number>((resolve) => {
      const req = httpRequest(
        `${f.base}/api/health`,
        { headers: { Host: "evil.test" } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.end();
    }),
    403,
  );
  const ws = new WebSocket(`${f.ws}/ws`, { headers: { Origin: ORIGIN } });
  const error = await once(ws, "error");
  assert.match(String(error[0]), /401/);
});

test("OBS overlay is redacted, rejects commands, and never takes controller ownership", async (t) => {
  const f = await running();
  t.after(() => f.app.close());
  const overlay = await connect(`${f.ws}/ws/overlay`);
  assert.equal(overlay.first.type, "overlay");
  for (const key of ["votes", "feed", "sessionId", "activeArtifact", "intents"])
    assert.equal(key in overlay.first.state, false);
  overlay.ws.send(JSON.stringify({ type: "start" }));
  const [raw] = await once(overlay.ws, "message");
  assert.equal(JSON.parse(String(raw)).type, "error");
  assert.equal(f.app.party.state.phase, "lobby");
  const operator = await connect(`${f.ws}/ws`, f.cookie);
  assert.equal(operator.first.controller, true);
  operator.ws.send(JSON.stringify({ type: "start" }));
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 20));
  operator.ws.close();
  await once(operator.ws, "close");
  await until(() => f.app.party.state.paused);
  assert.equal(f.app.party.state.paused, true);
  const next = await connect(`${f.ws}/ws`, f.cookie);
  assert.equal(next.first.controller, true);
});

test("OAuth state cookie is single-use; successful broadcaster callback starts live chat without leaking tokens", async (t) => {
  const twitch = await fixture();
  t.after(twitch.cleanup);
  // Remove fixture credentials so server starts disconnected.
  await twitch.auth.clear();
  const f = await running({
    twitch: twitch.config,
    request: twitch.request,
    twitchSocket: twitch.socket,
  });
  t.after(() => f.app.close());
  const begin = await fetch(`${f.base}/api/twitch/authorize`, {
    headers: { Cookie: f.cookie },
    redirect: "manual",
  });
  const authorization = new URL(begin.headers.get("location")!);
  const state = authorization.searchParams.get("state")!;
  const stateCookie = begin.headers.get("set-cookie")!.split(";")[0];
  assert.equal(authorization.hostname, "id.twitch.tv");
  const bad = await fetch(
    `${f.base}/api/twitch/callback?state=wrong&code=foo`,
    { headers: { Cookie: stateCookie } },
  );
  assert.equal(bad.status, 400);
  const url = `${f.base}/api/twitch/callback?state=${state}&code=foo`;
  const result = await fetch(url, {
    headers: { Cookie: stateCookie },
    redirect: "manual",
  });
  assert.equal(result.status, 303);
  assert.equal(result.headers.get("location"), `${ORIGIN}/?twitch=connected`);
  twitch.sockets.at(-1)!.welcome();
  await flush();
  assert.equal(f.app.twitch.status.state, "connected");
  const status = await (
    await fetch(`${f.base}/api/twitch/status`, {
      headers: { Cookie: f.cookie },
    })
  ).text();
  assert.doesNotMatch(
    status,
    /access_token|refresh_token|client-secret|access-\d|refresh-\d/,
  );
  const replay = await fetch(url, {
    headers: { Cookie: stateCookie },
    redirect: "manual",
  });
  assert.equal(replay.status, 400);
});

test("two Twitch identities vote through the server, survive duplicate redelivery, and stay separate from simulated chat", async (t) => {
  const twitch = await fixture();
  t.after(twitch.cleanup);
  // Offline-only generator fixture: never represents actual Twitch or Codex verification.
  const { artifact } = JSON.parse(
    await readFile(
      new URL("../docs/milestone-2/live-evidence.json", import.meta.url),
      "utf8",
    ),
  );
  artifact.name = "Offline test rule";
  artifact.threadId = "mock-generator";
  artifact.hash = artifactHash(artifact, artifact.intent);
  const f = await running({
    generate: async () => artifact,
    twitch: twitch.config,
    request: twitch.request,
    twitchSocket: twitch.socket,
  });
  t.after(() => f.app.close());
  await until(() => twitch.sockets.length > 0);
  twitch.sockets[0].welcome();
  await until(() => f.app.twitch.status.state === "connected");
  const operator = await connect(`${f.ws}/ws`, f.cookie);
  twitch.sockets[0].notification("propose", "alice", "!rule gravity");
  assert.equal(f.app.party.state.authors.gravity, "alice");
  operator.ws.send(JSON.stringify({ type: "mode", mode: "codex" }));
  operator.ws.send(JSON.stringify({ type: "start" }));
  await until(() => f.app.party.state.phase === "playing");
  f.app.party.state.activeArtifact = {
    ...artifact,
    hash: "previous-round-artifact",
  };
  twitch.sockets[0].notification("v1", "alice", "!vote 1");
  twitch.sockets[0].notification("v2", "bob", "!vote 1");
  twitch.sockets[0].notification("v3", "alice", "!vote 2");
  twitch.sockets[0].notification("v1", "alice", "!vote 1");
  assert.deepEqual(f.app.party.state.votes, {
    "twitch:alice": 1,
    "twitch:bob": 0,
  });
  operator.ws.send(
    JSON.stringify({
      type: "chat",
      message: {
        id: "spoof",
        userId: "alice",
        name: "alice",
        text: "!vote 3",
        source: "twitch",
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(f.app.party.state.votes, {
    "twitch:alice": 1,
    "twitch:bob": 0,
  });
  operator.ws.send(JSON.stringify({ type: "lock" }));
  await until(() => f.app.party.state.ballot === "locked");
  assert.equal(f.app.party.state.pendingRule, "gravity");
  const evidence = await (
    await fetch(`${f.base}/api/twitch/proof`, { headers: { Cookie: f.cookie } })
  ).json();
  assert.equal(evidence.distinctViewers, 2);
  assert.equal(evidence.ballotLocked, true);
  assert.equal(evidence.broadcastCaptureReviewed, false);
  assert.equal(evidence.activeHash, null); // An older live artifact cannot satisfy this ballot's proof.
  await until(() => f.app.party.state.build.status === "ready");
  operator.ws.send(JSON.stringify({ type: "finish" }));
  operator.ws.send(JSON.stringify({ type: "next" }));
  await until(() => f.app.party.state.phase === "reveal");
  f.app.party.tick(3000);
  operator.ws.send(
    JSON.stringify({
      type: "coin",
      roundId: f.app.party.state.roundId,
      coinId: 0,
    }),
  );
  await until(() => f.app.party.state.effects.length > 0);
  const activated = await (
    await fetch(`${f.base}/api/twitch/proof`, { headers: { Cookie: f.cookie } })
  ).json();
  assert.equal(activated.activeHash, artifact.hash);
  assert.equal(activated.acceptedHash, artifact.hash);
  assert.equal(activated.effectObserved, true);
  assert.notEqual(activated.ballotRoundId, f.app.party.state.roundId);
});

test("HTTPS origin uses Secure cookies and preserves the exact HTTPS Twitch callback", async (t) => {
  const twitch = await fixture();
  t.after(twitch.cleanup);
  const origin = "https://127.0.0.1:5173";
  const f = await running({
    origin,
    twitch: { ...twitch.config, redirectUri: `${origin}/api/twitch/callback` },
    request: twitch.request,
    twitchSocket: twitch.socket,
  });
  t.after(() => f.app.close());
  const login = await fetch(`${f.base}/api/operator/session`, {
    method: "POST",
    headers: { Origin: origin },
    body: JSON.stringify({ key: KEY }),
  });
  const cookie = login.headers.get("set-cookie")!;
  assert.match(cookie, /; Secure/);
  const begin = await fetch(`${f.base}/api/twitch/authorize`, {
    headers: { Cookie: cookie.split(";")[0] },
    redirect: "manual",
  });
  assert.match(begin.headers.get("set-cookie")!, /; Secure/);
  assert.equal(
    new URL(begin.headers.get("location")!).searchParams.get("redirect_uri"),
    `${origin}/api/twitch/callback`,
  );
});
