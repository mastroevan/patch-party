import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AcceptedRule } from "../../packages/contracts/rules.ts";
import type { SavedRuleSummary } from "../../packages/contracts/library.ts";
import { parseProposal } from "../../packages/contracts/rules.ts";
import { artifactHash } from "./codex/generate.ts";
import {
  validateSource,
  validateModule,
} from "../../packages/rule-runner/index.ts";
interface SavedRule {
  artifact: AcceptedRule;
  author: string;
  proposal: string;
  savedAt: string;
}
interface Preferences {
  version: 1;
  best: number;
  mode: "samples" | "codex";
}
export class RuleLibrary {
  private records = new Map<string, SavedRule>();
  private writes: Promise<void> = Promise.resolve();
  constructor(private directory?: string) {}
  private enqueue(action: () => Promise<void>) {
    const next = this.writes.then(action);
    this.writes = next.catch(() => {});
    return next;
  }
  private async write(file: string, value: unknown) {
    if (!this.directory) return;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, file),
      temp = `${path}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temp, path);
  }
  private check(value: any): SavedRule {
    const a = value?.artifact;
    const intent =
      typeof value?.proposal === "string"
        ? parseProposal(value.proposal)
        : null;
    if (
      !a ||
      !intent ||
      JSON.stringify(intent) !== JSON.stringify(a.intent) ||
      typeof a.name !== "string" ||
      !a.name.length ||
      a.name.length > 60 ||
      typeof a.description !== "string" ||
      a.description.length > 200 ||
      typeof value.author !== "string" ||
      !value.author.trim() ||
      value.author.length > 24 ||
      typeof value.savedAt !== "string" ||
      !Number.isFinite(Date.parse(value.savedAt)) ||
      a.hash !== artifactHash(a, intent)
    )
      throw new Error("Invalid saved rule.");
    validateSource(a.source);
    return value;
  }
  summaries(): SavedRuleSummary[] {
    return [...this.records.values()]
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      .slice(0, 20)
      .map((r) => ({
        hash: r.artifact.hash,
        name: r.artifact.name,
        description: r.artifact.description,
        author: r.author,
        savedAt: r.savedAt,
      }));
  }
  async restore(): Promise<{
    preferences: Preferences | null;
    warning: string | null;
  }> {
    if (!this.directory) return { preferences: null, warning: null };
    let warning: string | null = null,
      preferences: Preferences | null = null;
    try {
      const data = JSON.parse(
        await readFile(join(this.directory, "lobby.json"), "utf8"),
      );
      if (
        data.version !== 1 ||
        !Number.isSafeInteger(data.best) ||
        data.best < 0 ||
        !["samples", "codex"].includes(data.mode)
      )
        throw new Error();
      preferences = data;
    } catch (error: any) {
      if (error.code !== "ENOENT")
        warning =
          "Lobby preferences could not be restored. Started a clean lobby.";
    }
    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch (error: any) {
      if (error.code !== "ENOENT")
        warning =
          "Saved rules could not be read. You can still play original rules.";
      return { preferences, warning };
    }
    for (const file of files.filter((f) =>
      /^rule-[a-f0-9]{64}\.json$/.test(f),
    )) {
      try {
        const record = this.check(
          JSON.parse(await readFile(join(this.directory, file), "utf8")),
        );
        if (file !== `rule-${record.artifact.hash}.json`) throw new Error();
        this.records.set(record.artifact.hash, record);
      } catch {
        warning =
          "Some saved rules failed integrity checks and were left out of the library.";
      }
    }
    return { preferences, warning };
  }
  async importArtifacts(directory: string) {
    const files = (await readdir(directory).catch(() => []))
      .filter((f) => /^[a-f0-9]{64}\.json$/.test(f))
      .slice(-20);
    for (const file of files) {
      try {
        const raw = await readFile(join(directory, file), "utf8");
        if (raw.length > 100000) continue;
        const { artifact: a } = JSON.parse(raw);
        if (!a?.intent || this.records.has(a.hash)) continue;
        const i = a.intent;
        const proposal =
          i.slot === "moon"
            ? "moon"
            : `every ${i.every === 1 ? "coin" : i.every === 2 ? "second coin" : "third coin"} ${i.kind === "gravity" ? "flips gravity" : "boosts speed"} for ${i.durationMs / 1000} seconds`;
        this.check({
          artifact: a,
          author: "community",
          proposal,
          savedAt: a.createdAt,
        });
        if (file !== `${a.hash}.json`) continue;
        await validateModule(a, a.intent);
        await this.save(a, "community", proposal);
      } catch {
        /* Existing artifacts are left untouched; invalid ones never enter the library. */
      }
    }
  }
  async save(artifact: AcceptedRule, author: string, proposal: string) {
    const record = this.check({
      artifact,
      author,
      proposal,
      savedAt: new Date().toISOString(),
    });
    await this.enqueue(async () => {
      await this.write(`rule-${artifact.hash}.json`, record);
      this.records.set(artifact.hash, record);
    });
  }
  async load(hash: string) {
    const record = this.records.get(hash);
    if (!record)
      throw new Error("That saved rule is unavailable. Choose another rule.");
    this.check(record);
    const checks = await validateModule(
      record.artifact,
      record.artifact.intent,
    );
    return {
      ...record,
      artifact: { ...record.artifact, origin: "library" as const, checks },
    };
  }
  savePreferences(best: number, mode: Preferences["mode"]) {
    return this.enqueue(() =>
      this.write("lobby.json", { version: 1, best, mode }),
    );
  }
  async flush() {
    await this.writes;
  }
}
