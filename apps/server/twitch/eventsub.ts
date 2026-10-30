import { WebSocket } from "ws";
import type { ChatMessage } from "../../../packages/contracts/index.ts";
import type { TwitchStatus } from "../../../packages/contracts/twitch.ts";
import { AuthorizationRequired, TwitchAuth } from "./auth.ts";
const ENDPOINT = "wss://eventsub.wss.twitch.tv/ws";
export function safeReconnectUrl(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Missing Twitch reconnect URL.");
  const url = new URL(value);
  if (
    url.protocol !== "wss:" ||
    url.hostname !== "eventsub.wss.twitch.tv" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("Invalid Twitch reconnect destination.");
  return value;
}
interface Connection {
  ws: WebSocket;
  timer?: ReturnType<typeof setTimeout>;
  keepalive: number;
  transferred: boolean;
}
export class TwitchChat {
  readonly status: TwitchStatus;
  private active?: Connection;
  private pending?: Connection;
  private retry?: ReturnType<typeof setTimeout>;
  private maintenance?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private epoch = 0;
  private attempts = 0;
  private seen = new Map<string, number>();
  private proposals = new Map<string, number>();
  constructor(
    private auth: TwitchAuth | null,
    private chat: (m: ChatMessage) => void,
    private changed: () => void,
    private socket: (url: string) => WebSocket = (url) =>
      new WebSocket(url, { maxPayload: 65536 }),
    private retryBaseMs = 1000,
  ) {
    this.status = {
      configured: !!auth,
      state: auth ? "disconnected" : "disabled",
      channel: null,
      lastMessageAt: null,
      reconnects: 0,
      gap: false,
      message: auth
        ? "Connect your broadcaster account."
        : "Add Twitch application settings to connect live chat.",
    };
  }
  private update(state: TwitchStatus["state"], message: string) {
    Object.assign(this.status, {
      state,
      message,
      channel: this.auth?.identity?.login ?? null,
    });
    this.changed();
  }
  async restore() {
    if (!this.auth) return;
    try {
      if (await this.auth.restore()) this.start();
    } catch (error) {
      await this.failure(error);
    }
  }
  start() {
    this.stop();
    if (!this.auth?.identity) {
      this.update("needs_auth", "Connect your broadcaster account.");
      return;
    }
    this.stopped = false;
    this.attempts = 0;
    this.update("connecting", "Connecting to Twitch chat…");
    this.open(ENDPOINT, false);
    this.scheduleMaintenance();
  }
  stop() {
    this.epoch++;
    this.stopped = true;
    clearTimeout(this.retry);
    clearTimeout(this.maintenance);
    const connections = [this.active, this.pending];
    this.active = this.pending = undefined;
    for (const c of connections)
      if (c) {
        clearTimeout(c.timer);
        c.ws.close();
      }
  }
  disconnected() {
    this.stop();
    this.update(
      "disconnected",
      "Twitch disconnected. Use simulated chat for local rehearsal.",
    );
  }
  private relevant(c: Connection) {
    return !this.stopped && (this.active === c || this.pending === c);
  }
  private watchdog(c: Connection) {
    clearTimeout(c.timer);
    c.timer = setTimeout(() => {
      if (this.relevant(c))
        this.recover(
          "Twitch keepalive missed. Reconnecting; chat during the gap cannot be replayed.",
        );
    }, c.keepalive);
  }
  private open(url: string, transferred: boolean) {
    const c: Connection = {
      ws: this.socket(url),
      keepalive: 10000,
      transferred,
    };
    if (transferred) this.pending = c;
    else this.active = c;
    this.watchdog(c);
    c.ws.on("message", (raw) => {
      if (!this.relevant(c)) return;
      void this.receive(c, raw.toString()).catch((error) => {
        if (this.relevant(c)) void this.failure(error);
      });
    });
    c.ws.on("close", () => {
      if (this.relevant(c))
        this.recover(
          "Twitch connection lost. Messages during the gap cannot be replayed.",
        );
    });
    c.ws.on("error", () => {
      if (this.relevant(c)) this.recover("Twitch network error. Reconnecting…");
    });
  }
  private recover(message: string) {
    if (this.stopped || this.retry) return;
    const previous = [this.active, this.pending];
    this.active = this.pending = undefined;
    for (const c of previous)
      if (c) {
        clearTimeout(c.timer);
        c.ws.close();
      }
    this.status.gap = true;
    this.status.reconnects++;
    this.update("reconnecting", message);
    const delay = Math.min(
      30000,
      this.retryBaseMs * 2 ** Math.min(this.attempts++, 5),
    );
    this.retry = setTimeout(() => {
      this.retry = undefined;
      if (!this.stopped) this.open(ENDPOINT, false);
    }, delay);
  }
  private async failure(error: unknown) {
    if (error instanceof AuthorizationRequired) {
      this.stop();
      await this.auth?.clear();
      this.update("needs_auth", error.message);
    } else if (!this.stopped)
      this.recover(
        "Twitch service unavailable. Reconnecting; messages during gaps are not replayed.",
      );
    else
      this.update(
        "error",
        "Twitch connection could not be restored. Retry connection.",
      );
  }
  private scheduleMaintenance() {
    clearTimeout(this.maintenance);
    if (this.stopped || !this.auth) return;
    const epoch = this.epoch;
    this.maintenance = setTimeout(() => {
      void this.auth!.maintain()
        .then(() => {
          if (epoch === this.epoch) this.scheduleMaintenance();
        })
        .catch((error) => {
          if (epoch !== this.epoch) return;
          void this.failure(error).then(() => this.scheduleMaintenance());
        });
    }, this.auth.maintenanceDelay);
  }
  private duplicate(id: string) {
    const now = Date.now();
    for (const [key, at] of this.seen) {
      if (at < now - 600000 || this.seen.size > 10000) this.seen.delete(key);
      else break;
    }
    if (this.seen.has(id)) return true;
    this.seen.set(id, now);
    return false;
  }
  private async receive(c: Connection, raw: string) {
    const data = JSON.parse(raw);
    const { metadata: m, payload: p } = data;
    if (!m?.message_type || !p) throw new Error("Invalid EventSub frame.");
    if (m.message_type === "session_welcome") {
      if (!p.session?.id) throw new Error("Invalid EventSub welcome.");
      c.keepalive = Math.max(
        1000,
        Number(p.session.keepalive_timeout_seconds ?? 10) * 1000 + 1000,
      );
      this.watchdog(c);
      if (c.transferred) {
        const old = this.active;
        this.active = c;
        this.pending = undefined;
        if (old) {
          clearTimeout(old.timer);
          old.ws.close();
        }
      } else {
        const userId = this.auth!.identity!.userId;
        const result = await this.auth!.helix("eventsub/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "channel.chat.message",
            version: "1",
            condition: { broadcaster_user_id: userId, user_id: userId },
            transport: { method: "websocket", session_id: p.session.id },
          }),
        });
        if (!this.relevant(c)) return;
        if (result.status !== 202)
          throw new Error("Twitch chat subscription failed.");
      }
      this.attempts = 0;
      this.status.lastMessageAt = Date.now();
      this.update(
        "connected",
        this.status.gap
          ? "Live chat connected. Messages from earlier connection gaps were not replayed."
          : "Live chat connected.",
      );
    } else if (
      m.message_type === "session_keepalive" ||
      m.message_type === "notification"
    ) {
      this.watchdog(c);
      this.status.lastMessageAt = Date.now();
      if (
        m.message_type === "notification" &&
        p.subscription?.type === "channel.chat.message"
      ) {
        const event = p.event;
        if (
          event?.broadcaster_user_id !== this.auth!.identity?.userId ||
          typeof event.message_id !== "string" ||
          typeof event.chatter_user_id !== "string" ||
          typeof event.chatter_user_name !== "string" ||
          typeof event.message?.text !== "string"
        )
          return;
        if (this.duplicate(`event:${event.message_id}`)) return;
        const text = event.message.text.slice(0, 180);
        if (!/^!(rule|vote)\b/i.test(text)) return;
        const user = event.chatter_user_id;
        if (/^!rule\b/i.test(text)) {
          if (Date.now() - (this.proposals.get(user) ?? 0) < 3000) return;
          this.proposals.delete(user);
          this.proposals.set(user, Date.now());
          if (this.proposals.size > 5000)
            this.proposals.delete(this.proposals.keys().next().value!);
        }
        this.chat({
          id: `twitch:${event.message_id}`,
          userId: `twitch:${user}`,
          name: event.chatter_user_name,
          text,
          source: "twitch",
        });
        this.changed();
      }
    } else if (m.message_type === "session_reconnect") {
      if (!this.pending) {
        this.update(
          "reconnecting",
          "Twitch requested a seamless connection handoff.",
        );
        this.open(safeReconnectUrl(p.session?.reconnect_url), true);
      }
    } else if (m.message_type === "revocation") {
      this.stop();
      if (
        ["authorization_revoked", "user_removed"].includes(
          p.subscription?.status,
        )
      ) {
        await this.auth!.clear();
        this.update(
          "needs_auth",
          "Twitch authorization was revoked. Connect Twitch again.",
        );
      } else
        this.update(
          "error",
          "Twitch revoked the chat subscription. Check app configuration and reconnect.",
        );
    }
  }
}
