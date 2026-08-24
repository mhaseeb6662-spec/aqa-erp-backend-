const config = require('../config/config');

/**
 * Converts known Mongoose/JWT errors into operational AppError-shaped
 * responses, then formats every error (operational or not) into a
 * single consistent JSON error envelope.
 */

const handleCastErrorDB = (err) => ({
  statusCode: 400,
  message: `Invalid value for field "${err.path}": ${err.value}`,
});

const handleDuplicateFieldsDB = (err) => {
  const field = Object.keys(err.keyValue || {})[0];
  const value = err.keyValue ? err.keyValue[field] : '';
  return {
    statusCode: 409,
    message: `The value "${value}" for "${field}" is already in use.`,
  };
};

const handleValidationErrorDB = (err) => ({
  statusCode: 422,
  message: Object.values(err.errors)
    .map((el) => el.message)
    .join('. '),
});

const handleJWTError = () => ({ statusCode: 401, message: 'Invalid session token. Please log in again.' });
const handleJWTExpired = () => ({ statusCode: 401, message: 'Session expired. Please log in again.' });

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Something went wrong on the server.';
  let errors = err.errors || undefined;

  let mapped;
  if (err.name === 'CastError') mapped = handleCastErrorDB(err);
  if (err.code === 11000) mapped = handleDuplicateFieldsDB(err);
  if (err.name === 'ValidationError') mapped = handleValidationErrorDB(err);
  if (err.name === 'JsonWebTokenError') mapped = handleJWTError();
  if (err.name === 'TokenExpiredError') mapped = handleJWTExpired();

  if (mapped) {
    statusCode = mapped.statusCode;
    message = mapped.message;
  }

  if (config.env === 'development' && !mapped && statusCode === 500) {
    console.error('[ERROR]', err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(errors ? { errors } : {}),
    ...(config.env === 'development' ? { stack: err.stack } : {}),
  });
};

module.exports = errorHandler;
