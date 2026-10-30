import { randomUUID } from "node:crypto";
import { Party } from "../party.ts";
import {
  generateRule,
  loadSavedRule,
  type GenerationRequest,
} from "./generate.ts";
import { executeRule } from "../../../packages/rule-runner/index.ts";
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
  private previewSequence = 0;
  constructor(
    private party: Party,
    private changed: () => void,
    private generate: Generator = generateRule,
    private deadlineMs = 120000,
    private accepted: (
      artifact: AcceptedRule,
      author: string,
      proposal: string,
    ) => Promise<void> = async () => {},
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
      proposal = s.proposals[s.pendingRule],
      author = s.pendingAuthor,
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
    let abortJob: () => void;
    const aborted = new Promise<never>((_, reject) => {
      abortJob = () => reject(new Error("Build cancelled."));
      controller.signal.addEventListener("abort", abortJob, { once: true });
    });
    const generate = () =>
      this.generate({
        jobId,
        proposal,
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
      });
    let generated: Promise<AcceptedRule>;
    try {
      generated = generate();
    } catch (error) {
      generated = Promise.reject(error);
    }
    const promise = Promise.race([generated, aborted])
      .then(async (artifact) => {
        if (current()) {
          await this.accepted(artifact, author, proposal);
          if (!current()) return;
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
        controller.signal.removeEventListener("abort", abortJob!);
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
    if (
      s.mode !== "codex" ||
      !s.pendingRule ||
      s.pendingRule === "classic" ||
      !["failed", "cancelled"].includes(s.build.status)
    )
      return false;
    const jobId = s.build.jobId;
    const pendingRule = s.pendingRule;
    const current = () =>
      !this.disposed &&
      this.party.state === s &&
      s.build.jobId === jobId &&
      s.pendingRule === pendingRule &&
      ["failed", "cancelled"].includes(s.build.status);
    const intent = s.intents[s.pendingRule];
    const saved = await loadSavedRule(intent);
    if (!saved || !current()) return false;
    const checks = saved.checks;
    if (!current()) return false;
    await this.accepted(
      { ...saved, checks },
      s.pendingAuthor,
      s.proposals[pendingRule],
    );
    if (!current()) return false;
    this.job?.controller.abort();
    s.preview = null;
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
  closePreview() {
    this.previewSequence++;
    this.party.state.preview = null;
  }
  async previewRule() {
    const sequence = ++this.previewSequence;
    const s = this.party.state,
      artifact = s.build.artifact,
      build = s.build;
    if (build.status !== "ready" || !artifact)
      throw new Error("Choose a ready rule to preview.");
    const inputs: RuleInput[] = [
      { event: "roundStart", coinCount: 0, round: Math.max(1, s.round + 1) },
      ...[1, 2, 3].map((coinCount) => ({
        event: "coin" as const,
        coinCount,
        round: Math.max(1, s.round + 1),
      })),
    ];
    const outputs = await executeRule(artifact.source, inputs);
    if (
      this.disposed ||
      sequence !== this.previewSequence ||
      this.party.state !== s ||
      s.build !== build
    )
      return;
    s.preview = {
      hash: artifact.hash,
      name: artifact.name,
      author: s.pendingAuthor,
      samples: inputs.map((input, i) => ({ input, commands: outputs[i] })),
    };
    this.changed();
  }
  queueSavedRule(artifact: AcceptedRule, author: string, proposal: string) {
    const s = this.party.state;
    if (!["lobby", "results"].includes(s.phase))
      throw new Error("Queue saved rules in the lobby or between rounds.");
    this.job?.controller.abort();
    s.mode = "codex";
    s.pendingRule = artifact.intent.slot;
    s.pendingAuthor = author;
    s.selectionSource = "library";
    s.intents[artifact.intent.slot] = artifact.intent;
    s.proposals[artifact.intent.slot] = proposal;
    s.authors[artifact.intent.slot] = author;
    s.preview = null;
    s.build = {
      status: "ready",
      artifact,
      jobId: randomUUID(),
      threadId: artifact.threadId,
      attempt: 1,
      startedAt: Date.now(),
      elapsedMs: artifact.generationMs,
      message: "Saved rule queued. Activate it at the next round boundary.",
    };
    this.changed();
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
