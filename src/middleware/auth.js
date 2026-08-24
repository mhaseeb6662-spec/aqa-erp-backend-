const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { verifyAccessToken } = require('../utils/generateTokens');
const User = require('../models/User');

/**
 * protect: requires a valid access token (Authorization: Bearer <token>).
 * Attaches the authenticated user (with populated role) to req.user.
 */
const protect = catchAsync(async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    return next(new AppError('You are not logged in. Please log in to continue.', 401));
  }

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    return next(new AppError('Invalid or expired session. Please log in again.', 401));
  }

  const currentUser = await User.findById(decoded.id).populate('role');
  if (!currentUser) {
    return next(new AppError('The user belonging to this session no longer exists.', 401));
  }

  if (currentUser.status !== 'active') {
    return next(new AppError('Your account is not active. Please contact an administrator.', 403));
  }

  if (currentUser.changedPasswordAfter(decoded.iat)) {
    return next(new AppError('Password was changed recently. Please log in again.', 401));
  }

  req.user = currentUser;
  next();
});

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    const roleSlug = req.user.role.slug || req.user.role.name?.toLowerCase().replace(/\s+/g, '-');
    if (!roles.includes(roleSlug) && req.user.role.slug !== 'super-admin' && req.user.role.slug !== 'admin') {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    next();
  };
};

module.exports = { protect, restrictTo };
