import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultIntent } from "../packages/contracts/rules.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { artifactHash, loadSavedRule } from "../apps/server/codex/generate.ts";
import { validateModule } from "../packages/rule-runner/index.ts";

for (const slot of ["gravity", "moon", "sprint"]) {
  test(`bundled ${slot} baseline has an honest origin, valid hash and trusted behavior`, async () => {
    const { artifact } = JSON.parse(
      await readFile(
        new URL(`../artifacts/baselines/${slot}.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.equal(artifact.origin, "library");
    assert.equal(artifact.generationMs, 0);
    assert.match(artifact.threadId, /no Codex thread/);
    assert.equal(artifact.hash, artifactHash(artifact, artifact.intent));
    await validateModule(artifact, artifact.intent);
  });
}

test("live proof fails when Codex is unavailable even though bundled rules exist", async () => {
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "scripts/prove-codex.ts"],
      {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: {
          ...process.env,
          PATCH_PARTY_CODEX_PATH: fileURLToPath(
            new URL("./fixtures/codex-unavailable.mjs", import.meta.url),
          ),
        },
        timeout: 10000,
      },
    ),
    (error: any) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /deliberately unavailable/);
      assert.doesNotMatch(
        error.stdout,
        /saved-artifact-verified|generation succeeded/,
      );
      return true;
    },
  );
});

test("a damaged generated cache cannot hide the bundled fallback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patch-party-damaged-cache-"));
  const previous = process.cwd();
  try {
    await mkdir(join(dir, "artifacts/rules"), { recursive: true });
    await writeFile(join(dir, "artifacts/rules/broken.json"), "{invalid");
    process.chdir(dir);
    const saved = await loadSavedRule(defaultIntent("gravity"));
    assert.ok(saved);
    assert.equal(saved.origin, "library");
    assert.match(saved.checks[2], /trusted behavioral scenarios passed/);
  } finally {
    process.chdir(previous);
    await rm(dir, { recursive: true, force: true });
  }
});
