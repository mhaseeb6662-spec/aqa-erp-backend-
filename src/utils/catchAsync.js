/**
 * Wraps an async Express route/controller so any rejected promise is
 * forwarded to next(), letting the global error handler deal with it.
 */
const catchAsync = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = catchAsync;
