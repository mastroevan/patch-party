import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import {
  TwitchAuth,
  AuthorizationRequired,
} from "../apps/server/twitch/auth.ts";
import {
  TwitchChat,
  safeReconnectUrl,
} from "../apps/server/twitch/eventsub.ts";
import { Party } from "../apps/server/party.ts";
import { fixture, flush, until } from "./helpers/twitch.ts";

test("OAuth uses read-only chat scope; stored tokens are private and validated on restore", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const url = new URL(f.auth.authorizeUrl("csrf-state"));
  assert.equal(url.searchParams.get("scope"), "user:read:chat");
  assert.equal(url.searchParams.get("state"), "csrf-state");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal((await stat(f.config.tokenFile)).mode & 0o777, 0o600);
  assert.ok((await readFile(f.config.tokenFile, "utf8")).includes("refresh-1"));
  const restored = new TwitchAuth(f.config, f.request);
  assert.equal(await restored.restore(), true);
  assert.equal(restored.identity?.userId, "broadcaster");
  assert.equal(f.calls.at(-1)!.url, "https://id.twitch.tv/oauth2/validate");
});

test("concurrent 401s share one refresh, persist the rotated token and retry with new authorization", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  let firstTokenCalls = 0;
  const request: typeof fetch = async (input, init = {}) => {
    if (
      String(input).includes("/helix/") &&
      (init.headers as Record<string, string>).Authorization ===
        "Bearer access-1"
    ) {
      firstTokenCalls++;
      return new Response(null, { status: 401 });
    }
    return f.request(input, init);
  };
  const auth = new TwitchAuth(f.config, request);
  await auth.restore();
  const results = await Promise.all([
    auth.helix("eventsub/subscriptions", { method: "POST" }),
    auth.helix("eventsub/subscriptions", { method: "POST" }),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [202, 202],
  );
  assert.equal(firstTokenCalls, 2);
  assert.equal(
    f.calls.filter((c) => c.url.endsWith("/oauth2/token")).length,
    2,
  ); // initial exchange + one refresh
  assert.ok((await readFile(f.config.tokenFile, "utf8")).includes("refresh-2"));
});

test("authorization revocation stops EventSub and clears persisted credentials", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const client = new TwitchChat(
    f.auth,
    () => {},
    () => {},
    f.socket,
  );
  t.after(() => client.stop());
  client.start();
  f.sockets[0].welcome();
  await flush();
  f.sockets[0].frame("revocation", {
    subscription: { status: "authorization_revoked" },
  });
  await until(() => client.status.state === "needs_auth");
  assert.equal(client.status.state, "needs_auth");
  assert.equal(f.auth.identity, null);
  await assert.rejects(readFile(f.config.tokenFile), /ENOENT/);
  assert.ok(f.sockets[0].closed);
});

test("Twitch chat enters real ballot handlers; duplicates across handoff cannot revert a changed vote", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const party = new Party();
  const client = new TwitchChat(
    f.auth,
    (m) => party.chat(m),
    () => {},
    f.socket,
  );
  t.after(() => client.stop());
  client.start();
  f.sockets[0].welcome();
  await flush();
  const sub = JSON.parse(
    String(
      f.calls.find((c) => c.url.endsWith("/eventsub/subscriptions"))!.init.body,
    ),
  );
  assert.deepEqual(sub.condition, {
    broadcaster_user_id: "broadcaster",
    user_id: "broadcaster",
  });
  f.sockets[0].notification("proposal", "viewer1", "!rule gravity");
  assert.equal(party.state.authors.gravity, "viewer1");
  party.dispatch({ type: "start" });
  f.sockets[0].notification("first", "viewer1", "!vote 1");
  f.sockets[0].notification("second", "viewer1", "!vote 2");
  f.sockets[0].frame("session_reconnect", {
    session: {
      reconnect_url: "wss://eventsub.wss.twitch.tv/ws?reconnect=opaque",
    },
  });
  assert.equal(f.sockets.length, 2);
  assert.equal(f.sockets[0].closed, false);
  f.sockets[1].welcome("migrated");
  await flush();
  assert.equal(f.sockets[0].closed, true);
  assert.equal(
    f.calls.filter((c) => c.url.endsWith("/eventsub/subscriptions")).length,
    1,
  );
  f.sockets[1].notification("first", "viewer1", "!vote 1");
  f.sockets[1].notification("third", "viewer2", "!vote 2");
  f.sockets[1].notification("foreign", "viewer3", "!vote 1", "another-channel");
  assert.deepEqual(party.state.votes, {
    "twitch:viewer1": 1,
    "twitch:viewer2": 1,
  });
  party.dispatch({ type: "lock" });
  f.sockets[1].notification("late", "viewer2", "!vote 3");
  assert.equal(party.state.pendingRule, "moon");
  assert.equal(party.state.votes["twitch:viewer2"], 1);
});

test("keepalive refreshes deadline; loss reconnects with a fresh subscription and reports unreplayed gap", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const client = new TwitchChat(
    f.auth,
    () => {},
    () => {},
    f.socket,
    10,
  );
  t.after(() => client.stop());
  t.mock.timers.enable({ apis: ["setTimeout"] });
  client.start();
  f.sockets[0].welcome("first", 1);
  await flush();
  t.mock.timers.tick(1500);
  f.sockets[0].frame("session_keepalive", {});
  t.mock.timers.tick(1500);
  assert.equal(client.status.state, "connected");
  t.mock.timers.tick(501);
  assert.equal(client.status.state, "reconnecting");
  assert.equal(client.status.gap, true);
  t.mock.timers.tick(10);
  f.sockets[1].welcome("second");
  await flush();
  assert.equal(client.status.state, "connected");
  assert.equal(
    f.calls.filter((c) => c.url.endsWith("/eventsub/subscriptions")).length,
    2,
  );
});

test("reconnect URLs cannot send credentials or traffic to another host", () => {
  for (const url of [
    "ws://eventsub.wss.twitch.tv/ws",
    "wss://evil.test/ws",
    "wss://eventsub.wss.twitch.tv.evil.test/ws",
    "wss://user:secret@eventsub.wss.twitch.tv/ws",
    "wss://eventsub.wss.twitch.tv:123/ws",
  ])
    assert.throws(() => safeReconnectUrl(url));
  assert.equal(
    safeReconnectUrl("wss://eventsub.wss.twitch.tv/ws?opaque=123"),
    "wss://eventsub.wss.twitch.tv/ws?opaque=123",
  );
});

test("revoked refresh credentials require new broadcaster consent", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  f.revoke();
  await assert.rejects(f.auth.maintain(), AuthorizationRequired);
});

test("a refresh that completes after disconnect cannot resurrect stored tokens", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let refreshStarted = false;
  const request: typeof fetch = async (input, init = {}) => {
    if (String(input).includes("/helix/"))
      return new Response(null, { status: 401 });
    if (String(input).endsWith("/oauth2/token")) {
      refreshStarted = true;
      await blocked;
    }
    return f.request(input, init);
  };
  const auth = new TwitchAuth(f.config, request);
  await auth.restore();
  const pending = auth.helix("eventsub/subscriptions", { method: "POST" });
  const rejected = assert.rejects(pending, AuthorizationRequired);
  await until(() => refreshStarted);
  await auth.clear();
  release();
  await rejected;
  assert.equal(auth.identity, null);
  await assert.rejects(readFile(f.config.tokenFile), /ENOENT/);
});
