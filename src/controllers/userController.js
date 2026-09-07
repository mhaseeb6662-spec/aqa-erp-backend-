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
  
  const roleDoc = await Role.findById(role);
  if (!roleDoc) return next(new AppError('Selected role does not exist.', 400));

  const isStudent = roleDoc.slug === 'student';
  const sEmail = (email || '').trim().toLowerCase() || undefined;

  // Non-student accounts (Admin, Coach, Staff) must have an email
  if (!isStudent && !sEmail) {
    return next(new AppError('Email is required for staff and admin accounts.', 400));
  }

  // Duplicate email check
  if (sEmail) {
    if (!isStudent) {
      const existing = await User.findOne({ email: sEmail });
      if (existing) {
        return next(new AppError('An account with this email already exists.', 409));
      }
    } else {
      // Students can share a family email with other students, but cannot hijack a staff email
      const existingStaff = await User.findOne({ email: sEmail, isStudent: false });
      if (existingStaff) {
        return next(new AppError('This email is already associated with an administrative staff account.', 409));
      }
    }
  }

  let studentCode = null;
  if (isStudent) {
    studentCode = 'STU-' + Math.floor(100000 + Math.random() * 900000);
  }

  let branchId = null;
  if (branch) {
    const Branch = require('../models/Branch');
    const mongoose = require('mongoose');
    if (mongoose.Types.ObjectId.isValid(branch)) {
      branchId = branch;
    } else {
      const bDoc = await Branch.findOne({
        $or: [
          { name: { $regex: new RegExp(`^${String(branch).trim()}$`, 'i') } },
          { code: { $regex: new RegExp(`^${String(branch).trim()}$`, 'i') } },
        ],
      });
      if (bDoc) branchId = bDoc._id;
    }
  }

  const user = await User.create({
    fullName,
    email: sEmail,
    password,
    phone,
    role,
    branch: branchId ? branchId.toString() : branch,
    status,
    studentCode,
    isStudent,
    createdBy: req.user._id,
  });

  if (isStudent) {
    const StudentProfile = require('../models/StudentProfile');
    await StudentProfile.create({
      user: user._id,
      studentCode,
      primaryBranch: branchId || null,
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

  const targetUser = await User.findById(req.params.id).populate('role');
  if (!targetUser) return next(new AppError('User not found.', 404));

  const isStudent = targetUser.role?.slug === 'student' || targetUser.isStudent;

  const updateOps = { ...req.body };

  if (req.body.email !== undefined) {
    const sEmail = (req.body.email || '').trim().toLowerCase() || undefined;

    if (!isStudent && !sEmail) {
      return next(new AppError('Email is required for staff and admin accounts.', 400));
    }

    if (sEmail) {
      if (!isStudent) {
        const existing = await User.findOne({ email: sEmail, _id: { $ne: req.params.id } });
        if (existing) {
          return next(new AppError('An account with this email already exists.', 409));
        }
      } else {
        const existingStaff = await User.findOne({ email: sEmail, isStudent: false, _id: { $ne: req.params.id } });
        if (existingStaff) {
          return next(new AppError('This email is already associated with an administrative staff account.', 409));
        }
      }
      updateOps.email = sEmail;
    } else {
      delete updateOps.email;
      updateOps.$unset = { email: 1 };
    }
  }

  if (req.body.role) {
    const roleDoc = await Role.findById(req.body.role);
    if (!roleDoc) return next(new AppError('Selected role does not exist.', 400));
  }

  const user = await User.findByIdAndUpdate(req.params.id, updateOps, {
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
