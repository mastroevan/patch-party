export interface OverlayState {
  phase: "lobby" | "playing" | "results" | "reveal";
  paused: boolean;
  round: number;
  remainingMs: number;
  score: number;
  active: { name: string; description: string; author: string };
  ballot: {
    status: "collecting" | "shortlisted" | "voting" | "locked";
    counts: number[];
    total: number;
    candidates: { name: string; description: string; author: string }[];
  };
  next: {
    name: string;
    description: string;
    author: string;
    source: string;
  } | null;
  build: { status: string };
  twitch: { state: string; channel: string | null; gap: boolean };
}
