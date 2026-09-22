/**
 * An HTTP server whose routes fail in every way a real request can, using the
 * real request-id middleware, body parser, multer and error handler against
 * the real local Postgres. Every query here is a read or a write that the
 * database refuses, so nothing is stored.
 *
 *   GET  /validation  Prisma validation error (lists the User columns)
 *   GET  /p2025       findUniqueOrThrow on a missing row
 *   GET  /p2010       raw query on a relation that does not exist
 *   POST /p2002       a user whose email is already taken (body: orgId, email)
 *   GET  /type-error  a TypeError
 *   GET  /http-error  a deliberate HttpError 503 marked expose
 *   GET  /upstream-5xx an HttpError 502 wrapping upstream provider text
 *   GET  /upstream    a plain Error carrying an upstream 401
 *   POST /json        express.json (send it malformed JSON)
 *   POST /upload      multer with a 10-byte file limit
 */
const { createServer } = require("http");
const express = require("express");
const multer = require("multer");
const { prisma } = require("../../config/db");
const { requestId } = require("../../middleware/request-id");
const { errorHandler, notFoundHandler } = require("../../middleware/error-handler");
const { HttpError } = require("../../utils/http-error");

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

const app = express();
app.use(requestId);
app.use(express.json({ limit: "1kb" }));

app.get("/validation", wrap(async () => {
  await prisma.user.findMany({ where: { notAColumn: 1 } });
}));
app.get("/p2025", wrap(async () => {
  await prisma.user.findUniqueOrThrow({ where: { id: "00000000-0000-0000-0000-000000000000" } });
}));
app.get("/p2010", wrap(async () => {
  await prisma.$queryRawUnsafe("select nope from no_such_table_for_live_tests");
}));
app.post("/p2002", wrap(async (req) => {
  await prisma.user.create({
    data: { orgId: req.body.orgId, name: "Duplicate", email: req.body.email, passwordHash: "x" },
  });
}));
app.get("/type-error", wrap(async () => {
  const missing = null;
  return missing.property;
}));
app.get("/http-error", () => {
  // Written for the client, and marked so.
  throw Object.assign(
    new HttpError(503, "AI_NOT_CONFIGURED", "No AI provider is configured for this workspace"),
    { expose: true },
  );
});
app.get("/upstream-5xx", () => {
  // What ai-provider.service builds from a provider's own error text.
  throw new HttpError(
    502,
    "AI_PROVIDER_ERROR",
    "The AI provider did not answer: getaddrinfo ENOTFOUND api.anthropic.com / invalid x-api-key sk-ant-api03-LEAKEDSECRET",
  );
});
app.get("/upstream", () => {
  throw Object.assign(new Error("Anthropic answered 401: invalid x-api-key"), { status: 401 });
});
app.post("/json", (req, res) => res.json({ success: true, data: req.body }));
app.post(
  "/upload",
  multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 } }).single("file"),
  (req, res) => res.json({ success: true, data: { size: req.file?.size } }),
);

app.use(notFoundHandler);
app.use(errorHandler);

const port = Number(process.env.PORT);
createServer(app).listen(port, "127.0.0.1", () => {
  console.log(`error probe running on port ${port}`);
});
