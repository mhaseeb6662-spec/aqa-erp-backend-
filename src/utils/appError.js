/**
 * Standardized operational error. Thrown intentionally (bad input,
 * unauthorized, not found, etc.) so the global error handler can
 * tell it apart from unexpected programming/runtime errors.
 */
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
