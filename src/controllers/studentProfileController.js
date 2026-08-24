const StudentProfile = require('../models/StudentProfile');
const ParentProfile = require('../models/ParentProfile');
const Branch = require('../models/Branch');
const Program = require('../models/Program');
const User = require('../models/User');
const Role = require('../models/Role');
const AppError = require('../utils/appError');

// Helper to validate student access authorization
const validateStudentAccess = async (req, targetUserId) => {
  const currentUserId = req.user.id.toString();
  const roleSlug = req.user.role?.slug;

  // Own profile
  if (currentUserId === targetUserId.toString()) {
    return true;
  }

  // Admin & Staff roles
  if (['super-admin', 'admin', 'management', 'operations-manager', 'coach', 'instructor', 'head-coach'].includes(roleSlug)) {
    return true;
  }

  // Parent role: check if target is linked child
  if (roleSlug === 'parent') {
    const parent = await ParentProfile.findOne({ user: req.user.id });
    const childrenIds = (parent?.children || []).map((c) => (c._id ? c._id.toString() : c.toString()));
    if (childrenIds.includes(targetUserId.toString())) {
      return true;
    }
    const studentProfile = await StudentProfile.findOne({ user: targetUserId, parentUser: req.user.id });
    if (studentProfile) {
      return true;
    }
    throw new AppError('Unauthorized: You can only access profiles of your linked children.', 403);
  }

  // Student trying to access another student
  throw new AppError('Unauthorized: You can only access your own student profile.', 403);
};

// 1. Get current logged-in student profile or specific student by ID/user ID
exports.getStudentProfile = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId || req.user.id;
    await validateStudentAccess(req, targetUserId);

    let profile = await StudentProfile.findOne({ user: targetUserId })
      .populate('user', 'fullName email phone branch avatarUrl')
      .populate('parentUser', 'fullName email phone')
      .populate('primaryBranch', 'name code city address')
      .populate('enrolledPrograms');

    if (!profile) {
      // Auto-create profile if missing for student user
      const studentCode = 'STU-' + Math.floor(100000 + Math.random() * 900000);
      profile = await StudentProfile.create({
        user: targetUserId,
        studentCode,
      });
      profile = await StudentProfile.findById(profile._id)
        .populate('user', 'fullName email phone branch avatarUrl')
        .populate('parentUser', 'fullName email phone')
        .populate('primaryBranch', 'name code city address')
        .populate('enrolledPrograms');
    }

    if (!profile) return next(new AppError('Student profile not found', 404));

    res.status(200).json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
};

// 2. Update student profile
exports.updateStudentProfile = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId || req.user.id;
    await validateStudentAccess(req, targetUserId);

    let profile = await StudentProfile.findOne({ user: targetUserId });

    if (!profile) {
      const studentCode = 'STU-' + Math.floor(100000 + Math.random() * 900000);
      profile = await StudentProfile.create({
        user: targetUserId,
        studentCode,
        ...req.body,
      });
    } else {
      profile = await StudentProfile.findOneAndUpdate({ user: targetUserId }, req.body, {
        new: true,
        runValidators: true,
      });
    }

    // Also update User branch if primaryBranch updated
    if (req.body.fullName || req.body.phone) {
      await User.findByIdAndUpdate(targetUserId, {
        fullName: req.body.fullName,
        phone: req.body.phone,
      });
    }

    const updated = await StudentProfile.findById(profile._id)
      .populate('user', 'fullName email phone branch avatarUrl')
      .populate('parentUser', 'fullName email phone')
      .populate('primaryBranch')
      .populate('enrolledPrograms');

    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

// 3. Admin list all students
exports.getAllStudents = async (req, res, next) => {
  try {
    const students = await StudentProfile.find()
      .populate('user', 'fullName email phone branch status')
      .populate('parentUser', 'fullName email phone')
      .populate('primaryBranch', 'name code')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: students.length, data: students });
  } catch (err) {
    next(err);
  }
};
