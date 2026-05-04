import app from "./app";
import { logger } from "./lib/logger";
import { startSnapshotJob } from "./lib/snapshot-job";
import { initWebPush } from "./lib/push-notifications";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  const rawKey = process.env.ODDS_API_KEY ?? "";
  logger.info({ port, oddsKeyLength: rawKey.length, oddsKeyPrefix: rawKey.slice(0, 6) }, "Server listening");
  initWebPush();
  startSnapshotJob();
});
