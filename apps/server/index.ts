import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { Party } from "./party.ts";
import type { Action } from "../../packages/contracts/index.ts";
const party = new Party();
const server = createServer((req, res) => {
  if (req.url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, mode: "local", milestone: 1 }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4096 });
let controller: WebSocket | undefined;
function broadcast() {
  for (const client of wss.clients)
    if (client.readyState === WebSocket.OPEN)
      client.send(
        JSON.stringify({
          type: "state",
          state: party.state,
          controller: client === controller,
        }),
      );
}
wss.on("connection", (socket, req) => {
  const origin = req.headers.origin;
  if (
    origin &&
    !["http://127.0.0.1:5173", "http://localhost:5173"].includes(origin)
  ) {
    socket.close(1008, "Local origin required");
    return;
  }
  if (!controller) {
    controller = socket;
    if (party.state.phase === "playing") party.state.paused = true;
  }
  let windowStart = Date.now(),
    count = 0;
  socket.on("message", (raw) => {
    try {
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
        ].includes(a.type)
      )
        throw new Error("Unknown action.");
      if (a.type === "chat") {
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
      } else if (socket !== controller)
        throw new Error("This tab is a spectator. Use the controller tab.");
      party.dispatch(a);
      broadcast();
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : "Invalid action.",
        }),
      );
    }
  });
  socket.on("close", () => {
    if (socket === controller) {
      controller = undefined;
      if (party.state.phase === "playing") party.state.paused = true;
      controller = [...wss.clients].find(
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
  last = now;
  broadcast();
}, 100);
const port = Number(process.env.PORT ?? 3001);
server.listen(port, "127.0.0.1", () =>
  console.log(`Patch Party local server: http://127.0.0.1:${port}`),
);
function shutdown() {
  clearInterval(timer);
  for (const c of wss.clients) c.close();
  wss.close();
  server.close();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
