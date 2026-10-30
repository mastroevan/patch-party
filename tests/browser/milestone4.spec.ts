import { test, expect } from "@playwright/test";
const key = "playwright-operator-test-key-12345";

test("a failed build recovers through preview, credited activation, revert and saved-library reuse while OBS stays connected", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/#operator=${key}`);
  await expect(page.getByText("Local server online")).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: false }).click();
  await page.getByLabel("Rule engine").selectOption("codex");
  await expect(
    page.getByRole("button", { name: "Sound cues off" }),
  ).toBeVisible();
  const overlay = await context.newPage();
  await overlay.goto("/overlay");
  await expect(
    overlay.getByText("Overlay connected", { exact: true }),
  ).toBeVisible();
  await expect(overlay.locator(".overlay-instructions")).toContainText(
    "Before the round",
  );
  await page.getByLabel("Viewer name").fill("milestone4viewer");
  await page.getByLabel("Chat command").fill("!rule gravity");
  await page.getByRole("button", { name: "Send chat message" }).click();
  await page.getByRole("button", { name: "Start round" }).click();
  await page.getByLabel("Chat command").fill("!vote 1");
  await page.getByRole("button", { name: "Send chat message" }).click();
  await page.getByRole("button", { name: "Lock vote" }).click();
  await expect(page.locator(".build-status")).toContainText("FAILED", {
    timeout: 15000,
  });
  await expect(page.getByRole("button", { name: "End round" })).toBeEnabled();
  await expect(overlay.locator(".overlay-next")).toContainText(
    "Streamer recovery in progress",
  );
  await page.getByRole("button", { name: "Use saved rule · library" }).click();
  await expect(page.locator(".build-status")).toContainText("READY");
  await page.getByRole("button", { name: "Preview next rule" }).click();
  const preview = page.getByRole("region", { name: "Isolated rule preview" });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "Coin 1", exact: true }).click();
  await expect(preview.getByRole("status")).toHaveText("GRAVITY FLIPPED");
  await expect(page.locator(".active-rule h3")).toHaveText("Original recipe");
  await expect(page.getByTestId("score")).toHaveText("000");
  await page.screenshot({
    path: "test-results/milestone4-preview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close preview" }).click();
  await page.getByRole("button", { name: "End round" }).click();
  await page.getByRole("button", { name: "Play next round" }).click();
  await expect(page.locator(".reveal-credit")).toContainText(
    "milestone4viewer",
  );
  await expect(page.getByText("PATCH INCOMING", { exact: true })).toBeHidden({
    timeout: 7000,
  });
  await page.locator(".game-host").focus();
  await page.keyboard.down("d");
  await page.waitForTimeout(350);
  await page.keyboard.up("d");
  await expect(page.getByTestId("score")).toHaveText("010");
  await expect(page.locator(".effect")).toContainText("GRAVITY FLIPPED");
  await page.getByRole("button", { name: "Revert to original" }).click();
  await expect(page.locator(".effect")).toBeHidden();
  await expect(page.locator(".active-rule h3")).toHaveText("Original recipe");
  await expect(page.getByTestId("score")).toHaveText("010");
  await expect(overlay.locator(".overlay-active h1")).toHaveText(
    "Original recipe",
  );
  await expect(
    overlay.getByText("Overlay connected", { exact: true }),
  ).toBeVisible();
  await expect(overlay.locator("canvas")).toHaveCount(0);
  await page.getByRole("button", { name: "Reset", exact: false }).click();
  const library = page.getByRole("region", { name: "Saved rule library" });
  const saved = library
    .locator(".library-card")
    .filter({ hasText: "milestone4viewer" });
  await expect(saved).toBeVisible();
  await saved.getByRole("button", { name: "Queue saved rule" }).click();
  await expect(page.locator(".queued-rule")).toContainText("Saved rule queued");
  await expect(
    page.getByRole("button", { name: "Cancel queued rule" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel queued rule" }).click();
  await expect(page.locator(".queued-rule")).toBeHidden();
  await saved.getByRole("button", { name: "Queue saved rule" }).click();
  await expect(page.locator(".queued-rule")).toBeVisible();
  await page.getByRole("button", { name: "Start round" }).click();
  await expect(page.getByText("PATCH INCOMING", { exact: true })).toBeVisible();
  await expect(page.getByText("PATCH INCOMING", { exact: true })).toBeHidden({
    timeout: 7000,
  });
  await expect(page.locator(".active-rule")).toContainText(
    "SAVED RULE · LIBRARY",
  );
  await expect(page.locator(".active-rule .author")).toHaveText(
    "milestone4viewer",
  );
  await page.getByRole("button", { name: "Reset", exact: false }).click();
  expect(errors).toEqual([]);
});
