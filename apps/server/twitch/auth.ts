import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
export interface TwitchConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenFile: string;
  broadcasterLogin?: string;
}
interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  login: string;
}
export class AuthorizationRequired extends Error {}
export class TwitchAuth {
  private tokens: Tokens | null = null;
  private revision = 0;
  private storage: Promise<void> = Promise.resolve();
  private refreshing: Promise<void> | null = null;
  constructor(
    readonly config: TwitchConfig,
    private request: typeof fetch = fetch,
  ) {}
  get identity() {
    return this.tokens
      ? { userId: this.tokens.userId, login: this.tokens.login }
      : null;
  }
  get maintenanceDelay() {
    return Math.min(
      3600000,
      Math.max(1000, (this.tokens?.expiresAt ?? 0) - Date.now() - 60000),
    );
  }
  authorizeUrl(state: string) {
    const url = new URL("https://id.twitch.tv/oauth2/authorize");
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: "user:read:chat",
      state,
      force_verify: "true",
    }).toString();
    return url.toString();
  }
  private async call(url: string, init: RequestInit = {}) {
    return this.request(url, { ...init, signal: AbortSignal.timeout(8000) });
  }
  private async validate(accessToken: string) {
    const res = await this.call("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${accessToken}` },
    });
    if (res.status === 401)
      throw new AuthorizationRequired(
        "Twitch authorization expired. Connect Twitch again.",
      );
    if (!res.ok)
      throw new Error(
        "Twitch token validation is unavailable. Retry connection.",
      );
    const data = await res.json();
    if (
      data.client_id !== this.config.clientId ||
      !data.user_id ||
      !data.login ||
      !data.scopes?.includes("user:read:chat") ||
      (this.config.broadcasterLogin &&
        data.login.toLowerCase() !== this.config.broadcasterLogin.toLowerCase())
    )
      throw new AuthorizationRequired(
        "Authorize the configured broadcaster with chat read permission.",
      );
    return data as { user_id: string; login: string; expires_in: number };
  }
  private store(action: () => Promise<void>) {
    const next = this.storage.then(action);
    this.storage = next.catch(() => {});
    return next;
  }
  private persist(tokens: Tokens, revision: number) {
    return this.store(async () => {
      const current = () => {
        if (revision !== this.revision)
          throw new AuthorizationRequired("Twitch connection was cancelled.");
      };
      current();
      await mkdir(dirname(this.config.tokenFile), {
        recursive: true,
        mode: 0o700,
      });
      const temp = `${this.config.tokenFile}.tmp`;
      try {
        await writeFile(temp, JSON.stringify(tokens), { mode: 0o600 });
        current();
        await rename(temp, this.config.tokenFile);
        current();
        this.tokens = tokens;
      } finally {
        await rm(temp, { force: true });
      }
    });
  }
  private async exchange(body: Record<string, string>) {
    const res = await this.call("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        ...body,
      }),
    });
    if (!res.ok) {
      if ([400, 401, 403].includes(res.status))
        throw new AuthorizationRequired(
          "Twitch authorization failed. Connect Twitch again.",
        );
      throw new Error("Twitch token service unavailable. Retry connection.");
    }
    const data = await res.json();
    if (
      typeof data.access_token !== "string" ||
      typeof data.refresh_token !== "string"
    )
      throw new Error("Twitch returned an invalid token response.");
    const identity = await this.validate(data.access_token);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + identity.expires_in * 1000,
      userId: identity.user_id,
      login: identity.login,
    };
  }
  async acceptCode(code: string) {
    const revision = ++this.revision;
    const tokens = await this.exchange({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri,
    });
    await this.persist(tokens, revision);
  }
  async restore() {
    try {
      this.tokens = JSON.parse(await readFile(this.config.tokenFile, "utf8"));
    } catch (e: any) {
      if (e.code === "ENOENT") return false;
      throw new Error(
        "Stored Twitch credentials could not be read. Reconnect Twitch.",
      );
    }
    if (!this.tokens?.accessToken || !this.tokens.refreshToken) {
      await this.clear();
      return false;
    }
    await this.maintain();
    return true;
  }
  private refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      if (!this.tokens)
        throw new AuthorizationRequired("Connect Twitch first.");
      const previous = this.tokens;
      const revision = this.revision;
      const tokens = await this.exchange({
        grant_type: "refresh_token",
        refresh_token: previous.refreshToken,
      });
      if (tokens.userId !== previous.userId)
        throw new AuthorizationRequired(
          "Twitch account changed. Reconnect Twitch.",
        );
      await this.persist(tokens, revision);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
  async maintain() {
    if (!this.tokens) throw new AuthorizationRequired("Connect Twitch first.");
    if (this.tokens.expiresAt <= Date.now() + 60000) return this.refresh();
    try {
      const data = await this.validate(this.tokens.accessToken);
      if (data.user_id !== this.tokens.userId)
        throw new AuthorizationRequired("Twitch account changed.");
      this.tokens.expiresAt = Date.now() + data.expires_in * 1000;
    } catch (e) {
      if (e instanceof AuthorizationRequired) await this.refresh();
      else throw e;
    }
  }
  async helix(path: string, init: RequestInit) {
    if (!this.tokens) throw new AuthorizationRequired("Connect Twitch first.");
    if (this.tokens.expiresAt <= Date.now() + 60000) await this.refresh();
    const send = () =>
      this.call(`https://api.twitch.tv/helix/${path}`, {
        ...init,
        headers: {
          ...init.headers,
          "Client-Id": this.config.clientId,
          Authorization: `Bearer ${this.tokens!.accessToken}`,
        },
      });
    let res = await send();
    if (res.status === 401) {
      await this.refresh();
      res = await send();
    }
    if (res.status === 401 || res.status === 403)
      throw new AuthorizationRequired(
        "Twitch permission was revoked. Connect Twitch again.",
      );
    return res;
  }
  async clear() {
    this.revision++;
    this.tokens = null;
    await this.store(() => rm(this.config.tokenFile, { force: true }));
  }
  async revoke() {
    const token = this.tokens?.accessToken;
    if (token) {
      const res = await this.call("https://id.twitch.tv/oauth2/revoke", {
        method: "POST",
        body: new URLSearchParams({ client_id: this.config.clientId, token }),
      });
      if (!res.ok)
        throw new Error(
          "Twitch could not revoke authorization. Retry disconnect.",
        );
    }
    await this.clear();
  }
}
