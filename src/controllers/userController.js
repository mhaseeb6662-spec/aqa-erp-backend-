const User = require('../models/User');
const Role = require('../models/Role');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const sendResponse = require('../utils/apiResponse');

/**
 * GET /api/v1/users
 * Supports basic search, role filtering, status filtering and pagination
 * so the frontend Users table has real, usable query params from day one.
 */
exports.getUsers = catchAsync(async (req, res) => {
  const { search = '', role, status, page = 1, limit = 10 } = req.query;

  const filter = {};
  if (search) {
    filter.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }
  if (role) filter.role = role;
  if (status) filter.status = status;

  const pageNum = Math.max(Number(page), 1);
  const limitNum = Math.min(Math.max(Number(limit), 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const [users, total] = await Promise.all([
    User.find(filter)
      .populate('role', 'name slug')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    User.countDocuments(filter),
  ]);

  return sendResponse(res, 200, 'Users fetched successfully.', users, {
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
  });
});

/**
 * GET /api/v1/users/:id
 */
exports.getUserById = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id).populate('role');
  if (!user) return next(new AppError('User not found.', 404));
  return sendResponse(res, 200, 'User fetched successfully.', user.toSafeObject());
});

/**
 * POST /api/v1/users
 * Admin-created staff/portal accounts (as opposed to public self-registration).
 */
exports.createUser = catchAsync(async (req, res, next) => {
  const { fullName, email, password, phone, role, branch, status } = req.body;
  const sEmail = (email || '').trim().toLowerCase() || undefined;

  if (sEmail) {
    const existing = await User.findOne({ email: sEmail });
    if (existing) {
      return next(new AppError('An account with this email already exists.', 409));
    }
  }

  const roleDoc = await Role.findById(role);
  if (!roleDoc) return next(new AppError('Selected role does not exist.', 400));

  const user = await User.create({
    fullName,
    email: sEmail,
    password,
    phone,
    role,
    branch,
    status,
    createdBy: req.user._id,
  });

  if (roleDoc.slug === 'student') {
    const StudentProfile = require('../models/StudentProfile');
    const studentCode = 'STU-' + Math.floor(100000 + Math.random() * 900000);
    await StudentProfile.create({
      user: user._id,
      studentCode,
      primaryBranch: branch || null,
    });
  }

  await user.populate('role');
  return sendResponse(res, 201, 'User created successfully.', user.toSafeObject());
});

/**
 * PATCH /api/v1/users/:id
 */
exports.updateUser = catchAsync(async (req, res, next) => {
  const disallowed = ['password'];
  disallowed.forEach((field) => delete req.body[field]);
  
  if (req.body.email !== undefined) {
    const sEmail = (req.body.email || '').trim().toLowerCase() || undefined;
    req.body.email = sEmail;
    
    if (sEmail) {
      const existing = await User.findOne({ email: sEmail, _id: { $ne: req.params.id } });
      if (existing) {
        return next(new AppError('An account with this email already exists.', 409));
      }
    }
  }

  if (req.body.role) {
    const roleDoc = await Role.findById(req.body.role);
    if (!roleDoc) return next(new AppError('Selected role does not exist.', 400));
  }

  const user = await User.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate('role');

  if (!user) return next(new AppError('User not found.', 404));
  return sendResponse(res, 200, 'User updated successfully.', user.toSafeObject());
});

/**
 * PATCH /api/v1/users/:id/status
 * Dedicated endpoint to activate/deactivate/suspend, kept separate from
 * general updates so it can carry its own audit logging in later phases.
 */
exports.updateUserStatus = catchAsync(async (req, res, next) => {
  const { status } = req.body;
  if (!['active', 'inactive', 'suspended'].includes(status)) {
    return next(new AppError('Invalid status value.', 400));
  }

  const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate('role');
  if (!user) return next(new AppError('User not found.', 404));

  return sendResponse(res, 200, `User status updated to "${status}".`, user.toSafeObject());
});

/**
 * DELETE /api/v1/users/:id
 */
exports.deleteUser = catchAsync(async (req, res, next) => {
  if (String(req.params.id) === String(req.user._id)) {
    return next(new AppError('You cannot delete your own account.', 400));
  }

  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return next(new AppError('User not found.', 404));

  return sendResponse(res, 200, 'User deleted successfully.');
});
