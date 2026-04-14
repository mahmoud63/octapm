const { validationResult } = require('express-validator');
const { HttpError } = require('../utils/http-error');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = errors.array().map((err) => ({
      field: err.path,
      message: err.msg,
      location: err.location,
    }));

    return next(
      new HttpError(400, 'VALIDATION_ERROR', 'Validation failed', details),
    );
  }

  return next();
};

module.exports = { validate };
