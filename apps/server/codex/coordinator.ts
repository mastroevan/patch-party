import { randomUUID } from "node:crypto";
import { Party } from "../party.ts";
import {
  generateRule,
  loadSavedRule,
  type GenerationRequest,
} from "./generate.ts";
import {
  executeRule,
  validateModule,
} from "../../../packages/rule-runner/index.ts";
import type {
  AcceptedRule,
  RuleInput,
} from "../../../packages/contracts/rules.ts";
export type Generator = (request: GenerationRequest) => Promise<AcceptedRule>;
export class RuleCoordinator {
  private job: {
    key: string;
    controller: AbortController;
    promise: Promise<void>;
  } | null = null;
  private lastRound = "";
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  constructor(
    private party: Party,
    private changed: () => void,
    private generate: Generator = generateRule,
    private deadlineMs = 120000,
  ) {}
  reconcile() {
    if (this.disposed) return;
    const s = this.party.state;
    const key = `${s.sessionId}:${s.roundId}`;
    if (this.job && (this.job.key !== key || s.build.status === "cancelled"))
      this.job.controller.abort();
    if (s.phase === "playing" && s.roundId !== this.lastRound) {
      this.lastRound = s.roundId;
      if (s.activeArtifact)
        this.event({ event: "roundStart", coinCount: 0, round: s.round });
    }
    if (
      s.mode !== "codex" ||
      s.ballot !== "locked" ||
      !s.pendingRule ||
      s.pendingRule === "classic" ||
      s.build.status !== "idle" ||
      this.job
    )
      return;
    const intent = s.intents[s.pendingRule],
      jobId = randomUUID(),
      controller = new AbortController();
    s.build = {
      status: "generating",
      jobId,
      threadId: null,
      attempt: 1,
      startedAt: Date.now(),
      elapsedMs: 0,
      message: "Starting the Codex rule builder.",
      artifact: null,
    };
    const current = () =>
      !this.disposed &&
      this.party.state.sessionId === s.sessionId &&
      this.party.state.roundId === s.roundId &&
      this.party.state.build.jobId === jobId &&
      !controller.signal.aborted;
    const timer = setTimeout(() => {
      controller.abort();
      if (this.party.state.build.jobId === jobId) {
        this.party.state.build.status = "failed";
        this.party.state.build.message =
          "Generation timed out after 120 seconds. Retry or play original rules.";
        this.changed();
      }
    }, this.deadlineMs);
    const promise = this.generate({
      jobId,
      proposal: s.proposals[s.pendingRule],
      intent,
      signal: controller.signal,
      onProgress: (update) => {
        if (current()) {
          Object.assign(this.party.state.build, update, {
            elapsedMs: Date.now() - s.build.startedAt!,
          });
          this.changed();
        }
      },
    })
      .then((artifact) => {
        if (current()) {
          Object.assign(this.party.state.build, {
            status: "ready",
            artifact,
            threadId: artifact.threadId,
            elapsedMs: artifact.generationMs,
            message: "Trusted checks passed. Ready for the next round.",
          });
        }
      })
      .catch((error) => {
        if (current()) {
          this.party.state.build.status = "failed";
          this.party.state.build.message = String(error.message ?? error).slice(
            0,
            600,
          );
        }
      })
      .finally(() => {
        clearTimeout(timer);
        if (this.job?.controller === controller) this.job = null;
        this.changed();
      });
    this.job = { key, controller, promise };
    this.changed();
  }
  event(input: RuleInput) {
    const s = this.party.state,
      artifact = s.activeArtifact;
    if (!artifact) return;
    const session = s.sessionId,
      round = s.roundId,
      epoch = s.effectEpoch;
    this.queue = this.queue.then(async () => {
      const valid = () =>
        !this.disposed &&
        this.party.state.sessionId === session &&
        this.party.state.roundId === round &&
        this.party.state.effectEpoch === epoch &&
        this.party.state.activeArtifact?.hash === artifact.hash &&
        this.party.state.phase === "playing";
      if (!valid()) return;
      try {
        const [commands] = await executeRule(artifact.source, [input]);
        if (!valid()) return;
        const state = this.party.state;
        state.effects = commands.length
          ? commands.map((c) => ({ ...c, remainingMs: c.durationMs }))
          : state.effects;
        this.changed();
      } catch (error) {
        if (valid()) {
          this.party.state.activeArtifact = null;
          this.party.state.activeRule = "classic";
          this.party.state.effects = [];
          this.party.state.effectEpoch++;
          this.party.state.runtimeError = `Rule disabled; original physics restored. ${String((error as Error).message).slice(0, 180)}`;
          this.changed();
        }
      }
    });
  }
  async useSavedRule(): Promise<boolean> {
    const s = this.party.state;
    if (s.mode !== "codex" || !s.pendingRule || s.pendingRule === "classic")
      return false;
    const intent = s.intents[s.pendingRule];
    const saved = await loadSavedRule(intent);
    if (!saved) return false;
    const checks = await validateModule(saved, intent);
    s.build = {
      status: "ready",
      jobId: randomUUID(),
      threadId: saved.threadId,
      attempt: 1,
      startedAt: Date.now(),
      elapsedMs: saved.generationMs,
      message: "Loaded verified rule from library (saved artifact).",
      artifact: { ...saved, checks },
    };
    this.changed();
    return true;
  }
  async settled() {
    await this.job?.promise;
    await this.queue;
  }
  dispose() {
    this.disposed = true;
    this.job?.controller.abort();
  }
}
