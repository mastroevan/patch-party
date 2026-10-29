import type { AcceptedRule, BuildState, LiveEffect, RuleIntent } from "./rules";
export type RuleId = "classic" | "gravity" | "moon" | "sprint";
export const RULES: Record<
  RuleId,
  { name: string; description: string; icon: string; color: string }
> = {
  classic: {
    name: "Original recipe",
    description:
      "Collect coins. Dodge the spikes. Chat decides what happens next.",
    icon: "✦",
    color: "#b9a4ff",
  },
  gravity: {
    name: "Gravity glitch",
    description: "Every coin flips gravity for 3 seconds. Watch your head.",
    icon: "↕",
    color: "#c7b0ff",
  },
  moon: {
    name: "Moon boots",
    description: "Lower gravity. Higher jumps. A little more airtime.",
    icon: "☾",
    color: "#a6e9dd",
  },
  sprint: {
    name: "Sugar rush",
    description: "Coins give you a 3-second burst of speed.",
    icon: "ϟ",
    color: "#ffcd83",
  },
};
export const CANDIDATES: RuleId[] = ["gravity", "moon", "sprint"];
export type Phase = "lobby" | "playing" | "results" | "reveal";
export interface ChatMessage {
  id: string;
  userId: string;
  name: string;
  text: string;
  source: "simulated" | "twitch";
}
export interface FeedItem {
  id: number;
  name: string;
  text: string;
  kind: "chat" | "system" | "error";
}
export interface PartyState {
  mode: "samples" | "codex";
  build: BuildState;
  intents: Record<string, RuleIntent>;
  proposals: Record<string, string>;
  activeArtifact: AcceptedRule | null;
  effects: LiveEffect[];
  effectEpoch: number;
  runtimeError: string | null;
  sessionId: string;
  phase: Phase;
  paused: boolean;
  round: number;
  roundId: string;
  remainingMs: number;
  score: number;
  best: number;
  coins: number;
  deaths: number;
  activeRule: RuleId;
  activeAuthor: string;
  pendingRule: RuleId | null;
  pendingAuthor: string;
  ballot: "collecting" | "voting" | "locked";
  votes: Record<string, number>;
  authors: Record<string, string>;
  feed: FeedItem[];
  notice: string;
}
export type Action =
  | {
      type:
        | "start"
        | "pause"
        | "finish"
        | "lock"
        | "next"
        | "reset"
        | "retry-build"
        | "cancel-build"
        | "skip-rule"
        | "use-saved-rule";
    }
  | { type: "mode"; mode: "samples" | "codex" }
  | { type: "chat"; message: ChatMessage }
  | { type: "coin"; roundId: string; coinId: number }
  | { type: "death"; roundId: string };
export type ServerMessage =
  | { type: "state"; state: PartyState; controller: boolean }
  | { type: "error"; message: string };
export const ROUND_MS = 45_000;
export function voteCounts(s: PartyState) {
  return CANDIDATES.map(
    (_, i) => Object.values(s.votes).filter((v) => v === i).length,
  );
}
