const { normalizeMoneyTree } = require("./money");
const {
  catalogEntryFor,
  normalizeErrorCode,
  normalizeStatus,
} = require("./error-codes");

const sendSuccess = (res, data, status = 200) => {
  return res
    .status(status)
    .json({ success: true, data: normalizeMoneyTree(data) });
};

const buildErrorEnvelope = ({
  status,
  code,
  message,
  details,
  requestId,
  includeDetails = true,
} = {}) => {
  const normalizedStatus = normalizeStatus(status);
  const normalizedCode = normalizeErrorCode(code, normalizedStatus);
  const catalogEntry = catalogEntryFor(normalizedCode);
  const defaultEntry = catalogEntryFor(
    normalizeErrorCode(null, normalizedStatus),
  );
  const error = {
    code: normalizedCode,
    message:
      message ||
      catalogEntry?.message ||
      defaultEntry?.message ||
      "Something went wrong",
  };

  if (includeDetails && details !== undefined) {
    error.details = normalizeMoneyTree(details);
  }

  // The reference a person can read out to support.
  if (requestId) {
    error.requestId = String(requestId);
  }

  return {
    status: normalizedStatus,
    body: { success: false, error },
  };
};

const sendError = (
  res,
  statusOrError,
  code,
  message,
  details,
  options = {},
) => {
  const input =
    statusOrError && typeof statusOrError === "object"
      ? {
          status: statusOrError.status,
          code: statusOrError.code,
          message: statusOrError.message,
          details: statusOrError.details,
          ...options,
        }
      : {
          status: statusOrError,
          code,
          message,
          details,
          ...options,
        };
  const envelope = buildErrorEnvelope(input);
  return res.status(envelope.status).json(envelope.body);
};

module.exports = {
  buildErrorEnvelope,
  sendSuccess,
  sendError,
};
