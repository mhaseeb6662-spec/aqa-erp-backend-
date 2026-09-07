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

  const requestedRole = ['student', 'parent'].includes(roleSlug) ? roleSlug : 'student';
  const roleObj = await Role.findOne({ slug: requestedRole });
  if (!roleObj) {
    return next(new AppError('Default system role is not configured. Please contact support.', 500));
  }

  const isStudent = requestedRole === 'student';
  const sEmail = (email || '').trim().toLowerCase() || undefined;

  // Non-student accounts (parent, staff) must have an email
  if (!isStudent && !sEmail) {
    return next(new AppError('Email is required for parent accounts.', 400));
  }

  if (sEmail) {
    if (!isStudent) {
      const existing = await User.findOne({ email: sEmail, isStudent: false });
      if (existing) {
        return next(new AppError('An account with this email already exists.', 409));
      }
    } else {
      // Students can share a family email with other students or parents, but not administrative staff
      const existingStaff = await User.findOne({ email: sEmail, isStudent: false }).populate('role');
      if (existingStaff && existingStaff.role?.slug !== 'parent') {
        return next(new AppError('This email is already associated with an administrative staff account.', 409));
      }
    }
  }

  let studentCode = null;
  if (isStudent) {
    studentCode = 'STU-' + Math.floor(100000 + Math.random() * 900000);
  }

  const user = await User.create({
    fullName,
    email: sEmail,
    password,
    phone,
    role: roleObj._id,
    studentCode,
    isStudent,
  });

  // Auto-initialize profile based on role & link parent/children
  if (isStudent) {
    const StudentProfile = require('../models/StudentProfile');
    const ParentProfile = require('../models/ParentProfile');

    let parentUserId = null;
    if (sEmail) {
      const parentUser = await User.findOne({ email: sEmail, isStudent: false }).populate('role');
      if (parentUser && parentUser.role?.slug === 'parent') {
        parentUserId = parentUser._id;
        await ParentProfile.findOneAndUpdate(
          { user: parentUser._id },
          { $addToSet: { children: user._id } },
          { upsert: true }
        );
      }
    }

    await StudentProfile.create({
      user: user._id,
      studentCode,
      parentUser: parentUserId,
    });
  } else if (requestedRole === 'parent') {
    const StudentProfile = require('../models/StudentProfile');
    const ParentProfile = require('../models/ParentProfile');

    let initialChildren = [];
    if (sEmail) {
      const existingStudents = await User.find({ email: sEmail, isStudent: true });
      if (existingStudents.length > 0) {
        initialChildren = existingStudents.map((s) => s._id);
        await StudentProfile.updateMany(
          { user: { $in: initialChildren } },
          { parentUser: user._id }
        );
      }
    }

    await ParentProfile.create({
      user: user._id,
      children: initialChildren,
    });
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
 * Supports email, Student ID (STU-XXXXXX), or phone, with brute-force protection.
 */
exports.login = catchAsync(async (req, res, next) => {
  const { email, identifier: rawId, password } = req.body;
  const loginInput = String(rawId || email || '').trim();

  let user = null;
  let isPasswordPreVerified = false;

  // 1. If input contains '@', search by email (case-insensitive)
  if (loginInput.includes('@')) {
    let cleanEmail = loginInput.toLowerCase();
    if (cleanEmail === 'digitalarabdev@gmail.com') {
      cleanEmail = 'digitalarab.dev@gmail.com';
    }
    const candidates = await User.find({ email: cleanEmail })
      .select('+password +loginAttempts +lockUntil')
      .populate('role');

    if (candidates.length === 0) {
      console.log(`[LOGIN FAILED] User not found for email: '${cleanEmail}'`);
      return next(new AppError('Invalid email, Student ID, or password.', 401));
    }

    if (candidates.length === 1) {
      user = candidates[0];
    } else {
      // Multiple accounts share this email address
      const matchedUsers = [];
      for (const candidate of candidates) {
        if (!candidate.isLocked) {
          const match = await candidate.comparePassword(password);
          if (match) {
            matchedUsers.push(candidate);
          }
        }
      }

      if (matchedUsers.length === 1) {
        user = matchedUsers[0];
        isPasswordPreVerified = true;
      } else if (matchedUsers.length > 1) {
        return next(
          new AppError(
            'Multiple accounts share this email address and password. Please log in using your unique Student ID (STU-XXXXXX).',
            409
          )
        );
      } else {
        return next(new AppError('Invalid email, Student ID, or password.', 401));
      }
    }
  } else {
    // 2. Try Student Code match directly on User model
    user = await User.findOne({ studentCode: loginInput.toUpperCase() })
      .select('+password +loginAttempts +lockUntil')
      .populate('role');

    // If not found, try StudentProfile model lookup
    if (!user) {
      const StudentProfile = require('../models/StudentProfile');
      const profile = await StudentProfile.findOne({ studentCode: loginInput.toUpperCase() });
      if (profile && profile.user) {
        user = await User.findById(profile.user)
          .select('+password +loginAttempts +lockUntil')
          .populate('role');
      }
    }

    // 3. If still not found and input looks like a phone number
    if (!user && loginInput.length >= 7) {
      const cleanPhone = loginInput.replace(/[\s-]/g, '');
      const candidates = await User.find({
        $or: [{ phone: loginInput }, { phone: cleanPhone }],
      })
        .select('+password +loginAttempts +lockUntil')
        .populate('role');
      if (candidates.length === 1) {
        user = candidates[0];
      }
    }

    // 4. Fallback: try email match even without '@'
    if (!user) {
      const candidates = await User.find({ email: loginInput.toLowerCase() })
        .select('+password +loginAttempts +lockUntil')
        .populate('role');
      if (candidates.length === 1) {
        user = candidates[0];
      } else if (candidates.length > 1) {
        const matchedUsers = [];
        for (const candidate of candidates) {
          if (!candidate.isLocked) {
            const match = await candidate.comparePassword(password);
            if (match) {
              matchedUsers.push(candidate);
            }
          }
        }
        if (matchedUsers.length === 1) {
          user = matchedUsers[0];
          isPasswordPreVerified = true;
        } else if (matchedUsers.length > 1) {
          return next(
            new AppError(
              'Multiple accounts share this email address and password. Please log in using your unique Student ID (STU-XXXXXX).',
              409
            )
          );
        } else {
          return next(new AppError('Invalid email, Student ID, or password.', 401));
        }
      }
    }
  }

  if (!user) {
    console.log(`[LOGIN FAILED] User not found for identifier: '${loginInput}'`);
    return next(new AppError('Invalid email, Student ID, or password.', 401));
  }

  if (user.isLocked) {
    console.log(`[LOGIN FAILED] User account is locked: '${loginInput}'`);
    return next(
      new AppError('This account is temporarily locked due to multiple failed attempts. Try again later.', 423)
    );
  }

  let isMatch = isPasswordPreVerified;
  if (!isPasswordPreVerified) {
    isMatch = await user.comparePassword(password);
  }
  console.log(`[LOGIN CHECK] Identifier: '${loginInput}', Password Length: ${password?.length}, isMatch: ${isMatch}`);

  if (!isMatch) {
    user.loginAttempts = (user.loginAttempts || 0) + 1;
    if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      user.lockUntil = Date.now() + LOCK_TIME_MINUTES * 60 * 1000;
    }
    await user.save({ validateBeforeSave: false });
    return next(new AppError('Invalid email, Student ID, or password.', 401));
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
