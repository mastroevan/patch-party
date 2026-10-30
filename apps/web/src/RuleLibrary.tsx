import type { Action, PartyState } from "../../../packages/contracts";
export function RuleLibrary({
  state,
  can,
  send,
}: {
  state: PartyState;
  can: boolean;
  send: (a: Action) => void;
}) {
  const rules = state.library ?? [];
  const between = state.phase === "lobby" || state.phase === "results";
  return (
    <section
      className="build-panel library-panel"
      aria-label="Saved rule library"
    >
      <div className="build-header">
        <div>
          <div className="eyebrow">KEEP THE GOOD CHAOS</div>
          <h2>Your rule library</h2>
        </div>
        <span className="badge">{rules.length} SAVED</span>
      </div>
      <p>
        Accepted rules stay here after a restart. Queue a saved rule in the
        lobby or between rounds, then preview it before playing.
      </p>
      {rules.length === 0 ? (
        <p className="library-empty">
          Your first accepted rule will appear here. If a build fails, use a
          verified baseline in the Rule Workshop or play original rules.
        </p>
      ) : (
        <div className="library-grid">
          {rules.map((rule) => (
            <article className="library-card" key={rule.hash}>
              <h3>{rule.name}</h3>
              <p>{rule.description}</p>
              <small>
                Suggested by @{rule.author} · saved{" "}
                {new Date(rule.savedAt).toLocaleDateString()}
              </small>
              <button
                disabled={!can || !between}
                onClick={() => send({ type: "load-rule", hash: rule.hash })}
              >
                Queue saved rule
              </button>
            </article>
          ))}
        </div>
      )}
      {!between && rules.length > 0 && (
        <small>
          Finish this round to queue a saved rule. The current arena keeps its
          active rule.
        </small>
      )}
    </section>
  );
}
