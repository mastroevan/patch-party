import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
export function cookies(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (req.headers.cookie ?? "").split(";").flatMap((part) => {
      const i = part.indexOf("=");
      return i < 0 ? [] : [[part.slice(0, i).trim(), part.slice(i + 1).trim()]];
    }),
  );
}
export function equalSecret(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export class OperatorSessions {
  readonly key: string;
  private sessions = new Map<string, number>();
  private attempts: number[] = [];
  constructor(
    key?: string,
    private secure = false,
  ) {
    if (key && key.length < 24)
      throw new Error(
        "PATCH_PARTY_OPERATOR_KEY must have at least 24 characters.",
      );
    this.key = key || randomBytes(32).toString("base64url");
  }
  authenticated(req: IncomingMessage) {
    const now = Date.now();
    for (const [id, expires] of this.sessions)
      if (expires <= now) this.sessions.delete(id);
    return this.sessions.has(cookies(req).pp_operator ?? "");
  }
  login(key: unknown, res: ServerResponse) {
    const now = Date.now();
    this.attempts = this.attempts.filter((at) => at > now - 60000);
    if (this.attempts.length >= 10) return 429;
    if (typeof key !== "string" || !equalSecret(key, this.key)) {
      this.attempts.push(now);
      return 401;
    }
    if (this.sessions.size >= 100)
      this.sessions.delete(this.sessions.keys().next().value!);
    const session = randomBytes(32).toString("base64url");
    this.sessions.set(session, now + 12 * 3600000);
    res.setHeader(
      "Set-Cookie",
      `pp_operator=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${this.secure ? "; Secure" : ""}`,
    );
    return 200;
  }
}
export async function jsonBody(req: IncomingMessage) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 4096)
      throw new Error("Request is too large.");
  }
  return JSON.parse(body || "{}");
}
