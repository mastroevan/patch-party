import React, { useEffect, useState } from "react";
import type { OverlayState } from "../../../packages/contracts/overlay";
export function Overlay() {
  const [state, setState] = useState<OverlayState | null>(null),
    [connected, setConnected] = useState(false);
  useEffect(() => {
    document.documentElement.classList.add("overlay-mode");
    let stopped = false,
      ws: WebSocket,
      timer: ReturnType<typeof setTimeout>;
    function connect() {
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/overlay`,
      );
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "overlay") setState(msg.state);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) timer = setTimeout(connect, 1000);
      };
    }
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
      document.documentElement.classList.remove("overlay-mode");
    };
  }, []);
  return (
    <main
      className="broadcast-overlay"
      aria-label="Read-only broadcast overlay"
    >
      <header>
        <strong>✳ PATCH PARTY</strong>
        <span>
          ROUND {state?.round || 1} · {state?.score || 0} POINTS
        </span>
        <span>
          {connected
            ? "Overlay connected"
            : "Overlay reconnecting · state frozen"}
        </span>
      </header>
      <section className="overlay-active">
        <div>
          <small>ON THE FIELD · @{state?.active.author || "community"}</small>
          <h1>{state?.active.name || "Welcome to Patch Party"}</h1>
          <p>
            {state?.active.description ||
              "Chat invents the rules. The streamer plays them."}
          </p>
        </div>
        <strong className="overlay-clock">
          {state?.paused
            ? "PAUSED"
            : `${Math.ceil((state?.remainingMs || 0) / 1000)}s`}
        </strong>
      </section>
      <div className="overlay-instructions">
        <strong>CHAT INVENTS. THE STREAMER PLAYS.</strong>
        <span>
          Before the round: <code>!rule gravity</code> · During the round:{" "}
          <code>!vote 1–3</code>
        </span>
      </div>
      {state?.next && (
        <section className="overlay-next" aria-label="Next rule">
          <small>
            {state.next.source === "library"
              ? "STREAMER SELECTED · SAVED RULE"
              : "CHAT CHOSE · NEXT ROUND"}
          </small>
          <strong>{state.next.name}</strong>
          <span>
            {state.next.description} · Suggested by @{state.next.author}
          </span>
          <em>
            {state.build.status === "failed" ||
            state.build.status === "cancelled"
              ? "Streamer recovery in progress · voting is closed"
              : state.build.status === "ready"
                ? "Ready for the next round"
                : "The next rule is being prepared"}
          </em>
        </section>
      )}
      <section className="overlay-ballot" aria-label="Viewer ballot">
        <h2>
          {state?.ballot.status === "voting"
            ? "VOTE NOW · !vote 1–3"
            : state?.ballot.status === "locked"
              ? "VOTE LOCKED"
              : "PROPOSE A RULE · !rule gravity"}
        </h2>
        <div className="overlay-cards">
          {state?.ballot.candidates.map((candidate, i) => (
            <article key={i}>
              <span>!vote {i + 1}</span>
              <h3>{candidate.name}</h3>
              <p>{candidate.description}</p>
              <strong>
                {state.ballot.counts[i]}{" "}
                {state.ballot.counts[i] === 1 ? "vote" : "votes"}
              </strong>
              <small>@{candidate.author}</small>
            </article>
          ))}
        </div>
        <p>
          {state?.ballot.total || 0} votes · One vote per viewer · Latest vote
          counts
        </p>
      </section>
      <footer>
        <span>
          {state?.twitch.state === "connected"
            ? `LIVE CHAT · @${state.twitch.channel}`
            : "CHAT OFFLINE · commands may be missed"}
        </span>
        <span>
          RULE BUILDER · {state?.build.status.toUpperCase() || "IDLE"}
        </span>
      </footer>
    </main>
  );
}
