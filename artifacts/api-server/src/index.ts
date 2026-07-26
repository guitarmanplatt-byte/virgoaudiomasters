import app from "./app";
import { logger } from "./lib/logger";

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
