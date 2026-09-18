const { randomUUID } = require("crypto");

const HEADER = "X-Request-Id";
const SAFE = /^[A-Za-z0-9._-]{4,80}$/;

/**
 * One id per request, on the way in and on the way out.
 *
 * A client may send its own so that its logs and ours line up (the mobile
 * app does); anything that is not a plain token is replaced rather than
 * echoed, so a header cannot be used to write into the logs. The id travels
 * back in the response header and, for failures, inside the error envelope.
 */
const requestId = (req, res, next) => {
  const offered = req.get(HEADER);
  req.id = offered && SAFE.test(offered) ? offered : randomUUID();
  res.setHeader(HEADER, req.id);
  next();
};

module.exports = { requestId, REQUEST_ID_HEADER: HEADER };
