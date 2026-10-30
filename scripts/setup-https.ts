import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
const directory = resolve(".local/https");
const key = resolve(directory, "localhost-key.pem"),
  cert = resolve(directory, "localhost.pem");
mkdirSync(directory, { recursive: true, mode: 0o700 });
if (!existsSync(key) || !existsSync(cert)) {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-days",
      "30",
      "-subj",
      "/CN=Patch Party local development",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: "pipe" },
  );
}
chmodSync(key, 0o600);
console.log(
  "Local HTTPS certificate ready in .local/https (private key is ignored by Git). No system trust settings were changed.",
);
console.log(
  "Use https://127.0.0.1:5173. Your browser may require a one-time exception for this local development certificate.",
);
