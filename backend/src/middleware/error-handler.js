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

const errorHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (process.env.NODE_ENV !== "test") {
    console.error(err.stack || err);
  }

  return sendError(res, err, undefined, undefined, undefined, {
    includeDetails: process.env.NODE_ENV !== "production",
  });
};

module.exports = {
  errorHandler,
  notFoundHandler,
};
