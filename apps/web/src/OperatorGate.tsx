import React, { useEffect, useState } from "react";
export function OperatorGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false),
    [checking, setChecking] = useState(true);
  const [key, setKey] = useState(""),
    [error, setError] = useState("");
  async function login(value: string) {
    const res = await fetch("/api/operator/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: value }),
    });
    if (!res.ok)
      throw new Error(
        res.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "Operator key was not accepted. Use the link printed by npm run dev.",
      );
    setReady(true);
    setKey("");
  }
  useEffect(() => {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const value = fragment.get("operator");
    if (value)
      history.replaceState(null, "", location.pathname + location.search);
    void (async () => {
      if (value) await login(value);
      else {
        const res = await fetch("/api/operator/session");
        if (!res.ok)
          throw new Error(
            "Local server is unavailable. Start npm run dev and reload.",
          );
        setReady((await res.json()).authenticated === true);
      }
    })()
      .catch((e) => setError(e.message))
      .finally(() => setChecking(false));
  }, []);
  if (ready) return children;
  return (
    <main className="operator-login">
      <section className="build-panel">
        <div className="eyebrow">PATCH PARTY · STREAMER ACCESS</div>
        <h1>Open your control room.</h1>
        <p>
          Use the operator link printed in your local terminal, or enter its key
          below.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void login(key).catch((e) => setError(e.message));
          }}
        >
          <label htmlFor="operator-key">Operator key</label>
          <input
            id="operator-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            required
          />
          <button className="primary" disabled={checking}>
            Unlock controls
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        <p>
          <a href="/overlay">Open read-only OBS overlay →</a>
        </p>
      </section>
    </main>
  );
}
