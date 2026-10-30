import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebSocket } from "ws";
import { TwitchAuth } from "../../apps/server/twitch/auth.ts";
export class FakeSocket extends EventEmitter {
  closed = false;
  close() {
    if (!this.closed) {
      this.closed = true;
      this.emit("close");
    }
  }
  frame(type: string, payload: unknown, id = "envelope") {
    this.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: { message_type: type, message_id: id },
          payload,
        }),
      ),
    );
  }
  welcome(id = "session", seconds = 10) {
    this.frame("session_welcome", {
      session: { id, keepalive_timeout_seconds: seconds },
    });
  }
  notification(
    id: string,
    user = "viewer1",
    text = "!vote 1",
    broadcaster = "broadcaster",
  ) {
    this.frame("notification", {
      subscription: { type: "channel.chat.message" },
      event: {
        broadcaster_user_id: broadcaster,
        chatter_user_id: user,
        chatter_user_name: user,
        message_id: id,
        message: { text },
      },
    });
  }
}
export async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "patch-party-twitch-test-"));
  const calls: { url: string; init: RequestInit }[] = [];
  let version = 0;
  let revoked = false;
  const request: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/oauth2/token")) {
      if (revoked)
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      version++;
      return Response.json({
        access_token: `access-${version}`,
        refresh_token: `refresh-${version}`,
      });
    }
    if (url.endsWith("/oauth2/validate"))
      return revoked
        ? new Response(null, { status: 401 })
        : Response.json({
            user_id: "broadcaster",
            login: "streamer",
            client_id: "client",
            scopes: ["user:read:chat"],
            expires_in: 3600,
          });
    if (url.endsWith("/eventsub/subscriptions"))
      return Response.json({ data: [{ id: "subscription" }] }, { status: 202 });
    if (url.endsWith("/oauth2/revoke")) {
      revoked = true;
      return new Response(null, { status: 200 });
    }
    if (url.includes("/helix/streams?"))
      return Response.json({ data: [{ type: "live" }] });
    throw new Error(`Unexpected test request: ${url}`);
  };
  const config = {
    clientId: "client",
    clientSecret: "client-secret-test",
    redirectUri: "http://127.0.0.1:5173/api/twitch/callback",
    tokenFile: join(dir, "twitch.json"),
  };
  const auth = new TwitchAuth(config, request);
  await auth.acceptCode("test-code");
  const sockets: FakeSocket[] = [],
    urls: string[] = [];
  const socket = (url: string) => {
    urls.push(url);
    const s = new FakeSocket();
    sockets.push(s);
    return s as unknown as WebSocket;
  };
  return {
    dir,
    config,
    auth,
    request,
    calls,
    sockets,
    urls,
    socket,
    revoke: () => {
      revoked = true;
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
export const flush = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

export async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Condition did not settle.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
