/* Smoke test: start the server on a test port and hit the health endpoint. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const port = process.env.PORT ?? "4010";
const readyTimeoutMs = 15_000;
const pollIntervalMs = 500;

const env = {
  ...process.env,
  PORT: port,
  NODE_ENV: process.env.NODE_ENV ?? "production",
};

const distEntry = resolve(__dirname, "../server/dist/server.js");
const serverArgs = existsSync(distEntry)
  ? ["server/dist/server.js"]
  : ["--import", "tsx", "server/server.ts"];

const server = spawn("node", serverArgs, {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let bufferedOutput = "";
server.stdout.on("data", (chunk: Buffer) => {
  bufferedOutput += chunk.toString();
});
server.stderr.on("data", (chunk: Buffer) => {
  bufferedOutput += chunk.toString();
});

let finished = false;

const shutdown = (): void => {
  if (!server.killed) {
    server.kill("SIGTERM");
  }
};

process.on("exit", shutdown);
process.on("SIGINT", () => {
  shutdown();
  process.exit(1);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(1);
});

const wait = (ms: number): Promise<void> =>
  new Promise((resolveWait) => setTimeout(resolveWait, ms));

async function pollHealth(): Promise<boolean> {
  const url = `http://localhost:${port}/health-check`;
  const start = Date.now();

  while (Date.now() - start < readyTimeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        const payload = (await response.json()) as {
          status?: string;
          [key: string]: unknown;
        };
        console.log(`Health check OK on port ${port}:`, payload.status ?? payload);
        return true;
      }
    } catch {
      // Ignore and retry while server boots.
    }

    await wait(pollIntervalMs);
  }

  return false;
}

server.on("exit", (code: number | null) => {
  if (finished) {
    return;
  }

  console.error("Server exited before health check completed. Output:");
  console.error(bufferedOutput.trim());
  process.exit(code ?? 1);
});

const run = async (): Promise<void> => {
  const ok = await pollHealth();
  finished = true;
  shutdown();

  if (!ok) {
    console.error(`Health check failed within ${readyTimeoutMs}ms`);
    console.error(bufferedOutput.trim());
    process.exit(1);
    return;
  }

  console.log("Server smoke test passed.");
  process.exit(0);
};

void run();
