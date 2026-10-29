export interface RuleIntent {
  slot: "gravity" | "moon" | "sprint";
  hook: "coin" | "roundStart";
  kind: "gravity" | "speed";
  value: number;
  durationMs: number;
  every: number;
  description: string;
}
export interface RuleInput {
  event: "coin" | "roundStart";
  coinCount: number;
  round: number;
}
export interface RuleCommand {
  kind: "gravity" | "speed";
  value: number;
  durationMs: number;
}
export interface GeneratedModule {
  name: string;
  description: string;
  source: string;
}
export interface AcceptedRule extends GeneratedModule {
  hash: string;
  threadId: string;
  createdAt: string;
  intent: RuleIntent;
  checks: string[];
  generationMs: number;
}
export interface BuildState {
  status:
    "idle" | "generating" | "validating" | "ready" | "failed" | "cancelled";
  jobId: string | null;
  threadId: string | null;
  attempt: number;
  startedAt: number | null;
  elapsedMs: number;
  message: string;
  artifact: AcceptedRule | null;
}
export interface LiveEffect extends RuleCommand {
  remainingMs: number;
}
export function idleBuild(): BuildState {
  return {
    status: "idle",
    jobId: null,
    threadId: null,
    attempt: 0,
    startedAt: null,
    elapsedMs: 0,
    message: "Choose Codex mode to build the winning rule.",
    artifact: null,
  };
}
export function defaultIntent(slot: "gravity" | "moon" | "sprint"): RuleIntent {
  if (slot === "moon")
    return {
      slot,
      hook: "roundStart",
      kind: "gravity",
      value: 430,
      durationMs: 45000,
      every: 1,
      description: "Lower gravity for the whole round.",
    };
  return {
    slot,
    hook: "coin",
    kind: slot === "gravity" ? "gravity" : "speed",
    value: slot === "gravity" ? -850 : 390,
    durationMs: 3000,
    every: 1,
    description:
      slot === "gravity"
        ? "Every coin flips gravity for 3 seconds."
        : "Every coin boosts movement speed for 3 seconds.",
  };
}
/** Deliberately small, explicit proposal language. Reject unknown requests instead of claiming to implement them. */
export function parseProposal(text: string): RuleIntent | null {
  const simple = text.trim().toLowerCase().replace(/[.!]$/, "");
  if (
    ["gravity", "moon", "sprint", "moon boots", "coins flip gravity"].includes(
      simple,
    )
  )
    return defaultIntent(
      simple.includes("moon")
        ? "moon"
        : simple === "sprint"
          ? "sprint"
          : "gravity",
    );
  const match =
    /^(?:every (coin|second coin|third coin)|coins?) (?:flips? gravity|(?:gives? (?:a )?)?(?:speed boost|boosts? speed)) (?:for )?([1-5]) seconds?$/i.exec(
      simple,
    );
  if (!match) return null;
  const slot = simple.includes("gravity") ? "gravity" : "sprint";
  const result = defaultIntent(slot);
  result.durationMs = Number(match[2]) * 1000;
  result.every =
    match[1] === "second coin" ? 2 : match[1] === "third coin" ? 3 : 1;
  result.description = `Every ${result.every === 1 ? "coin" : result.every === 2 ? "second coin" : "third coin"} ${slot === "gravity" ? "flips gravity" : "boosts movement speed"} for ${match[2]} seconds.`;
  return result;
}
