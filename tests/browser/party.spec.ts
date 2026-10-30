import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { artifactHash } from "../../apps/server/codex/generate.ts";
import type { PartyState } from "../../packages/contracts/index.ts";
const live = process.env.PATCH_PARTY_LIVE_CODEX === "1";
test.beforeEach(async ({ context }) => {
  const res = await context.request.post("/api/operator/session", {
    headers: {
      Origin: process.env.PATCH_PARTY_TEST_ORIGIN || "http://127.0.0.1:5173",
    },
    data: { key: "playwright-operator-test-key-12345" },
  });
  expect(res.ok()).toBeTruthy();
});
test("play, vote, reveal a sample rule, collect under flipped gravity, reset", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("Local server online")).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: false }).click();
  await page.getByLabel("Rule engine").selectOption("samples");
  await page.getByLabel("Chat command").fill("!rule gravity");
  await page.getByRole("button", { name: "Send chat message" }).click();
  await page.getByRole("button", { name: "Start round" }).click();
  await expect(page.getByText("VOTING OPEN", { exact: true })).toBeVisible();
  await page.locator(".game-host").focus();
  await page.keyboard.down("d");
  await page.waitForTimeout(350);
  await page.keyboard.up("d");
  await expect(page.getByTestId("score")).toHaveText("010");
  await page.getByLabel("Chat command").fill("!vote 1");
  await page.getByRole("button", { name: "Send chat message" }).click();
  await page.getByLabel("Viewer name").fill("lunaloop");
  await page.getByLabel("Chat command").fill("!vote 2");
  await page.getByRole("button", { name: "Send chat message" }).click();
  await page.getByLabel("Chat command").fill("!vote 1");
  await page.getByRole("button", { name: "Send chat message" }).click();
  await expect(
    page.locator(".rule-card").first().locator(".card-bottom strong"),
  ).toHaveText("2 votes");
  await page.getByRole("button", { name: "Lock vote" }).click();
  await expect(page.getByText("WINNING PATCH")).toBeVisible();
  await expect(page.locator(".active-rule h3")).toHaveText("Original recipe");
  await page.getByRole("button", { name: "End round" }).click();
  await expect(page.getByRole("heading", { name: "10 points" })).toBeVisible();
  await page.getByRole("button", { name: "Play next round" }).click();
  await expect(page.getByText("PATCH INCOMING", { exact: true })).toBeVisible();
  await expect(page.getByText("PATCH INCOMING", { exact: true })).toBeHidden({
    timeout: 7000,
  });
  await expect(page.locator(".active-rule h3")).toHaveText("Gravity glitch");
  await expect(page.getByTestId("score")).toHaveText("000");
  await page.locator(".game-host").focus();
  await page.keyboard.down("d");
  await page.waitForTimeout(350);
  await page.keyboard.up("d");
  await expect(page.getByTestId("score")).toHaveText("010");
  await expect(page.locator(".effect")).toContainText("GRAVITY FLIPPED");
  await page.getByRole("button", { name: "Pause", exact: false }).click();
  const timer = await page.getByTestId("timer").textContent();
  await page.waitForTimeout(1300);
  await expect(page.getByTestId("timer")).toHaveText(timer!);
  await page
    .getByRole("button", { name: "Resume round", exact: false })
    .click();
  await expect(page.locator(".effect")).toContainText("GRAVITY FLIPPED");
  await expect(page.locator(".effect")).toBeHidden({ timeout: 6000 });
  await page.screenshot({
    path: "test-results/playground-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Reset", exact: false }).click();
  await expect(page.getByRole("button", { name: "Start round" })).toBeVisible();
  await expect(page.locator(".active-rule h3")).toHaveText("Original recipe");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Start round" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/playground-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("a spectator takes over a paused round after controller disconnect; reload restores ballot", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByText("Local server online")).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: false }).click();
  await page.getByLabel("Rule engine").selectOption("samples");
  await page.getByRole("button", { name: "Start round" }).click();
  const spectator = await context.newPage();
  await spectator.goto("/");
  await expect(
    spectator.getByText("Spectator tab.", { exact: false }),
  ).toBeVisible();
  await expect(
    spectator.getByRole("button", { name: "End round" }),
  ).toBeDisabled();
  await spectator.getByLabel("Chat command").fill("!vote 3");
  await spectator.getByRole("button", { name: "Send chat message" }).click();
  await expect(
    page.locator(".rule-card").nth(2).locator(".card-bottom strong"),
  ).toHaveText("1 vote");
  await page.close();
  await expect(
    spectator.getByRole("button", { name: "Resume round", exact: false }),
  ).toBeEnabled();
  const time = await spectator.getByTestId("timer").textContent();
  await spectator.waitForTimeout(1100);
  await expect(spectator.getByTestId("timer")).toHaveText(time!);
  await spectator.reload();
  await expect(spectator.getByText("Local server online")).toBeVisible();
  await expect(
    spectator.locator(".rule-card").nth(2).locator(".card-bottom strong"),
  ).toHaveText("1 vote");
  await spectator
    .getByRole("button", { name: "Resume round", exact: false })
    .click();
  await expect(
    spectator.getByRole("heading", { name: "Take a breather." }),
  ).toBeHidden();
  await spectator.getByRole("button", { name: "Reset", exact: false }).click();
  await spectator.close();
});

test(`${live ? "live Codex" : "saved fallback"} rule artifact is validated and activated in the arena`, async ({
  page,
}, testInfo) => {
  test.setTimeout(live ? 180000 : 60000);
  let latest: PartyState | undefined;
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === "state") latest = message.state;
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("Local server online")).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: false }).click();

  // Select Live Codex mode
  await page.getByLabel("Rule engine").selectOption("codex");
  await expect(
    page.getByText("Lock a winning vote to start a real Codex build"),
  ).toBeVisible();

  // Nominate rule
  await page.getByLabel("Chat command").fill("!rule gravity");
  await page.getByRole("button", { name: "Send chat message" }).click();

  // Start round
  await page.getByRole("button", { name: "Start round" }).click();
  await expect(page.getByText("VOTING OPEN", { exact: true })).toBeVisible();

  // Vote
  await page.getByLabel("Chat command").fill("!vote 1");
  await page.getByRole("button", { name: "Send chat message" }).click();

  // Lock vote
  await page.getByRole("button", { name: "Lock vote" }).click();
  await expect(page.getByText("WINNING PATCH")).toBeVisible();

  if (live) {
    // A live proof must never accept library fallback or a failed generation.
    await expect(page.locator(".build-status")).toContainText(/READY|FAILED/, {
      timeout: 125000,
    });
    expect(latest?.build.status, latest?.build.message).toBe("ready");
    expect(latest?.build.artifact?.origin).toBe("live-codex");
  } else {
    await expect(page.locator(".build-status")).toContainText("FAILED", {
      timeout: 15000,
    });
    await page
      .getByRole("button", { name: "Use saved rule · library" })
      .click();
  }

  // Expect status to be READY
  await expect(page.getByText("READY", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(
    page.getByText("Inspect generated code & validation evidence"),
  ).toBeVisible();

  const accepted = latest!.build.artifact!;
  expect(accepted.hash).toBe(artifactHash(accepted, accepted.intent));
  expect(accepted.origin).toBe(live ? "live-codex" : "library");

  // Open evidence inspector
  await page.getByText("Inspect generated code & validation evidence").click();
  await expect(page.getByText("SHA-256")).toBeVisible();
  await expect(
    page.getByText("QuickJS isolation", { exact: false }),
  ).toBeVisible();

  // End round
  await page.getByRole("button", { name: "End round" }).click();
  await expect(
    page.getByRole("button", { name: "Play next round →" }),
  ).toBeEnabled();

  // Play next round with generated artifact
  await page.getByRole("button", { name: "Play next round →" }).click();
  await expect(page.getByText("PATCH INCOMING", { exact: true })).toBeVisible();
  await expect(page.getByText("PATCH INCOMING", { exact: true })).toBeHidden({
    timeout: 7000,
  });

  // Verify CODEX GENERATED badge in active rule
  await expect(page.locator(".active-rule")).toContainText(
    live ? "CODEX GENERATED" : "SAVED RULE · LIBRARY",
  );
  expect(latest!.activeArtifact!.hash).toBe(accepted.hash);
  expect(latest!.activeArtifact!.source).toBe(accepted.source);

  // Move and collect a coin
  await page.locator(".game-host").focus();
  await page.keyboard.down("d");
  await page.waitForTimeout(350);
  await page.keyboard.up("d");
  await expect(page.getByTestId("score")).toHaveText("010");
  await expect(page.locator(".effect")).toContainText("GRAVITY FLIPPED");

  await expect(page.locator(".effect")).toBeHidden({ timeout: 6000 });
  const evidence = {
    source: live ? "live-codex" : "saved-library",
    artifact: accepted,
    activeHash: latest!.activeArtifact!.hash,
    browserChecks: [
      "proposal and vote",
      "accepted hash matches source",
      "exact artifact activated",
      "coin collected",
      "gravity flipped",
      "effect expired",
      "no browser errors",
    ],
  };
  await writeFile(
    testInfo.outputPath("rule-evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  await testInfo.attach("rule-evidence", {
    path: testInfo.outputPath("rule-evidence.json"),
    contentType: "application/json",
  });
  await page.screenshot({
    path: testInfo.outputPath("rule-playthrough.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
