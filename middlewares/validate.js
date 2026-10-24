const { validationResult } = require('express-validator');
const AppError = require('../utils/app_error');

/**
 * Middleware that inspects express-validator results.
 * If validation errors exist, short-circuits by forwarding an AppError(400) to next().
 */
const validate = (validations) => {
  return async (req, res, next) => {
    // Run all validations in parallel
    await Promise.all(validations.map((validation) => validation.run(req)));

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    const formattedErrors = errors.array().map((err) => ({
      field: err.path || err.param,
      message: err.msg,
      value: err.value,
    }));

    return next(new AppError('Validation failed', 400, formattedErrors));
  };
};

module.exports = validate;
