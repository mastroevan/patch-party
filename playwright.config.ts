import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
const origin = process.env.PATCH_PARTY_TEST_ORIGIN || "http://127.0.0.1:5173";
const live = process.env.PATCH_PARTY_LIVE_CODEX === "1";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: origin,
    ignoreHTTPSErrors: origin.startsWith("https:"),
    viewport: { width: 1440, height: 1100 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `${process.execPath} scripts/dev.ts`,
    url: origin,
    ignoreHTTPSErrors: origin.startsWith("https:"),
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PATH: process.env.PATH || "",
      PATCH_PARTY_ORIGIN: origin,
      PATCH_PARTY_DATA_DIR: fileURLToPath(
        new URL(`./.local/playwright-${process.pid}`, import.meta.url),
      ),
      PORT: process.env.PATCH_PARTY_TEST_BACKEND_PORT || "3001",
      PATCH_PARTY_OPERATOR_KEY: "playwright-operator-test-key-12345",
      TWITCH_CLIENT_ID: "",
      TWITCH_CLIENT_SECRET: "",
      ...(live
        ? {}
        : {
            PATCH_PARTY_CODEX_PATH: fileURLToPath(
              new URL(
                "./tests/fixtures/codex-unavailable.mjs",
                import.meta.url,
              ),
            ),
          }),
    },
  },
});
