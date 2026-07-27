import app from "./app";
import { logger } from "./lib/logger";
import { disconnectRateLimiter } from "./routes/audio";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// Server-level socket timeout: evicts connections that stop sending data for
// longer than 10 minutes. This is a backstop for all routes. Individual routes
// (e.g. the upload endpoint) set their own tighter deadlines via req.setTimeout.
server.setTimeout(600_000); // 10 minutes

// ---------------------------------------------------------------------------
// Centralised graceful-shutdown sequence.
//
// Order matters:
//   1. Stop accepting new connections (server.close).
//   2. Disconnect ancillary resources (Redis rate-limiter client).
//   3. Exit — the process will linger until all steps complete or the
//      forced-exit timeout fires.
// ---------------------------------------------------------------------------
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, "Graceful shutdown initiated");

  // Force-exit after 10 s in case something hangs.
  const forceExit = setTimeout(() => {
    logger.error("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 10_000);
  forceExit.unref(); // Don't keep the event loop alive just for this timer.

  // Step 1: stop accepting new HTTP connections.
  await new Promise<void>((resolve) => {
    server.close((err) => {
      if (err) logger.error({ err }, "Error closing HTTP server");
      resolve();
    });
  });

  // Step 2: disconnect the rate-limiter's Redis client (no-op when MemoryStore
  // is in use).
  try {
    await disconnectRateLimiter();
  } catch (err) {
    logger.error({ err }, "Error disconnecting rate-limiter Redis client");
  }

  logger.info("Graceful shutdown complete");
  process.exit(0);
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => { void shutdown(signal); });
}
