const crypto = require('crypto');
const User = require('../models/User');
const Role = require('../models/Role');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const sendResponse = require('../utils/apiResponse');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  setRefreshTokenCookie,
} = require('../utils/generateTokens');

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MINUTES = 15;

/**
 * POST /api/v1/auth/register
 * Self-service registration always assigns the lowest-privilege
 * default role ("student"). Staff accounts must be created by an
 * Admin through the Users module, never through open registration.
 */
exports.register = catchAsync(async (req, res, next) => {
  const { fullName, email, password, phone, roleSlug } = req.body;

  const existing = await User.findOne({ email: String(email || '').trim().toLowerCase() });
  if (existing) {
    return next(new AppError('An account with this email already exists.', 409));
  }

  const requestedRole = ['student', 'parent'].includes(roleSlug) ? roleSlug : 'student';
  const roleObj = await Role.findOne({ slug: requestedRole });
  if (!roleObj) {
    return next(new AppError('Default system role is not configured. Please contact support.', 500));
  }

  const user = await User.create({
    fullName,
    email: String(email || '').trim().toLowerCase(),
    password,
    phone,
    role: roleObj._id,
  });

  // Auto-initialize profile based on role
  if (requestedRole === 'student') {
    const StudentProfile = require('../models/StudentProfile');
    const studentCode = 'STU-' + Math.floor(100000 + Math.random() * 900000);
    await StudentProfile.create({ user: user._id, studentCode });
  } else if (requestedRole === 'parent') {
    const ParentProfile = require('../models/ParentProfile');
    await ParentProfile.create({ user: user._id, children: [] });
  }

  const accessToken = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);
  setRefreshTokenCookie(res, refreshToken);

  await user.populate('role');
  return sendResponse(res, 201, 'Account created successfully.', {
    user: user.toSafeObject(),
    accessToken,
  });
});

/**
 * POST /api/v1/auth/login
 * Includes brute-force protection via progressive account locking.
 */
exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  let cleanEmail = String(email || '').trim().toLowerCase();

  // If user types without dot 'digitalarabdev@gmail.com', map to 'digitalarab.dev@gmail.com'
  if (cleanEmail === 'digitalarabdev@gmail.com') {
    cleanEmail = 'digitalarab.dev@gmail.com';
  }

  const user = await User.findOne({ email: cleanEmail }).select('+password +loginAttempts +lockUntil').populate('role');

  if (!user) {
    console.log(`[LOGIN FAILED] User not found for email: '${cleanEmail}'`);
    return next(new AppError('Invalid email or password.', 401));
  }

  if (user.isLocked) {
    console.log(`[LOGIN FAILED] User account is locked: '${cleanEmail}'`);
    return next(
      new AppError('This account is temporarily locked due to multiple failed attempts. Try again later.', 423)
    );
  }

  const isMatch = await user.comparePassword(password);
  console.log(`[LOGIN CHECK] Email: '${cleanEmail}', Password Length: ${password?.length}, isMatch: ${isMatch}`);

  if (!isMatch) {
    user.loginAttempts = (user.loginAttempts || 0) + 1;
    if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      user.lockUntil = Date.now() + LOCK_TIME_MINUTES * 60 * 1000;
    }
    await user.save({ validateBeforeSave: false });
    return next(new AppError('Invalid email or password.', 401));
  }

  if (user.status !== 'active') {
    return next(new AppError('Your account is not active. Please contact an administrator.', 403));
  }

  user.loginAttempts = 0;
  user.lockUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  const accessToken = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);
  setRefreshTokenCookie(res, refreshToken);

  return sendResponse(res, 200, 'Logged in successfully.', {
    user: user.toSafeObject(),
    accessToken,
  });
});

/**
 * POST /api/v1/auth/refresh
 * Issues a new access token using the httpOnly refresh cookie.
 */
exports.refresh = catchAsync(async (req, res, next) => {
  const token = req.cookies?.refreshToken;
  if (!token) {
    return next(new AppError('No refresh session found. Please log in again.', 401));
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch (err) {
    return next(new AppError('Refresh session is invalid or expired. Please log in again.', 401));
  }

  const user = await User.findById(decoded.id).populate('role');
  if (!user || user.status !== 'active') {
    return next(new AppError('Session is no longer valid. Please log in again.', 401));
  }

  const accessToken = generateAccessToken(user._id);
  return sendResponse(res, 200, 'Token refreshed.', { accessToken, user: user.toSafeObject() });
});

/**
 * POST /api/v1/auth/logout
 */
exports.logout = catchAsync(async (req, res) => {
  res.clearCookie('refreshToken', { path: '/api/v1/auth' });
  return sendResponse(res, 200, 'Logged out successfully.');
});

/**
 * GET /api/v1/auth/me
 */
exports.getMe = catchAsync(async (req, res) => {
  return sendResponse(res, 200, 'Current user fetched.', { user: req.user.toSafeObject() });
});

/**
 * PATCH /api/v1/auth/update-password
 */
exports.updatePassword = catchAsync(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    return next(new AppError('Current password is incorrect.', 401));
  }

  user.password = newPassword;
  await user.save();

  const accessToken = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);
  setRefreshTokenCookie(res, refreshToken);

  return sendResponse(res, 200, 'Password updated successfully.', { accessToken });
});

/**
 * POST /api/v1/auth/forgot-password
 * Always responds with a generic success message to avoid leaking
 * which emails exist in the system.
 */
exports.forgotPassword = catchAsync(async (req, res) => {
  const user = await User.findOne({ email: req.body.email });

  if (user) {
    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });
    // Phase 9 (Notifications) will wire this into real email delivery.
    console.log(`[DEV ONLY] Password reset token for ${user.email}: ${resetToken}`);
  }

  return sendResponse(
    res,
    200,
    'If an account with that email exists, a password reset link has been sent.'
  );
});

/**
 * PATCH /api/v1/auth/reset-password/:token
 */
exports.resetPassword = catchAsync(async (req, res, next) => {
  const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    return next(new AppError('Reset link is invalid or has expired.', 400));
  }

  user.password = req.body.password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  return sendResponse(res, 200, 'Password has been reset successfully. Please log in.');
});
