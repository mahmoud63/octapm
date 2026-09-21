/**
 * Runs a backend entry point with an IPC signal bridge in front of it.
 *
 *   node src/__live__/signal-bridge.js src/index.js
 *
 * Windows has no SIGTERM to send to another process, so a live test asks for
 * one over IPC and this re-emits it on `process`, reaching exactly the handler
 * ECS reaches with a real SIGTERM. Only live tests use this file.
 */
const path = require("path");

const entry = process.argv[2];
if (!entry) {
  console.error("signal-bridge: name the entry point to run");
  process.exit(2);
}

process.on("message", (message) => {
  if (message && typeof message.signal === "string") process.emit(message.signal, message.signal);
});
// The IPC channel must not keep an otherwise finished process alive.
if (process.channel && typeof process.channel.unref === "function") process.channel.unref();

// The entry sees argv as if it had been started directly.
process.argv.splice(1, 2, path.resolve(entry));
require(path.resolve(entry));
