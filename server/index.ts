import { config } from "dotenv";

import { createApp } from "./app.js";
import { UsageLedger } from "./usage.js";

config({ path: ".env.local", override: false, quiet: true });
config({ path: ".env", override: false, quiet: true });

function resolvePort(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535
    ? parsed
    : 8_787;
}

const port = resolvePort(process.env.PORT);
const host = "127.0.0.1";
const ledger = new UsageLedger();
let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
let stopping = false;

async function start(): Promise<void> {
  await ledger.acquireProcessLock();
  await ledger.snapshot();
  const app = createApp({ ledger });
  server = app.listen(port, host, () => {
    console.log(`Jev Lens API listening on http://${host}:${port}`);
  });
  server.once("error", () => {
    console.error("Failed to start the API server.");
    process.exitCode = 1;
    void ledger.releaseProcessLock().catch(() => {
      console.error("Failed to release the usage ledger lock.");
    });
  });
}

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  try {
    if (server) {
      await new Promise<void>((resolveClose, rejectClose) => {
        server?.close((error) => {
          if (error) rejectClose(error);
          else resolveClose();
        });
      });
    }
    await ledger.releaseProcessLock();
  } catch {
    console.error("Failed to stop the API server cleanly.");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

void start().catch(async () => {
  console.error("Failed to acquire the usage ledger or start the API server.");
  await ledger.releaseProcessLock().catch(() => undefined);
  process.exitCode = 1;
});

export { resolvePort };
