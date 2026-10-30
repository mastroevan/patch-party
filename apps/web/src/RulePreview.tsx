import { useState } from "react";
import type { Action } from "../../../packages/contracts";
import type { RulePreview as Preview } from "../../../packages/contracts/library";
export function RulePreview({
  preview,
  can,
  send,
}: {
  preview: Preview;
  can: boolean;
  send: (a: Action) => void;
}) {
  const [index, setIndex] = useState(0);
  const sample = preview.samples[Math.min(index, preview.samples.length - 1)];
  const command = sample.commands[0];
  const label = !command
    ? "Original physics for this event"
    : command.kind === "gravity"
      ? command.value < 0
        ? "GRAVITY FLIPPED"
        : "LOW GRAVITY"
      : "SPEED BOOST";
  return (
    <section className="rule-preview" aria-label="Isolated rule preview">
      <div className="build-header">
        <div>
          <div className="eyebrow">NEXT RULE · PREVIEW</div>
          <h3>{preview.name}</h3>
          <p>Suggested by @{preview.author}</p>
        </div>
        <button disabled={!can} onClick={() => send({ type: "close-preview" })}>
          Close preview
        </button>
      </div>
      <p>
        This preview uses isolated rule checks. Your live arena, score and timer
        are unchanged.
      </p>
      <div
        className={`preview-stage ${command?.kind === "gravity" && command.value < 0 ? "inverted" : ""}`}
      >
        <span className="preview-player" aria-hidden="true">
          ✦
        </span>
        <strong role="status">{label}</strong>
        {command && (
          <span>{(command.durationMs / 1000).toFixed(1)} seconds</span>
        )}
      </div>
      <div className="preview-scenarios">
        {preview.samples.map((s, i) => (
          <button
            key={i}
            disabled={!can}
            aria-pressed={index === i}
            onClick={() => setIndex(i)}
          >
            {s.input.event === "roundStart"
              ? "Round start"
              : `Coin ${s.input.coinCount}`}
          </button>
        ))}
      </div>
      <small>
        Only the next round’s explicit activation changes the arena.
      </small>
    </section>
  );
}
