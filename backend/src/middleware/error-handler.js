const { sendError } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");

const notFoundHandler = (req, _res, next) => {
  next(
    new HttpError(
      404,
      "NOT_FOUND",
      `Route not found: ${req.method} ${req.originalUrl}`,
    ),
  );
};

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (process.env.NODE_ENV !== "test") {
    // Suppress logging for expected client errors (like 401 Unauthorized or 404 Not Found)
    if (!err.status || err.status >= 500) {
      console.error(req.id ? `[${req.id}]` : "", err.stack || err);
    }
  }

  return sendError(res, err, undefined, undefined, undefined, {
    includeDetails: process.env.NODE_ENV !== "production",
    requestId: req.id,
  });
};

module.exports = {
  errorHandler,
  notFoundHandler,
};
