const { validationResult } = require('express-validator');
const { HttpError } = require('../utils/http-error');

// express-validator's message for a check without .withMessage().
const DEFAULT_VALIDATOR_MESSAGE = 'Invalid value';

const toDetails = (errors) =>
  errors.array().map((err) => ({
    field: err.path,
    message: err.msg,
    location: err.location,
  }));

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = toDetails(errors);

    return next(
      new HttpError(400, 'VALIDATION_ERROR', 'Validation failed', details),
    );
  }

  return next();
};

/**
 * As validate, but the refusal's own message is the first failing check's
 * .withMessage() text — the business reason, which production still sends
 * when it drops the details (an API client such as mobile sees "A rejection
 * reason is required." rather than a bare "Validation failed"). A failure
 * with no message of its own falls back to "Validation failed".
 */
const validateWithReasons = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = toDetails(errors);
    const reason = details.find(
      (detail) =>
        typeof detail.message === 'string' &&
        detail.message.trim() &&
        detail.message !== DEFAULT_VALIDATOR_MESSAGE,
    );

    return next(
      new HttpError(
        400,
        'VALIDATION_ERROR',
        reason ? reason.message : 'Validation failed',
        details,
      ),
    );
  }

  return next();
};

module.exports = { validate, validateWithReasons };
