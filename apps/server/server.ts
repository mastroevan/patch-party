import { RuleLibrary } from "./library.ts";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Party } from "./party.ts";
import { RuleCoordinator, type Generator } from "./codex/coordinator.ts";
import type { Action } from "../../packages/contracts/index.ts";
import { TwitchAuth, type TwitchConfig } from "./twitch/auth.ts";
import { TwitchChat } from "./twitch/eventsub.ts";
import {
  OperatorSessions,
  cookies,
  equalSecret,
  jsonBody,
} from "./operator.ts";
import { overlayState } from "./overlay.ts";
export interface ServerOptions {
  storageDirectory?: string;
  legacyRulesDirectory?: string;
  operatorKey?: string;
  origin?: string;
  twitch?: TwitchConfig;
  generate?: Generator;
  request?: typeof fetch;
  twitchSocket?: (url: string) => WebSocket;
}
export function twitchConfig(env: NodeJS.ProcessEnv): TwitchConfig | undefined {
  if (!env.TWITCH_CLIENT_ID && !env.TWITCH_CLIENT_SECRET) return;
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET)
    throw new Error("Set both TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.");
  return {
    clientId: env.TWITCH_CLIENT_ID,
    clientSecret: env.TWITCH_CLIENT_SECRET,
    redirectUri: `${env.PATCH_PARTY_ORIGIN || "https://127.0.0.1:5173"}/api/twitch/callback`,
    tokenFile: resolve(".local/twitch.json"),
    broadcasterLogin: env.TWITCH_BROADCASTER_LOGIN,
  };
}
export function createPartyServer(options: ServerOptions = {}) {
  const origin = new URL(options.origin || "https://127.0.0.1:5173");
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    !["127.0.0.1", "localhost"].includes(origin.hostname) ||
    origin.pathname !== "/"
  )
    throw new Error("PATCH_PARTY_ORIGIN must be a local HTTP or HTTPS origin.");
  const allowedHosts = new Set([origin.host]);
  const secureCookie = origin.protocol === "https:" ? "; Secure" : "";
  const party = new Party();
  const library = new RuleLibrary(options.storageDirectory);
  let storageReady = false,
    lastPreferences = "",
    selectionRequest = 0;
  const sessions = new OperatorSessions(
    options.operatorKey,
    origin.protocol === "https:",
  );
  const auth = options.twitch
    ? new TwitchAuth(options.twitch, options.request)
    : null;
  const operators = new Set<WebSocket>();
  const requests = new Map<WebSocket, import("node:http").IncomingMessage>();
  let controller: WebSocket | undefined;
  const states = new Map<string, { state: string; expires: number }>();
  const proof = {
    viewers: new Set<string>(),
    messages: [] as {
      id: string;
      userId: string;
      command: string;
      receivedAt: string;
      roundId: string;
    }[],
    locked: false,
    ballotRoundId: null as string | null,
    acceptedHash: null as string | null,
    activeHash: null as string | null,
    effectObserved: false,
  };
  const twitch = new TwitchChat(
    auth,
    (message) => {
      const acceptedVote =
        party.state.ballot === "voting" &&
        /^!vote\s+[123]$/i.test(message.text);
      party.chat(message);
      if (
        acceptedVote &&
        message.userId !== `twitch:${auth?.identity?.userId}`
      ) {
        proof.viewers.add(message.userId);
        proof.messages.push({
          id: message.id,
          userId: message.userId,
          command: message.text,
          receivedAt: new Date().toISOString(),
          roundId: party.state.roundId,
        });
        proof.messages = proof.messages.slice(-200);
      }
      broadcast();
    },
    broadcast,
    options.twitchSocket,
  );
  function broadcast() {
    if (storageReady) {
      const currentPreferences = JSON.stringify({
        best: party.state.best,
        mode: party.state.mode,
      });
      if (currentPreferences !== lastPreferences) {
        lastPreferences = currentPreferences;
        void library
          .savePreferences(party.state.best, party.state.mode)
          .catch(() => {
            party.state.persistenceError =
              "Lobby settings could not be saved. Gameplay is still available.";
          });
      }
    }
    if (
      party.state.ballot === "locked" &&
      Object.keys(party.state.votes).filter(
        (id) =>
          id.startsWith("twitch:") && id !== `twitch:${auth?.identity?.userId}`,
      ).length >= 2
    ) {
      proof.locked = true;
      if (
        party.state.build.status === "ready" &&
        party.state.build.artifact?.origin === "live-codex"
      ) {
        proof.ballotRoundId = party.state.roundId;
        proof.acceptedHash = party.state.build.artifact.hash;
      }
    }
    if (
      party.state.phase === "playing" &&
      party.state.roundId !== proof.ballotRoundId &&
      proof.acceptedHash &&
      party.state.activeArtifact?.hash === proof.acceptedHash
    ) {
      proof.activeHash = party.state.activeArtifact.hash;
      if (party.state.effects.length) proof.effectObserved = true;
    }
    for (const client of wss.clients)
      if (client.readyState === WebSocket.OPEN) {
        if (
          operators.has(client) &&
          !sessions.authenticated(requests.get(client)!)
        ) {
          client.close(1008, "Operator session expired");
          continue;
        }
        client.send(
          JSON.stringify(
            operators.has(client)
              ? {
                  type: "state",
                  state: party.state,
                  controller: client === controller,
                  twitch: twitch.status,
                }
              : {
                  type: "overlay",
                  state: overlayState(party.state, twitch.status),
                },
          ),
        );
      }
  }
  const coordinator = new RuleCoordinator(
    party,
    broadcast,
    options.generate,
    120000,
    async (artifact, author, proposal) => {
      try {
        await library.save(artifact, author, proposal);
      } catch {
        throw new Error(
          "The rule passed checks but could not be saved. Retry, choose a saved rule, or play original rules.",
        );
      }
      party.state.library = library.summaries();
    },
  );
  function localHost(host: string) {
    if (allowedHosts.has(host)) return true;
    const address = server.address();
    return (
      typeof address === "object" &&
      address !== null &&
      [`127.0.0.1:${address.port}`, `localhost:${address.port}`].includes(host)
    );
  }
  const server = createServer((req, res) => {
    void (async () => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const url = new URL(req.url || "/", origin);
      if (!localHost(req.headers.host ?? "")) {
        res.writeHead(403).end("Local host required");
        return;
      }
      const json = (status: number, data: unknown) => {
        res
          .writeHead(status, { "Content-Type": "application/json" })
          .end(JSON.stringify(data));
      };
      if (url.pathname === "/api/health" && req.method === "GET") {
        json(200, { ok: true, milestone: 5 });
        return;
      }
      if (
        ["POST", "DELETE"].includes(req.method || "") &&
        req.headers.origin !== origin.origin
      ) {
        json(403, { error: "Local origin required." });
        return;
      }
      if (url.pathname === "/api/operator/session") {
        if (req.method === "GET")
          json(200, { authenticated: sessions.authenticated(req) });
        else if (req.method === "POST") {
          const status = sessions.login((await jsonBody(req)).key, res);
          json(status, { authenticated: status === 200 });
        } else json(405, { error: "Method not allowed." });
        return;
      }
      if (url.pathname === "/api/twitch/callback" && req.method === "GET") {
        const state = url.searchParams.get("state") || "";
        const saved = states.get(state);
        states.delete(state);
        res.setHeader(
          "Set-Cookie",
          `pp_twitch_state=; HttpOnly; SameSite=Lax; Path=/api/twitch/callback; Max-Age=0${secureCookie}`,
        );
        if (
          !auth ||
          !saved ||
          saved.expires < Date.now() ||
          !equalSecret(state, cookies(req).pp_twitch_state || "")
        ) {
          json(400, {
            error:
              "Twitch sign-in expired or state was invalid. Start Connect Twitch again.",
          });
          return;
        }
        if (url.searchParams.has("error") || !url.searchParams.get("code")) {
          res
            .writeHead(303, { Location: `${origin.origin}/?twitch=denied` })
            .end();
          return;
        }
        twitch.disconnected();
        await auth.acceptCode(url.searchParams.get("code")!);
        twitch.start();
        res
          .writeHead(303, { Location: `${origin.origin}/?twitch=connected` })
          .end();
        return;
      }
      if (!sessions.authenticated(req)) {
        json(401, { error: "Operator sign-in required." });
        return;
      }
      if (url.pathname === "/api/twitch/status" && req.method === "GET") {
        json(200, twitch.status);
        return;
      }
      if (url.pathname === "/api/twitch/authorize" && req.method === "GET") {
        if (!auth) {
          json(503, { error: "Configure your Twitch application first." });
          return;
        }
        for (const [id, entry] of states)
          if (entry.expires < Date.now()) states.delete(id);
        if (states.size >= 100) {
          json(429, { error: "Too many pending sign-ins." });
          return;
        }
        const state = randomBytes(32).toString("base64url");
        states.set(state, { state, expires: Date.now() + 600000 });
        res.setHeader(
          "Set-Cookie",
          `pp_twitch_state=${state}; HttpOnly; SameSite=Lax; Path=/api/twitch/callback; Max-Age=600${secureCookie}`,
        );
        res.writeHead(303, { Location: auth.authorizeUrl(state) }).end();
        return;
      }
      if (url.pathname === "/api/twitch/reconnect" && req.method === "POST") {
        if (!auth) {
          json(503, { error: "Configure Twitch first." });
          return;
        }
        await auth.maintain();
        twitch.start();
        json(200, twitch.status);
        return;
      }
      if (url.pathname === "/api/twitch/disconnect" && req.method === "POST") {
        twitch.disconnected();
        states.clear();
        try {
          await auth?.revoke();
        } finally {
          await auth?.clear();
        }
        json(200, twitch.status);
        return;
      }
      if (url.pathname === "/api/twitch/proof" && req.method === "GET") {
        let streamLive = false;
        if (auth?.identity) {
          const result = await auth.helix(
            `streams?user_id=${encodeURIComponent(auth.identity.userId)}`,
            { method: "GET" },
          );
          if (!result.ok)
            throw new Error("Could not check Twitch stream status.");
          streamLive =
            (await result.json()).data?.some(
              (item: any) => item.type === "live",
            ) ?? false;
        }
        json(200, {
          capturedAt: new Date().toISOString(),
          channel: auth?.identity?.login ?? null,
          streamLive,
          distinctViewers: proof.viewers.size,
          messages: proof.messages,
          ballotLocked: proof.locked,
          ballotRoundId: proof.ballotRoundId,
          acceptedHash: proof.acceptedHash,
          activeHash: proof.activeHash,
          effectObserved: proof.effectObserved,
          broadcastCaptureReviewed: false,
          note: "Review an OBS recording to confirm the broadcast. Twitch does not replay events lost during connection gaps.",
        });
        return;
      }
      json(404, { error: "Not found." });
    })().catch(() => {
      if (!res.headersSent)
        res.writeHead(502, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            error:
              "Operation failed. Check Twitch configuration or reconnect authorization.",
          }),
        );
      else res.end();
    });
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url || "/", origin).pathname;
    const overlay = path === "/ws/overlay";
    if (
      !localHost(req.headers.host ?? "") ||
      (!overlay && path !== "/ws") ||
      req.headers.origin !== origin.origin ||
      (!overlay && !sessions.authenticated(req))
    ) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!overlay) operators.add(ws);
      wss.emit("connection", ws, req);
    });
  });
  wss.on("connection", (socket, req) => {
    if (operators.has(socket)) requests.set(socket, req);
    if (operators.has(socket) && !controller) {
      controller = socket;
      if (party.state.phase === "playing") party.state.paused = true;
    }
    let windowStart = Date.now(),
      count = 0;
    socket.on("message", (raw) => {
      void (async () => {
        if (!operators.has(socket) || !sessions.authenticated(req))
          throw new Error("Overlay access is read-only.");
        if (Date.now() - windowStart > 1000) {
          windowStart = Date.now();
          count = 0;
        }
        if (++count > 30) throw new Error("Please slow down.");
        const a = JSON.parse(raw.toString()) as Action;
        if (
          !a ||
          typeof a !== "object" ||
          ![
            "start",
            "pause",
            "finish",
            "lock",
            "next",
            "reset",
            "chat",
            "coin",
            "death",
            "mode",
            "retry-build",
            "cancel-build",
            "skip-rule",
            "use-saved-rule",
            "preview-rule",
            "close-preview",
            "load-rule",
            "revert",
          ].includes(a.type)
        )
          throw new Error("Unknown action.");
        if (a.type === "chat") {
          if (
            ["connected", "reconnecting", "connecting"].includes(
              twitch.status.state,
            )
          )
            throw new Error(
              "Live Twitch is active. Send commands in your Twitch channel.",
            );
          const m = a.message;
          if (
            !m ||
            typeof m.id !== "string" ||
            m.id.length > 100 ||
            typeof m.userId !== "string" ||
            m.userId.length > 64 ||
            typeof m.name !== "string" ||
            typeof m.text !== "string"
          )
            throw new Error("Invalid chat message.");
          m.source = "simulated";
          m.userId = `simulated:${m.userId}`;
          m.id = `simulated:${m.id}`;
        } else if (socket !== controller)
          throw new Error("This tab is a spectator. Use the controller tab.");
        if (a.type === "load-rule") {
          if (typeof a.hash !== "string" || !/^[a-f0-9]{64}$/.test(a.hash))
            throw new Error("Invalid saved rule selection.");
          const request = ++selectionRequest,
            state = party.state,
            phase = state.phase,
            build = state.build;
          if (!["lobby", "results"].includes(phase))
            throw new Error(
              "Queue saved rules in the lobby or between rounds.",
            );
          const record = await library.load(a.hash);
          if (
            request !== selectionRequest ||
            party.state !== state ||
            state.phase !== phase ||
            state.build !== build
          )
            return;
          coordinator.queueSavedRule(
            record.artifact,
            record.author,
            record.proposal,
          );
          return;
        }
        if (a.type === "preview-rule") {
          await coordinator.previewRule();
          return;
        }
        const before = party.state.coins;
        party.dispatch(a);
        if (a.type === "close-preview") coordinator.closePreview();
        if (a.type === "reset") {
          proof.viewers.clear();
          proof.messages = [];
          proof.locked = false;
          proof.ballotRoundId = null;
          proof.acceptedHash = null;
          proof.activeHash = null;
          proof.effectObserved = false;
        }
        if (a.type === "use-saved-rule" && !(await coordinator.useSavedRule()))
          throw new Error(
            "No matching saved rule is available. Retry the build, choose a library rule, or play original rules.",
          );
        coordinator.reconcile();
        if (a.type === "coin" && party.state.coins > before)
          coordinator.event({
            event: "coin",
            coinCount: party.state.coins,
            round: party.state.round,
          });
        broadcast();
      })().catch((error) => {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(
            JSON.stringify({
              type: "error",
              message: String(error.message || "Invalid action").slice(0, 300),
            }),
          );
      });
    });
    socket.on("close", () => {
      operators.delete(socket);
      requests.delete(socket);
      if (socket === controller) {
        if (party.state.phase === "playing") party.state.paused = true;
        controller = [...operators].find(
          (c) => c.readyState === WebSocket.OPEN,
        );
      }
      broadcast();
    });
    broadcast();
  });
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    party.tick(now - last);
    coordinator.reconcile();
    last = now;
    broadcast();
  }, 100);
  timer.unref();
  return {
    server,
    party,
    twitch,
    sessions,
    async listen(port = 3001) {
      const restored = await library.restore();
      if (options.legacyRulesDirectory)
        await library.importArtifacts(options.legacyRulesDirectory);
      if (restored.preferences) {
        party.state.best = restored.preferences.best;
        party.state.mode = restored.preferences.mode;
        party.state.notice = "Welcome back. Fresh lobby, saved rules ready.";
      }
      party.state.library = library.summaries();
      party.state.persistenceError = restored.warning;
      lastPreferences = JSON.stringify({
        best: party.state.best,
        mode: party.state.mode,
      });
      storageReady = true;
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      void twitch.restore();
    },
    async close() {
      twitch.stop();
      coordinator.dispose();
      clearInterval(timer);
      await library.flush();
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
