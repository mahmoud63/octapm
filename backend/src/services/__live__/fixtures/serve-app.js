// A bare createApp() server for live tests that need NODE_ENV=production
// behaviour from the app itself without index.js's full production boot check.
const { createServer } = require("http");
const { createApp } = require("../../../app");

const port = Number(process.env.PORT);
const server = createServer(createApp());
server.listen(port, "127.0.0.1", () => {
  console.log(`serve-app running on port ${port}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
