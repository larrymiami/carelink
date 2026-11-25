import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { Store } from "../apps/api/src/store.js";
import { createApp } from "../apps/api/src/app.js";
import { tick, sampleTransport } from "../apps/api/src/worker.js";
const secret = () => randomBytes(32).toString("hex");
const port = await new Promise<number>((resolve) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = (s.address() as any).port;
    s.close(() => resolve(p));
  });
});
const password = secret();
const dir = await mkdtemp(tmpdir() + "/carelink-browser-pg-");
const db = new EmbeddedPostgres({
  databaseDir: dir,
  port,
  user: "carelink",
  password,
  persistent: false,
  autoRehydrateSymlinks: true,
  initdbFlags: ["--no-sync"],
  postgresFlags: [
    "-c",
    "unix_socket_directories=",
    "-c",
    "listen_addresses=127.0.0.1",
  ],
  onLog: () => {},
  onError: () => {},
});
await db.initialise();
await db.start();
const pool = new Pool({
  host: "127.0.0.1",
  port,
  user: "carelink",
  password,
  database: "postgres",
  max: 12,
});
pool.on("error", () => {});
const begin = Date.now();
const store = new Store(
  pool,
  secret(),
  () => new Date(Date.parse("2026-11-25T06:00:00Z") + Date.now() - begin),
);
await store.migrate();
const sampleToken = secret(),
  one = secret(),
  two = secret(),
  loginPassword = secret();
const app = createApp(store, {
  sampleToken,
  operators: { "officer-one": one, "officer-two": two },
});
await app.listen({ host: "127.0.0.1", port: 3001 });
await mkdir(".tmp", { recursive: true });
await writeFile(
  ".tmp/browser-credentials.json",
  JSON.stringify({ password: loginPassword }),
  { mode: 0o600 },
);
let running = false;
const interval = setInterval(async () => {
  if (running) return;
  running = true;
  try {
    await tick(store, sampleTransport);
  } catch {
    console.error("Sample worker cycle failed");
  } finally {
    running = false;
  }
}, 100);
const web = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "apps/web",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3000",
  ],
  {
    env: {
      ...process.env,
      APP_MODE: "sample",
      API_BASE_URL: "http://127.0.0.1:3001",
      WEB_ORIGIN: "http://127.0.0.1:3000",
      SAMPLE_API_TOKEN: sampleToken,
      OPERATOR_API_TOKEN: one,
      OPERATOR_2_API_TOKEN: two,
      SESSION_SECRET: secret(),
      DEMO_LOGIN_PASSWORD: loginPassword,
      COOKIE_SECURE: "false",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "inherit", "inherit"],
  },
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearInterval(interval);
  web.kill("SIGTERM");
  await app.close();
  await pool.end();
  await db.stop();
  process.exit(0);
}
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
web.once("exit", () => {
  if (!closing) void close();
});
