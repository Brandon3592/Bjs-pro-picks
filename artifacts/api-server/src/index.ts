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

  const keyLen = process.env.ODDS_API_KEY?.length ?? 0;
  logger.info({ port, oddsKeyLength: keyLen }, "Server listening");
  initWebPush();
  startSnapshotJob();
});
