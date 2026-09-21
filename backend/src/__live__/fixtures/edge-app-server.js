/**
 * The real Express app alone, on PORT, for the edge live tests.
 *
 * It is createApp() and nothing else: no schedulers, no job worker, no
 * socket.io, so a test can run it under NODE_ENV=production without the
 * process writing anything to the shared database. With LIVE_VALIDATE_ENV=1
 * it first runs the same production boot check the API and the worker run,
 * and exits non-zero when that check fails.
 *
 * SIGTERM (delivered through signal-bridge.js) sets app.locals.draining, the
 * flag the API's shutdown sets first, and keeps serving so a test can watch
 * readiness turn to 503.
 */
const { createServer } = require("http");

if (process.env.LIVE_VALIDATE_ENV === "1") {
  require("../../config/security").validateProductionEnv();
}

const { createApp } = require("../../app");

const app = createApp();
const server = createServer(app);
const port = Number(process.env.PORT);

server.listen(port, "127.0.0.1", () => {
  console.log(`edge app running on port ${port}`);
});

process.on("SIGTERM", () => {
  app.locals.draining = true;
  console.log("edge app draining");
});
