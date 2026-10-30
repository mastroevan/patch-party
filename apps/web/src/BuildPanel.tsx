import { RulePreview } from "./RulePreview";
import type { Action, PartyState } from "../../../packages/contracts";
export function BuildPanel({
  state,
  can,
  send,
}: {
  state: PartyState;
  can: boolean;
  send: (action: Action) => void;
}) {
  const b = state.build,
    busy = ["generating", "validating"].includes(b.status),
    artifact = b.artifact ?? state.activeArtifact;
  const seconds = b.startedAt
    ? Math.floor((busy ? Date.now() - b.startedAt : b.elapsedMs) / 1000)
    : 0;
  return (
    <section className="build-panel" aria-label="Codex rule builder">
      <div className="build-header">
        <div>
          <div className="eyebrow">THE RULE WORKSHOP</div>
          <h2>From chat to playable code.</h2>
        </div>
        <label className="mode-select">
          RULE ENGINE
          <select
            aria-label="Rule engine"
            disabled={!can || state.phase !== "lobby"}
            value={state.mode}
            onChange={(e) =>
              send({
                type: "mode",
                mode: e.target.value as "samples" | "codex",
              })
            }
          >
            <option value="samples">Built-in samples</option>
            <option value="codex">Live Codex</option>
          </select>
        </label>
      </div>
      <p className="build-explainer">
        {state.mode === "codex"
          ? "Lock a winning vote to start a real Codex build. Play continues while isolated workers check the code."
          : "Samples are ready instantly. Select Live Codex in the lobby to generate and validate the winning mechanic."}
      </p>
      {state.mode === "codex" && (
        <>
          <div
            className="build-pipeline"
            aria-label={`Build status: ${b.status}`}
          >
            <span className={state.ballot === "locked" ? "complete" : ""}>
              01 · Chat chose
            </span>
            <span
              className={
                b.status === "generating"
                  ? "current"
                  : b.status === "ready" || b.status === "validating"
                    ? "complete"
                    : ""
              }
            >
              02 · Codex builds
            </span>
            <span
              className={
                b.status === "validating"
                  ? "current"
                  : b.status === "ready"
                    ? "complete"
                    : ""
              }
            >
              03 · Checks
            </span>
            <span className={b.status === "ready" ? "complete" : ""}>
              04 · Ready
            </span>
          </div>
          <div className={`build-status ${b.status}`} role="status">
            <strong>{b.status.toUpperCase()}</strong>
            <span>{b.message}</span>
            {b.startedAt && (
              <small>
                {seconds}s · attempt {b.attempt}/2
              </small>
            )}
          </div>
          <p className="proposal-help">
            Try <code>!rule every second coin flips gravity for 2 seconds</code>{" "}
            before starting. Supported: gravity flips or speed boosts on every
            first/second/third coin for 1–5 seconds, plus Moon Boots.
            Unsupported requests are rejected explicitly.
          </p>
          <div className="build-actions">
            {b.status === "ready" && b.artifact && (
              <button
                disabled={!can}
                onClick={() => send({ type: "preview-rule" })}
              >
                Preview next rule
              </button>
            )}
            {state.selectionSource === "library" && (
              <p className="queued-rule" role="status">
                Saved rule queued · {b.artifact?.name}. Activate it with{" "}
                {state.phase === "lobby" ? "Start round" : "Play next round"}.
              </p>
            )}
            {state.phase === "lobby" &&
              b.status === "ready" &&
              state.selectionSource === "library" && (
                <button
                  disabled={!can}
                  onClick={() => send({ type: "skip-rule" })}
                >
                  Cancel queued rule
                </button>
              )}
            {busy && (
              <button
                disabled={!can}
                onClick={() => send({ type: "cancel-build" })}
              >
                Cancel build
              </button>
            )}
            {["failed", "cancelled"].includes(b.status) &&
              state.pendingRule !== "classic" && (
                <>
                  <button
                    disabled={!can}
                    onClick={() => send({ type: "retry-build" })}
                  >
                    Retry build
                  </button>
                  <button
                    disabled={!can}
                    onClick={() => send({ type: "use-saved-rule" })}
                  >
                    Use saved rule · library
                  </button>
                </>
              )}
            {state.phase === "results" && state.pendingRule !== "classic" && (
              <button
                disabled={!can}
                onClick={() => send({ type: "skip-rule" })}
              >
                Skip rule · play original
              </button>
            )}
          </div>
        </>
      )}
      {state.preview && (
        <RulePreview
          key={state.preview.hash}
          preview={state.preview}
          can={can}
          send={send}
        />
      )}
      {state.runtimeError && (
        <p className="error" role="alert">
          {state.runtimeError}
        </p>
      )}
      {artifact && (
        <details className="build-evidence">
          <summary>
            Inspect generated code & validation evidence{" "}
            <span>{artifact.hash.slice(0, 12)}</span>
          </summary>
          <dl>
            <dt>Source</dt>
            <dd>
              {artifact.origin === "library"
                ? "Saved rule · library"
                : "Live Codex generation"}
            </dd>
            <dt>Codex thread</dt>
            <dd>{artifact.threadId}</dd>
            <dt>SHA-256</dt>
            <dd>{artifact.hash}</dd>
            <dt>Generation</dt>
            <dd>
              {(artifact.generationMs / 1000).toFixed(1)} seconds ·{" "}
              {artifact.createdAt}
            </dd>
          </dl>
          <ul>
            {artifact.checks.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <pre>
            <code>{artifact.source}</code>
          </pre>
          <small>
            This is the accepted artifact. Runtime generation threads are
            separate from the project development thread required for
            submission.
          </small>
        </details>
      )}
    </section>
  );
}
