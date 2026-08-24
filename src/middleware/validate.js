const { validationResult } = require('express-validator');
const AppError = require('../utils/appError');

/**
 * Runs after an array of express-validator checks and turns any
 * validation failures into a single, consistent 422 AppError instead
 * of letting each controller handle validation errors differently.
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formatted = errors.array().map((e) => ({ field: e.path, message: e.msg }));
    const error = new AppError('Validation failed', 422);
    error.errors = formatted;
    return next(error);
  }

  next();
};

module.exports = validate;
