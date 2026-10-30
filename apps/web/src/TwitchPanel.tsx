import React, { useState } from "react";
import type { TwitchStatus } from "../../../packages/contracts/twitch";
export function TwitchPanel({
  status,
  can,
}: {
  status: TwitchStatus | null;
  can: boolean;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function action(path: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/twitch/${path}`, { method: "POST" });
      if (!res.ok)
        throw new Error((await res.json()).error || "Twitch request failed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="build-panel twitch-panel"
      aria-label="Twitch connection"
    >
      <div className="build-header">
        <div>
          <div className="eyebrow">LIVE COMMUNITY</div>
          <h2>Twitch control room</h2>
        </div>
        <span
          className={`badge ${status?.state === "connected" ? "open" : ""}`}
        >
          {status?.state.replaceAll("_", " ").toUpperCase() || "CONNECTING"}
        </span>
      </div>
      <p role="status">
        {status?.channel ? `@${status.channel} · ` : ""}
        {status?.message || "Checking Twitch connection…"}
      </p>
      {status?.gap && (
        <p className="twitch-gap">
          Some chat may have been missed during a connection gap. Viewers can
          resend commands while the ballot is open.
        </p>
      )}
      <div className="build-actions">
        {status?.configured && (
          <a className="primary" href="/api/twitch/authorize">
            Connect Twitch
          </a>
        )}
        {!status?.configured && (
          <p>
            Add your Twitch app’s client ID and secret to <code>.env</code>,
            then restart the server. Setup: <code>docs/milestone-3.md</code>.
          </p>
        )}
        {status?.channel && (
          <>
            <button
              disabled={!can || busy}
              onClick={() => void action("reconnect")}
            >
              Reconnect chat
            </button>
            <button
              disabled={!can || busy}
              onClick={() => void action("disconnect")}
            >
              Disconnect Twitch
            </button>
            <a href="/api/twitch/proof" target="_blank" rel="noreferrer">
              View live test evidence
            </a>
          </>
        )}
        <a href="/overlay" target="_blank" rel="noreferrer">
          Open OBS overlay ↗
        </a>
      </div>
      {status?.lastMessageAt && (
        <small>
          Last Twitch event:{" "}
          {new Date(status.lastMessageAt).toLocaleTimeString()} · reconnects:{" "}
          {status.reconnects}
        </small>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
