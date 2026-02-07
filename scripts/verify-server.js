/* Smoke test: start the server on a test port and hit the health endpoint. */
const { spawn } = require('child_process');
const { existsSync } = require('fs');
const { resolve } = require('path');

const PORT = process.env.PORT || 4010;
const READY_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 500;

const env = {
  ...process.env,
  PORT,
  NODE_ENV: process.env.NODE_ENV || 'production',
};

const distEntry = resolve(__dirname, '../server/dist/server.js');
const serverArgs = existsSync(distEntry) ? ['server/dist/server.js'] : ['--import', 'tsx', 'server/server.ts'];

const server = spawn('node', serverArgs, {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let bufferedOutput = '';
server.stdout.on('data', (chunk) => {
  bufferedOutput += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  bufferedOutput += chunk.toString();
});

let finished = false;
const shutdown = () => {
  if (server && !server.killed) {
    server.kill('SIGTERM');
  }
};
process.on('exit', shutdown);
process.on('SIGINT', () => {
  shutdown();
  process.exit(1);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(1);
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollHealth() {
  const url = `http://localhost:${PORT}/health-check`;
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        console.log(`Health check OK on port ${PORT}:`, json.status || json);
        return true;
      }
    } catch (err) {
      // ignore and retry
    }
    await wait(POLL_INTERVAL_MS);
  }
  return false;
}

server.on('exit', (code) => {
  if (finished) return;
  console.error('Server exited before health check completed. Output:');
  console.error(bufferedOutput.trim());
  process.exit(code || 1);
});

(async () => {
  const ok = await pollHealth();
  finished = true;
  shutdown();

  if (!ok) {
    console.error(`Health check failed within ${READY_TIMEOUT_MS}ms`);
    console.error(bufferedOutput.trim());
    process.exit(1);
  }

  console.log('Server smoke test passed.');
  process.exit(0);
})();
