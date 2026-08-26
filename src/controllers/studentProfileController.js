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
      .populate('primaryBranch', 'name code city')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: students.length, data: students });
  } catch (err) {
    next(err);
  }
};

// 4. Bulk Migrate / Import Students
exports.migrateStudents = async (req, res, next) => {
  try {
    const { students = [], dryRun = false } = req.body;

    if (!Array.isArray(students) || students.length === 0) {
      return next(new AppError('Please provide an array of student records to migrate.', 400));
    }

    const studentRole = await Role.findOne({ slug: 'student' });
    const parentRole = await Role.findOne({ slug: 'parent' });
    const defaultBranch = await Branch.findOne();
    const allBranches = await Branch.find();
    const allPrograms = await Program.find();

    const summary = {
      totalRecords: students.length,
      isDryRun: Boolean(dryRun),
      validCount: 0,
      importedCount: 0,
      duplicateCount: 0,
      rejectedCount: 0,
      errors: [],
      importedSamples: [],
      duplicates: [],
    };

    for (let i = 0; i < students.length; i++) {
      const row = students[i];
      const rowNum = i + 1;
      const fullName = (row.fullName || row.studentName || row.name || '').trim();
      const email = (row.email || row.studentEmail || '').trim().toLowerCase();
      const phone = (row.phone || row.studentPhone || '').trim();
      const legacyId = (row.legacyStudentId || row.studentCode || row.studentId || '').trim();
      const parentName = (row.parentName || row.guardianName || '').trim();
      const parentEmail = (row.parentEmail || row.guardianEmail || '').trim().toLowerCase();
      const parentPhone = (row.parentPhone || row.guardianPhone || '').trim();

      // Basic Validation
      if (!fullName) {
        summary.rejectedCount++;
        summary.errors.push({ row: rowNum, error: 'Missing Student Name', data: row });
        continue;
      }

      // Generate or normalize email if missing
      const studentEmail = email || `student_${legacyId ? legacyId.toLowerCase().replace(/[^a-z0-9]/g, '') : Date.now() + '_' + i}@aquafishing.academy`;

      // Check Duplicate by Email or Legacy ID
      const existingUser = await User.findOne({ email: studentEmail });
      let existingProfile = null;
      if (legacyId) {
        existingProfile = await StudentProfile.findOne({ studentCode: legacyId });
      }

      if (existingUser || existingProfile) {
        summary.duplicateCount++;
        summary.duplicates.push({
          row: rowNum,
          studentName: fullName,
          email: studentEmail,
          legacyId: legacyId || existingProfile?.studentCode,
          reason: existingUser ? 'Email already registered' : 'Student Code already exists',
        });
        continue;
      }

      // Branch Mapping
      let branchId = defaultBranch?._id;
      if (row.branch || row.branchName) {
        const queryBranch = String(row.branch || row.branchName).toLowerCase();
        const matched = allBranches.find(
          (b) => b.name.toLowerCase().includes(queryBranch) || b.city?.toLowerCase().includes(queryBranch) || (b.code && b.code.toLowerCase() === queryBranch)
        );
        if (matched) branchId = matched._id;
      }

      // Program Mapping
      const enrolledProgramIds = [];
      if (row.program || row.programName || row.enrolledProgram) {
        const queryProg = String(row.program || row.programName || row.enrolledProgram).toLowerCase();
        const matchedProg = allPrograms.find(
          (p) => p.title.toLowerCase().includes(queryProg) || (p.code && p.code.toLowerCase() === queryProg)
        );
        if (matchedProg) enrolledProgramIds.push(matchedProg._id);
      }

      summary.validCount++;

      // If dry run, do not write to database
      if (dryRun) {
        if (summary.importedSamples.length < 5) {
          summary.importedSamples.push({
            row: rowNum,
            fullName,
            email: studentEmail,
            studentCode: legacyId || 'AUTO-GENERATED',
            parentName: parentName || 'N/A',
            branch: branchId,
          });
        }
        continue;
      }

      // 1. Resolve or Create Parent
      let parentUserId = null;
      if (parentEmail) {
        let parentUser = await User.findOne({ email: parentEmail });
        if (!parentUser) {
          parentUser = await User.create({
            fullName: parentName || `${fullName}'s Parent`,
            email: parentEmail,
            phone: parentPhone || '',
            role: parentRole?._id,
            branch: branchId,
            password: 'Password@12345',
          });
          await ParentProfile.create({
            user: parentUser._id,
            children: [],
          });
        }
        parentUserId = parentUser._id;
      }

      // 2. Create Student User
      const studentUser = await User.create({
        fullName,
        email: studentEmail,
        phone: phone || '',
        role: studentRole?._id,
        branch: branchId,
        password: 'Student@12345',
      });

      // 3. Create Student Profile
      const studentCode = legacyId || 'STU-' + Math.floor(100000 + Math.random() * 900000);
      const studentProfile = await StudentProfile.create({
        user: studentUser._id,
        parentUser: parentUserId,
        studentCode,
        dateOfBirth: row.dateOfBirth ? new Date(row.dateOfBirth) : null,
        gender: row.gender && ['Male', 'Female', 'Other'].includes(row.gender) ? row.gender : 'Prefer not to say',
        skillLevel: row.skillLevel && ['Beginner', 'Intermediate', 'Advanced', 'Master'].includes(row.skillLevel) ? row.skillLevel : 'Beginner',
        primaryBranch: branchId,
        enrolledPrograms: enrolledProgramIds,
        emergencyContact: {
          name: row.emergencyContactName || parentName || '',
          phone: row.emergencyContactPhone || parentPhone || phone || '',
          relationship: row.emergencyRelationship || 'Parent/Guardian',
        },
        medicalNotes: row.medicalNotes || 'No known restrictions.',
        dietaryNotes: row.dietaryNotes || 'Standard diet.',
      });

      // Link child to parent
      if (parentUserId) {
        await ParentProfile.findOneAndUpdate(
          { user: parentUserId },
          { $addToSet: { children: studentUser._id } }
        );
      }

      summary.importedCount++;
      if (summary.importedSamples.length < 5) {
        summary.importedSamples.push({
          id: studentProfile._id,
          studentCode,
          fullName,
          email: studentEmail,
          parentLinked: Boolean(parentUserId),
        });
      }
    }

    res.status(200).json({
      success: true,
      message: dryRun
        ? `Migration Dry-Run complete: ${summary.validCount} valid records, ${summary.duplicateCount} duplicates, ${summary.rejectedCount} rejected.`
        : `Migration successfully imported ${summary.importedCount} students (${summary.duplicateCount} duplicates skipped, ${summary.rejectedCount} rejected).`,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};
