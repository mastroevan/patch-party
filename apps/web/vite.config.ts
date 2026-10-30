import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const repository = fileURLToPath(new URL("../../", import.meta.url));
export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, repository, ""), ...process.env };
  const origin = new URL(env.PATCH_PARTY_ORIGIN || "https://127.0.0.1:5173");
  const backendPort = Number(env.PORT || 3001);
  let https;
  if (command === "serve" && origin.protocol === "https:") {
    try {
      https = {
        key: readFileSync(
          resolve(repository, ".local/https/localhost-key.pem"),
        ),
        cert: readFileSync(resolve(repository, ".local/https/localhost.pem")),
      };
    } catch {
      throw new Error(
        "Local HTTPS certificate missing. Run npm run setup:https, then npm run dev.",
      );
    }
  }
  return {
    root: fileURLToPath(new URL(".", import.meta.url)),
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: Number(origin.port || (origin.protocol === "https:" ? 443 : 80)),
      strictPort: true,
      https,
      proxy: {
        "/ws": { target: `ws://127.0.0.1:${backendPort}`, ws: true },
        "/api": `http://127.0.0.1:${backendPort}`,
      },
    },
    build: { outDir: "../../dist", emptyOutDir: true },
  };
});
