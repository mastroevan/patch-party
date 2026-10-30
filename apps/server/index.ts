import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { createPartyServer, twitchConfig } from "./server.ts";
try {
  loadEnvFile();
} catch (error: any) {
  if (error.code !== "ENOENT") throw error;
}
const app = createPartyServer({
  legacyRulesDirectory: resolve("artifacts/rules"),
  storageDirectory: resolve(process.env.PATCH_PARTY_DATA_DIR || ".local"),
  operatorKey: process.env.PATCH_PARTY_OPERATOR_KEY,
  origin: process.env.PATCH_PARTY_ORIGIN || "https://127.0.0.1:5173",
  twitch: twitchConfig(process.env),
});
await app.listen(Number(process.env.PORT ?? 3001));
console.log(
  `Patch Party operator: ${process.env.PATCH_PARTY_ORIGIN || "https://127.0.0.1:5173"}/#operator=${app.sessions.key}`,
);
console.log(
  "OBS overlay: /overlay (read-only; use Window Capture for the game).",
);
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    if (!stopping) {
      stopping = true;
      void app.close();
    }
  });
