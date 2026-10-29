import { test, expect } from "@playwright/test";
test("play, vote, reveal a sample rule, collect under flipped gravity, reset", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("Local server online")).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: false }).click();
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
  ).toHaveText("1 votes");
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
  ).toHaveText("1 votes");
  await spectator
    .getByRole("button", { name: "Resume round", exact: false })
    .click();
  await expect(
    spectator.getByRole("heading", { name: "Take a breather." }),
  ).toBeHidden();
  await spectator.getByRole("button", { name: "Reset", exact: false }).click();
  await spectator.close();
});

test("select codex mode, vote, ready generated rule, inspect evidence, and activate in next round", async ({
  page,
}) => {
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

  // Wait for build status to settle to READY or FAILED (e.g. if out of credits)
  await expect(page.locator(".build-status")).toContainText(/READY|FAILED/, {
    timeout: 15000,
  });
  const useSavedBtn = page.getByRole("button", {
    name: "Use saved rule · library",
  });
  if (await useSavedBtn.isVisible()) {
    await useSavedBtn.click();
  }

  // Expect status to be READY
  await expect(page.getByText("READY", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(
    page.getByText("Inspect generated code & validation evidence"),
  ).toBeVisible();

  // Open evidence inspector
  await page.getByText("Inspect generated code & validation evidence").click();
  await expect(page.getByText("SHA-256")).toBeVisible();
  await expect(page.getByText("QuickJS isolation")).toBeVisible();

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
  await expect(page.locator(".active-rule")).toContainText("CODEX GENERATED");

  // Move and collect a coin
  await page.locator(".game-host").focus();
  await page.keyboard.down("d");
  await page.waitForTimeout(350);
  await page.keyboard.up("d");
  await expect(page.getByTestId("score")).toHaveText("010");
  await expect(page.locator(".effect")).toContainText("GRAVITY FLIPPED");

  expect(errors).toEqual([]);
});
