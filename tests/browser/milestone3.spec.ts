import { test, expect } from "@playwright/test";
const key = "playwright-operator-test-key-12345";

test("operator login gates the arena; an unauthenticated OBS page never claims control or starts a simulation", async ({
  page,
  context,
}) => {
  await page.goto("/overlay");
  await expect(
    page.getByText("Overlay connected", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.getByRole("button")).toHaveCount(0);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const operator = await context.newPage();
  await operator.goto("/");
  await expect(
    operator.getByRole("heading", { name: "Open your control room." }),
  ).toBeVisible();
  await expect(operator.locator("canvas")).toHaveCount(0);
  await operator.getByLabel("Operator key").fill(key);
  await operator.getByRole("button", { name: "Unlock controls" }).click();
  await expect(
    operator.getByRole("button", { name: "Start round" }),
  ).toBeEnabled();
  await operator.getByRole("button", { name: "Reset", exact: false }).click();
  await operator.getByLabel("Chat command").fill("!rule gravity");
  await operator.getByRole("button", { name: "Send chat message" }).click();
  await operator.getByRole("button", { name: "Start round" }).click();
  await expect(
    page.getByRole("heading", { name: "VOTE NOW · !vote 1–3" }),
  ).toBeVisible();
  await operator.getByLabel("Chat command").fill("!vote 1");
  await operator.getByRole("button", { name: "Send chat message" }).click();
  await expect(page.locator(".overlay-cards article").first()).toContainText(
    "1 vote",
  );
  await expect(page.locator("canvas")).toHaveCount(0);
  const cookie = (await context.cookies()).find(
    (c) => c.name === "pp_operator",
  )!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Strict");
  expect(cookie.secure).toBe(new URL(page.url()).protocol === "https:");
  await page.screenshot({
    path: "test-results/obs-overlay.png",
    fullPage: true,
  });
  await operator.close();
  await expect(page.locator(".overlay-clock")).toHaveText("PAUSED");
  expect(errors).toEqual([]);
});

test("operator startup link removes its key from the address bar and shows Twitch setup status", async ({
  page,
}) => {
  await page.goto(`/#operator=${key}`);
  await expect(page.getByText("Local server online")).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await expect(
    page.getByRole("region", { name: "Twitch connection" }),
  ).toContainText("DISABLED");
  await expect(
    page.getByRole("link", { name: "Open OBS overlay" }),
  ).toBeVisible();
});
