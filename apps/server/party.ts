import { randomUUID } from "node:crypto";
import {
  CANDIDATES,
  ROUND_MS,
  RULES,
  type Action,
  type ChatMessage,
  type PartyState,
  voteCounts,
} from "../../packages/contracts/index.ts";
export class Party {
  state: PartyState;
  private seen = new Set<string>();
  private lastCoin = new Map<number, number>();
  private lastDeath = -Infinity;
  private sequence = 0;
  private clock = 0;
  constructor() {
    this.state = this.initial();
  }
  private initial(): PartyState {
    return {
      sessionId: randomUUID(),
      phase: "lobby",
      paused: false,
      round: 0,
      roundId: "",
      remainingMs: ROUND_MS,
      score: 0,
      best: 0,
      coins: 0,
      deaths: 0,
      activeRule: "classic",
      activeAuthor: "House rules",
      pendingRule: null,
      pendingAuthor: "",
      ballot: "collecting",
      votes: {},
      authors: {
        gravity: "pixelpilot",
        moon: "lunaloop",
        sprint: "snackattack",
      },
      feed: [],
      notice: "Local playground · built-in sample rules",
    };
  }
  private log(
    name: string,
    text: string,
    kind: "chat" | "system" | "error" = "system",
  ) {
    this.state.feed.push({ id: ++this.sequence, name, text, kind });
    this.state.feed = this.state.feed.slice(-60);
  }
  chat(message: ChatMessage) {
    if (this.seen.has(message.id)) return;
    this.seen.add(message.id);
    if (this.seen.size > 5000)
      this.seen.delete(this.seen.values().next().value!);
    const user = message.userId.trim().toLowerCase(),
      name = message.name.trim().slice(0, 24),
      text = message.text.trim().slice(0, 180);
    if (!user || !name || !text) return;
    this.log(name, text, "chat");
    const vote = /^!vote\s+([123])$/i.exec(text);
    if (vote) {
      if (this.state.ballot !== "voting") {
        this.log("Party", "Voting is closed. Join the next ballot.", "error");
        return;
      }
      this.state.votes = { ...this.state.votes, [user]: Number(vote[1]) - 1 };
      return;
    }
    if (/^!rule\s/i.test(text)) {
      if (this.state.ballot !== "collecting") {
        this.log("Party", "Proposals open again after this ballot.", "error");
        return;
      }
      const proposal = text.replace(/^!rule\s+/i, "");
      const rule = /gravity|flip/i.test(proposal)
        ? "gravity"
        : /moon|jump/i.test(proposal)
          ? "moon"
          : /sprint|speed|sugar/i.test(proposal)
            ? "sprint"
            : null;
      if (!rule) {
        this.log(
          "Party",
          "Local mode supports gravity, moon, or sprint. Freeform Codex rules arrive in milestone 2.",
          "error",
        );
        return;
      }
      this.state.authors[rule] = name;
      this.log("Party", `${name} nominated ${RULES[rule].name}.`);
      return;
    }
    if (text.startsWith("!"))
      this.log(
        "Party",
        "Try !vote 1–3 or !rule gravity, moon, sprint.",
        "error",
      );
  }
  dispatch(a: Action) {
    const s = this.state;
    switch (a.type) {
      case "chat":
        this.chat(a.message);
        break;
      case "start":
        if (s.phase === "lobby") this.beginRound();
        break;
      case "pause":
        if (s.phase === "playing") {
          s.paused = !s.paused;
          this.log("Party", s.paused ? "Round paused." : "Back in action.");
        }
        break;
      case "finish":
        if (s.phase === "playing") this.finish();
        break;
      case "lock":
        if (s.ballot === "voting") this.lock();
        break;
      case "next":
        if (s.phase === "results") {
          s.phase = "reveal";
          s.remainingMs = 3000;
          s.paused = false;
          s.activeRule = s.pendingRule ?? "classic";
          s.activeAuthor = s.pendingAuthor || "House rules";
        }
        break;
      case "reset": {
        const best = s.best;
        this.state = this.initial();
        this.state.best = best;
        this.lastCoin.clear();
        this.seen.clear();
        this.log("Party", "Fresh arena. Session best preserved.");
        break;
      }
      case "coin":
        if (
          s.phase === "playing" &&
          !s.paused &&
          a.roundId === s.roundId &&
          Number.isInteger(a.coinId) &&
          a.coinId >= 0 &&
          a.coinId < 8 &&
          this.clock - (this.lastCoin.get(a.coinId) ?? -Infinity) >= 3500
        ) {
          this.lastCoin.set(a.coinId, this.clock);
          s.coins++;
          s.score += 10;
          s.best = Math.max(s.best, s.score);
        }
        break;
      case "death":
        if (
          s.phase === "playing" &&
          !s.paused &&
          a.roundId === s.roundId &&
          this.clock - this.lastDeath >= 900
        ) {
          this.lastDeath = this.clock;
          s.deaths++;
          s.score = Math.max(0, s.score - 5);
        }
        break;
    }
  }
  private beginRound() {
    const s = this.state;
    s.phase = "playing";
    s.paused = false;
    s.round++;
    s.roundId = randomUUID();
    s.remainingMs = ROUND_MS;
    s.score = 0;
    s.coins = 0;
    s.deaths = 0;
    s.ballot = "voting";
    s.votes = {};
    s.pendingRule = null;
    s.pendingAuthor = "";
    this.lastCoin.clear();
    this.lastDeath = -Infinity;
    this.log("Party", `Round ${s.round} is on. Vote with !vote 1, 2, or 3.`);
  }
  private lock() {
    const s = this.state,
      counts = voteCounts(s),
      max = Math.max(...counts);
    s.ballot = "locked";
    if (max === 0) {
      s.pendingRule = "classic";
      s.pendingAuthor = "House rules";
      this.log("Party", "No votes: next round keeps the original rules.");
      return;
    }
    const index = counts.indexOf(max);
    s.pendingRule = CANDIDATES[index];
    s.pendingAuthor = s.authors[s.pendingRule];
    this.log(
      "Party",
      `${RULES[s.pendingRule].name} wins with ${max} vote${max === 1 ? "" : "s"}. Ties go to the lowest slot.`,
    );
  }
  private finish() {
    const s = this.state;
    if (s.ballot === "voting") this.lock();
    s.phase = "results";
    s.paused = false;
    s.remainingMs = 0;
    s.best = Math.max(s.best, s.score);
    this.log(
      "Party",
      `Round complete: ${s.score} points. Your next patch is ready.`,
    );
  }
  tick(ms: number) {
    this.clock += ms;
    const s = this.state;
    if (s.paused) return;
    if (s.phase === "playing" || s.phase === "reveal") {
      s.remainingMs = Math.max(0, s.remainingMs - ms);
      if (s.remainingMs === 0) {
        if (s.phase === "playing") this.finish();
        else this.beginRound();
      }
    }
  }
}
