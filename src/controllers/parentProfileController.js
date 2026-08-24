const ParentProfile = require('../models/ParentProfile');
const StudentProfile = require('../models/StudentProfile');
const Branch = require('../models/Branch');
const Program = require('../models/Program');
const User = require('../models/User');
const Role = require('../models/Role');
const AppError = require('../utils/appError');

// Get parent profile & linked children
exports.getParentProfile = async (req, res, next) => {
  try {
    const parentId = req.user.id;
    let parent = await ParentProfile.findOneAndUpdate(
      { user: parentId },
      { $setOnInsert: { user: parentId, children: [] } },
      { new: true, upsert: true }
    )
      .populate('user', 'fullName email phone')
      .populate({
        path: 'children',
        select: 'fullName email phone',
      });

    const childrenIds = (parent.children || []).map((c) => (c._id ? c._id : c));

    // Get detailed student profiles of all linked children
    const childrenProfiles = await StudentProfile.find({
      $or: [{ parentUser: parentId }, { user: { $in: childrenIds } }],
    })
      .populate('user', 'fullName email phone avatarUrl')
      .populate('primaryBranch', 'name code')
      .populate('enrolledPrograms');

    res.status(200).json({
      success: true,
      data: {
        profile: parent,
        children: childrenProfiles || [],
      },
    });
  } catch (err) {
    next(err);
  }
};

// Update parent profile
exports.updateParentProfile = async (req, res, next) => {
  try {
    const parentId = req.user.id;
    const parent = await ParentProfile.findOneAndUpdate({ user: parentId }, req.body, {
      new: true,
      upsert: true,
      runValidators: true,
    }).populate('user', 'fullName email phone');

    res.status(200).json({ success: true, data: parent });
  } catch (err) {
    next(err);
  }
};

// Link child account to parent by Student Code or Email
exports.linkChild = async (req, res, next) => {
  try {
    const { studentIdentifier } = req.body;
    if (!studentIdentifier) return next(new AppError('Please provide Student ID Code or Email', 400));

    // Find student user or student profile
    const studentUser = await User.findOne({
      $or: [{ email: studentIdentifier.toLowerCase() }, { phone: studentIdentifier }],
    });

    let studentProfile = null;
    if (studentUser) {
      studentProfile = await StudentProfile.findOne({ user: studentUser._id });
    } else {
      studentProfile = await StudentProfile.findOne({ studentCode: studentIdentifier.toUpperCase() });
    }

    if (!studentProfile) {
      return next(new AppError('Student profile not found with the provided code or email', 404));
    }

    const studentUserId = studentProfile.user;

    // Update parent profile
    const parent = await ParentProfile.findOneAndUpdate(
      { user: req.user.id },
      { $addToSet: { children: studentUserId } },
      { new: true, upsert: true }
    );

    // Link parent to student profile
    studentProfile.parentUser = req.user.id;
    await studentProfile.save();

    res.status(200).json({
      success: true,
      message: 'Student account successfully linked to parent portal.',
      data: studentProfile,
    });
  } catch (err) {
    next(err);
  }
};

// Create a new child account directly under parent
exports.createChild = async (req, res, next) => {
  try {
    const { fullName, email, gender, dateOfBirth, medicalNotes, dietaryNotes, skillLevel, primaryBranch } = req.body;

    if (!fullName) return next(new AppError('Student full name is required', 400));

    const studentEmail = email
      ? email.toLowerCase().trim()
      : `child.${Date.now()}.${Math.floor(Math.random() * 1000)}@aquafishing.academy`;

    const studentRole = await Role.findOne({ slug: 'student' });

    // Create User account for student
    const studentUser = await User.create({
      fullName,
      email: studentEmail,
      password: 'StudentTempPassword123!', // temporary default password
      role: studentRole._id,
    });

    const studentCode = 'STU-' + Math.floor(100000 + Math.random() * 900000);

    const studentProfile = await StudentProfile.create({
      user: studentUser._id,
      parentUser: req.user.id,
      studentCode,
      gender: gender || 'Prefer not to say',
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      medicalNotes: medicalNotes || 'No known allergies or medical restrictions.',
      dietaryNotes: dietaryNotes || 'Standard diet.',
      skillLevel: skillLevel || 'Beginner',
      primaryBranch: primaryBranch || null,
    });

    // Add to parent's children array
    await ParentProfile.findOneAndUpdate(
      { user: req.user.id },
      { $addToSet: { children: studentUser._id } },
      { new: true, upsert: true }
    );

    const populated = await StudentProfile.findById(studentProfile._id)
      .populate('user', 'fullName email phone avatarUrl')
      .populate('primaryBranch', 'name code');

    res.status(201).json({
      success: true,
      message: 'New student account created and linked successfully.',
      data: populated,
    });
  } catch (err) {
    next(err);
  }
};

// Admin list all parent accounts
exports.getAllParents = async (req, res, next) => {
  try {
    const parents = await ParentProfile.find()
      .populate('user', 'fullName email phone status createdAt')
      .populate({
        path: 'children',
        select: 'fullName email phone',
      })
      .sort({ createdAt: -1 });

    const enrichedParents = await Promise.all(
      parents.map(async (p) => {
        const childrenProfiles = await StudentProfile.find({
          $or: [{ parentUser: p.user?._id }, { user: { $in: p.children || [] } }],
        })
          .populate('user', 'fullName email phone')
          .populate('primaryBranch', 'name');

        return {
          ...p.toObject(),
          childrenProfiles,
        };
      })
    );

    res.status(200).json({ success: true, count: enrichedParents.length, data: enrichedParents });
  } catch (err) {
    next(err);
  }
};
