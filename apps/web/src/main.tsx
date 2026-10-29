import { BuildPanel } from "./BuildPanel";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  RULES,
  CANDIDATES,
  voteCounts,
  type PartyState,
  type Action,
  type ServerMessage,
} from "../../../packages/contracts";
import { createArena } from "../../../packages/game/Arena";
import "./style.css";
function App() {
  const [state, setState] = useState<PartyState | null>(null),
    [connected, setConnected] = useState(false),
    [controller, setController] = useState(false),
    [error, setError] = useState(""),
    [effect, setEffect] = useState("");
  const [name, setName] = useState("pixelpilot"),
    [message, setMessage] = useState("!vote 1");
  const socket = useRef<WebSocket | null>(null),
    gameHost = useRef<HTMLDivElement>(null),
    feed = useRef<HTMLDivElement>(null);
  const current = useRef({ state, connected, controller });
  current.current = { state, connected, controller };
  const send = useCallback((a: Action) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(a));
      setError("");
    } else setError("Local server disconnected. Waiting to reconnect…");
  }, []);
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    let delay = 500;
    function connect() {
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
      );
      socket.current = ws;
      ws.onopen = () => {
        setConnected(true);
        setError("");
        delay = 500;
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.type === "state") {
          setState(msg.state);
          setController(msg.controller);
        } else setError(msg.message);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) {
          timer = setTimeout(connect, delay);
          delay = Math.min(5000, delay * 2);
        }
      };
    }
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!gameHost.current) return;
    const game = createArena(gameHost.current, {
      get: () => current.current,
      send,
      effect: setEffect,
    });
    return () => game.destroy(true);
  }, [send]);
  useEffect(() => {
    if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [state?.feed.length, state?.feed.at(-1)?.id]);
  function chat(text = message, viewer = name) {
    if (!viewer.trim() || !text.trim()) return;
    send({
      type: "chat",
      message: {
        id: crypto.randomUUID(),
        userId: viewer.trim().toLowerCase(),
        name: viewer,
        text,
        source: "simulated",
      },
    });
  }
  function focusGame() {
    requestAnimationFrame(() => gameHost.current?.focus());
  }
  const counts = state ? voteCounts(state) : [0, 0, 0],
    total = counts.reduce((a, b) => a + b, 0),
    active = {
      ...RULES[state?.activeRule ?? "classic"],
      ...(state?.activeArtifact
        ? {
            name: state.activeArtifact.name,
            description: state.activeArtifact.description,
          }
        : {}),
    },
    can = connected && controller;
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Patch Party home">
          <span className="brand-art" role="img" aria-label="Patch Party">
            <img src="/brand/patchparty.png" alt="" width="896" height="1200" />
          </span>
        </a>
        <nav>
          <span className="nav-active">Playground</span>
          <span className="milestone">MILESTONE 02</span>
        </nav>
        <div className="connection">
          <i className={connected ? "dot" : "dot offline"} />
          {connected ? "Local server online" : "Connecting…"}
          <span className="local-tag">LOCAL DEMO</span>
        </div>
      </header>
      <section className="intro">
        <div>
          <div className="eyebrow">THE COMMUNITY IS IN CONTROL</div>
          <h1>
            Your arena. <em>Their rules.</em>
          </h1>
          <p>
            Collect coins, dodge trouble, and let chat change the next round.
          </p>
        </div>
        <div className="mode-note">
          <span>✳</span>
          <div>
            <strong>A little chaos, locally.</strong>
            <p>
              Simulated chat ·{" "}
              {state?.mode === "codex"
                ? "live Codex builds"
                : "built-in sample rules"}
            </p>
          </div>
        </div>
      </section>
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      {!connected && state && (
        <div className="error" role="status">
          Connection lost. Gameplay is frozen until the local server reconnects.
        </div>
      )}
      {connected && !controller && (
        <div className="error">
          Spectator tab. The first connected tab controls the arena; you can
          still send simulated chat.
        </div>
      )}
      {state?.build && <BuildPanel state={state} can={can} send={send} />}
      <div className="layout">
        <section className="stage-panel">
          <div className="stage-top">
            <div>
              <span className="dot" />
              <strong>THE PLAYGROUND</strong>
              <span className="muted"> / Sector 01</span>
            </div>
            <span className="round-tag">
              ROUND {String(state?.round || 1).padStart(2, "0")}
            </span>
          </div>
          <div className="arena-shell">
            <div
              ref={gameHost}
              className="game-host"
              tabIndex={0}
              aria-label="Game arena. Click to focus, use A D or arrow keys to move, Space or W to jump."
              onKeyDown={(e) => {
                if (
                  [
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown",
                    " ",
                  ].includes(e.key)
                )
                  e.preventDefault();
              }}
            />
            <div className="hud">
              <div className="score">
                <span>SCORE</span>
                <strong data-testid="score">
                  {String(state?.score ?? 0).padStart(3, "0")}
                </strong>
              </div>
              <div
                className={`timer ${(state?.remainingMs ?? 45000) < 10000 ? "urgent" : ""}`}
              >
                <span>◷</span>
                <strong data-testid="timer">
                  {Math.ceil((state?.remainingMs ?? 45000) / 1000)
                    .toString()
                    .padStart(2, "0")}
                </strong>
                <small>SEC</small>
              </div>
              <div className="best">
                <span>SESSION BEST</span>
                <strong>{String(state?.best ?? 0).padStart(3, "0")}</strong>
              </div>
            </div>
            {effect && (
              <div className="effect" role="status">
                {effect}
              </div>
            )}
            {(!state || state.phase === "lobby") && (
              <div className="arena-cover">
                <span
                  className="brand-art welcome-brand"
                  role="img"
                  aria-label="Patch Party"
                >
                  <img
                    src="/brand/patchparty.png"
                    alt=""
                    width="896"
                    height="1200"
                  />
                </span>
                <div className="brand-tagline">
                  Chat invents the rules.
                  <br className="tagline-break" /> Codex makes them playable.
                </div>
                <h2 className="welcome-heading">Ready, player one?</h2>
                <p>
                  45 seconds. A pocketful of coins.
                  <br />
                  An audience with questionable ideas.
                </p>
                <button
                  className="primary"
                  disabled={!can}
                  onClick={() => {
                    send({ type: "start" });
                    focusGame();
                  }}
                >
                  Start round <span>→</span>
                </button>
                <small>Then click the arena to play</small>
              </div>
            )}
            {state?.phase === "playing" && state.paused && (
              <div className="arena-cover">
                <div className="cover-icon">Ⅱ</div>
                <h2>Take a breather.</h2>
                <p>The arena and round timer are paused.</p>
                <button
                  className="primary"
                  disabled={!can}
                  onClick={() => {
                    send({ type: "pause" });
                    focusGame();
                  }}
                >
                  Resume round →
                </button>
              </div>
            )}
            {state?.phase === "results" && (
              <div className="arena-cover results">
                <div className="eyebrow">THAT'S A ROUND</div>
                <h2>
                  {state.score}
                  <span> points</span>
                </h2>
                <p>
                  {state.coins} coins collected · {state.deaths} respawns
                </p>
                <div className="winner">
                  <small>
                    {state.mode === "codex"
                      ? "NEXT ROUND’S RULE"
                      : "NEXT ROUND’S SAMPLE RULE"}
                  </small>
                  <strong>
                    {RULES[state.pendingRule ?? "classic"].icon}{" "}
                    {state.build?.artifact?.name ??
                      RULES[state.pendingRule ?? "classic"].name}
                  </strong>
                  <span>
                    {state.mode === "codex" && state.pendingRule !== "classic"
                      ? state.intents[state.pendingRule!]?.description
                      : RULES[state.pendingRule ?? "classic"].description}
                  </span>
                </div>
                <button
                  className="primary"
                  disabled={
                    !can ||
                    (state.mode === "codex" &&
                      state.pendingRule !== "classic" &&
                      state.build.status !== "ready")
                  }
                  onClick={() => {
                    send({ type: "next" });
                    focusGame();
                  }}
                >
                  Play next round →
                </button>
              </div>
            )}
            {state?.phase === "reveal" && (
              <div className="arena-cover reveal">
                <div className="eyebrow">PATCH INCOMING</div>
                <h2>
                  {active.icon} {active.name}
                </h2>
                <p>{active.description}</p>
                <strong className="countdown">
                  {Math.ceil(state.remainingMs / 1000)}
                </strong>
              </div>
            )}
          </div>
          <div className="controls">
            <div>
              <kbd>A</kbd>
              <kbd>D</kbd>
              <span>move</span>
              <kbd>SPACE</kbd>
              <span>jump</span>
              <span className="control-hint">Click arena to focus</span>
            </div>
            <div>
              <button
                disabled={!can || state?.phase !== "playing"}
                onClick={() => {
                  send({ type: "pause" });
                  focusGame();
                }}
              >
                {state?.paused ? "▶ Resume" : "Ⅱ Pause"}
              </button>
              <button
                disabled={!can || state?.phase !== "playing"}
                onClick={() => send({ type: "finish" })}
              >
                End round
              </button>
              <button disabled={!can} onClick={() => send({ type: "reset" })}>
                ↺ Reset
              </button>
            </div>
          </div>
          <div className="active-rule">
            <div className="rule-icon">{active.icon}</div>
            <div>
              <small>
                ON THE FIELD{" "}
                <span>
                  {state?.activeArtifact ? "CODEX GENERATED" : "BUILT-IN"}
                </span>
              </small>
              <h3>{active.name}</h3>
              <p>{active.description}</p>
            </div>
            <span className="author">
              {state?.activeAuthor ?? "House rules"}
            </span>
          </div>
        </section>
        <aside className="chat-panel">
          <div className="panel-heading">
            <h2>
              Community lab <span>◌</span>
            </h2>
            <span className="badge">SIMULATED</span>
          </div>
          <div className="chat-explainer">
            Be the chat. Switch your viewer name to try a community vote.
          </div>
          <div
            className="chat-feed"
            ref={feed}
            role="log"
            aria-label="Simulated chat messages"
          >
            <div className="system-intro">
              <span>✳</span>
              <strong>Welcome to the party.</strong>
              <p>
                Before starting, nominate a sample with{" "}
                <code>!rule gravity</code>, <code>!rule moon</code>, or{" "}
                <code>!rule sprint</code>. Once the round starts, use{" "}
                <code>!vote 1–3</code>.
              </p>
            </div>
            {state?.feed.map((item) => (
              <div key={item.id} className={`chat-line ${item.kind}`}>
                <strong>{item.name}</strong>
                <span>{item.text}</span>
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              chat();
            }}
          >
            <label htmlFor="viewer">SIMULATED VIEWER</label>
            <div className="viewer-input">
              <span>◉</span>
              <input
                id="viewer"
                value={name}
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                required
                aria-label="Viewer name"
              />
            </div>
            <div className="message-input">
              <input
                aria-label="Chat command"
                value={message}
                maxLength={180}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="!vote 1"
                required
              />
              <button disabled={!connected} aria-label="Send chat message">
                ↑
              </button>
            </div>
            <div className="quick-votes">
              <span>QUICK VOTE</span>
              {[1, 2, 3].map((i) => (
                <button
                  key={i}
                  type="button"
                  disabled={!connected || state?.ballot !== "voting"}
                  onClick={() => chat(`!vote ${i}`)}
                >
                  {i}
                </button>
              ))}
            </div>
          </form>
        </aside>
      </div>
      <section className="ballot">
        <div className="ballot-title">
          <div>
            <div className="eyebrow">NEXT ROUND, NEW PROBLEMS</div>
            <h2>Pick your plot twist.</h2>
          </div>
          <div className="ballot-status">
            <span
              className={`badge ${state?.ballot === "voting" ? "open" : ""}`}
            >
              {state?.ballot === "voting"
                ? "VOTING OPEN"
                : state?.ballot === "locked"
                  ? "VOTE LOCKED"
                  : "OPENS WITH ROUND"}
            </span>
            <span>
              {total} vote{total === 1 ? "" : "s"}
            </span>
            <button
              disabled={!can || state?.ballot !== "voting"}
              onClick={() => send({ type: "lock" })}
            >
              Lock vote
            </button>
          </div>
        </div>
        <div className="rule-cards">
          {CANDIDATES.map((id, i) => {
            const r = RULES[id],
              winner = state?.pendingRule === id;
            return (
              <article
                key={id}
                className={`rule-card ${winner ? "selected" : ""}`}
                style={{ "--rule-color": r.color } as React.CSSProperties}
              >
                <div className="card-top">
                  <span className="card-icon">{r.icon}</span>
                  <span className="card-type">
                    {winner
                      ? "WINNING PATCH"
                      : state?.mode === "codex"
                        ? "CODEX PROPOSAL"
                        : "SAMPLE RULE"}
                  </span>
                  <kbd>{i + 1}</kbd>
                </div>
                <h3>{r.name}</h3>
                <p>
                  {state?.mode === "codex"
                    ? state.intents[id]?.description
                    : r.description}
                </p>
                <div className="card-bottom">
                  <span>@{state?.authors[id] ?? "community"}</span>
                  <strong>
                    {counts[i]} <small>votes</small>
                  </strong>
                </div>
                <div className="vote-track">
                  <div
                    style={{
                      width: `${total ? (counts[i] / total) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="vote-command">
                  Vote with <code>!vote {i + 1}</code>
                </div>
              </article>
            );
          })}
        </div>
        <p className="ballot-foot">
          One vote per viewer. Change your vote anytime before lock. Ties go to
          the lowest slot; no votes keeps the original rules.
        </p>
      </section>
      <footer>
        <span>
          <b>✳</b> Built for the beautifully unpredictable.
        </span>
        <span>
          Milestone 2 · Live Codex available · Twitch chat still simulated
        </span>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
